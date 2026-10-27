import { prisma } from "../../config";
import { bundleAccess, loadVersionInBundle, loadVersionLocalizationInBundle } from "../auth";
import {
  CACHE_TTL_MS,
  ascClientForUser,
  handle,
  toLocalizationSummaries,
} from "./asc-shared";
import { ascRouter } from "./asc-versions";

const FROZEN_STATES = new Set(["READY_FOR_SALE", "REPLACED_WITH_NEW_VERSION"]);

ascRouter.get(
  "/versions/:versionId/screenshots",
  bundleAccess("query"),
  handle("getVersionScreenshots", async (req, res) => {
    const versionId = req.params.versionId;
    const locale = (req.query.locale as string) || undefined;
    const refresh = req.query.refresh === "true";

    if (!locale) {
      res.status(400).json({ error: "locale required" });
      return;
    }

    const dbVersion = await loadVersionInBundle(res, versionId, req.bundleApp!.bundleId);
    if (!dbVersion) return;

    const versionLoc = await prisma.appStoreVersionLocalization.findFirst({
      where: { versionId, locale },
      select: {
        id: true,
        versionLocalizationId: true,
        ascScreenshots: true,
        ascScreenshotsSyncedAt: true,
      },
    });

    const frozen = FROZEN_STATES.has(dbVersion.appStoreState);
    const cached = Array.isArray(versionLoc?.ascScreenshots) ? (versionLoc?.ascScreenshots as any[]) : null;
    const syncedAt = versionLoc?.ascScreenshotsSyncedAt ?? null;
    const fresh = syncedAt && Date.now() - new Date(syncedAt).getTime() < CACHE_TTL_MS;

    if (!refresh && cached && (frozen || fresh)) {
      res.json({ screenshots: cached, cached: true });

      return;
    }

    let versionLocalizationId = versionLoc?.versionLocalizationId ?? null;
    const asc = await ascClientForUser(req.user!.userId);

    if (!versionLocalizationId) {
      const remoteLocs = await asc.getVersionLocalizations(versionId);

      versionLocalizationId = remoteLocs.find((l: any) => l.attributes.locale === locale)?.id ?? null;
    }

    if (!versionLocalizationId) {
      if (cached) {
        res.json({ screenshots: cached, cached: true });

        return;
      }

      res.json({ screenshots: [] });

      return;
    }

    const sets = await asc.listScreenshotSets(versionLocalizationId);
    const screenshots: Array<{
      id: string;
      displayType: string;
      url: string;
      thumbUrl: string;
      width: number;
      height: number;
    }> = [];

    for (const set of sets) {
      const items = await asc.listScreenshotsInSet(set.id);
      for (const item of items) {
        const asset = item.attributes.imageAsset;
        const ready = item.attributes.assetDeliveryState?.state === "COMPLETE";

        if (!asset || !asset.templateUrl || !ready) continue;

        const buildUrl = (w: number, h: number) =>
          asset.templateUrl
            .replace("{w}", String(w))
            .replace("{h}", String(h))
            .replace("{c}", "bb")
            .replace("{f}", "jpg");

        screenshots.push({
          id: item.id,
          displayType: set.attributes.screenshotDisplayType,
          url: buildUrl(asset.width, asset.height),
          thumbUrl: buildUrl(Math.round(asset.width / 3), Math.round(asset.height / 3)),
          width: asset.width,
          height: asset.height,
        });
      }
    }

    const keepHistorical = frozen && screenshots.length === 0 && cached && cached.length > 0;

    if (!keepHistorical) {
      if (versionLoc) {
        await prisma.appStoreVersionLocalization.update({
          where: { id: versionLoc.id },
          data: {
            ascScreenshots: screenshots as any,
            ascScreenshotsSyncedAt: new Date(),
          },
        });
      } else {
        await prisma.appStoreVersionLocalization.upsert({
          where: { versionId_locale: { versionId, locale } },
          create: {
            versionId,
            locale,
            versionLocalizationId,
            ascScreenshots: screenshots as any,
            ascScreenshotsSyncedAt: new Date(),
          },
          update: {
            versionLocalizationId,
            ascScreenshots: screenshots as any,
            ascScreenshotsSyncedAt: new Date(),
          },
        });
      }

      res.json({ screenshots, cached: false });
    } else {
      res.json({ screenshots: cached, cached: true });
    }
  }),
);

ascRouter.patch(
  "/versions/metadata",
  bundleAccess("body"),
  handle("updateMetadata", async (req, res) => {
    const {
      versionId: bodyVersionId,
      appInfoLocalizationId,
      versionLocalizationId,
      locale,
      field,
      value,
    } = req.body as {
      versionId?: string;
      appInfoLocalizationId?: string;
      versionLocalizationId?: string;
      locale?: string;
      field: string;
      value: string;
    };

    if (!field || value === undefined) {
      res.status(400).json({ error: "field and value are required" });
      return;
    }

    const bundleId = req.bundleApp!.bundleId;
    const asc = await ascClientForUser(req.user!.userId);

    if (field === "copyright") {
      if (!bodyVersionId) {
        res.status(400).json({ error: "versionId required for copyright" });
        return;
      }

      if (!(await loadVersionInBundle(res, bodyVersionId, bundleId))) return;
      await asc.updateVersionAttributes(bodyVersionId, { copyright: value });
      await prisma.appStoreVersion
        .update({
          where: { id: bodyVersionId },
          data: { copyright: value || null },
        })
        .catch(() => {});

      res.json({ ok: true, field, value });

      return;
    }

    const METADATA_FIELDS = {
      appInfo: {
        fields: ["name", "subtitle", "privacyPolicyUrl"],
        localizationId: appInfoLocalizationId,
        kind: "appInfo" as const,
        errorMsg: "appInfoLocalizationId is required for app info localization fields",
        update: (id: string) => asc.updateAppInfoLocalization(id, { [field]: value }),
      },
      version: {
        fields: ["description", "keywords", "whatsNew", "promotionalText", "supportUrl", "marketingUrl"],
        localizationId: versionLocalizationId,
        kind: "version" as const,
        errorMsg: "versionLocalizationId is required for version fields",
        update: (id: string) => asc.updateVersionLocalization(id, { [field]: value }),
      },
    };

    const matchedGroup = Object.values(METADATA_FIELDS).find((g) => g.fields.includes(field));

    if (!matchedGroup) {
      res.status(400).json({ error: `Unknown field: ${field}` });
      return;
    }

    if (!matchedGroup.localizationId) {
      res.status(400).json({ error: matchedGroup.errorMsg });
      return;
    }

    if (
      !(await loadVersionLocalizationInBundle(res, {
        ascLocalizationId: matchedGroup.localizationId,
        kind: matchedGroup.kind,
        bundleId,
      }))
    ) {
      return;
    }

    await matchedGroup.update(matchedGroup.localizationId);
    const localizationWhere = {
      AND: [
        { version: { bundleId } },
        {
          OR: [
            appInfoLocalizationId ? { appInfoLocalizationId } : undefined,
            versionLocalizationId ? { versionLocalizationId } : undefined,
            bodyVersionId && locale ? { versionId: bodyVersionId, locale } : undefined,
          ].filter(Boolean) as any[],
        },
      ],
    };

    await prisma.appStoreVersionLocalization
      .updateMany({
        where: localizationWhere,
        data: { [field]: value },
      })
      .catch(() => {});

    const updatedLocalization = await prisma.appStoreVersionLocalization.findFirst({
      where: localizationWhere,
    });

    let localizationSummary: ReturnType<typeof toLocalizationSummaries>[number] | null = null;

    if (updatedLocalization) {
      const localizations = await prisma.appStoreVersionLocalization.findMany({
        where: { versionId: updatedLocalization.versionId },
      });

      localizationSummary =
        toLocalizationSummaries(localizations).find((l) => l.locale === updatedLocalization.locale) ?? null;
    }

    res.json({ ok: true, field, value, localizationSummary });
  }),
);

ascRouter.get(
  "/versions/reviewer-info",
  bundleAccess("query"),
  handle("getReviewerInfo", async (req, res) => {
    const versionId = req.query.versionId as string;

    if (!versionId) {
      res.status(400).json({ error: "versionId required" });
      return;
    }

    const cached = await prisma.appStoreVersion.findFirst({
      where: { id: versionId, bundleId: req.bundleApp!.bundleId },
      select: {
        reviewerFirstName: true,
        reviewerLastName: true,
        reviewerPhone: true,
        reviewerEmail: true,
        reviewerDemoAccountRequired: true,
        reviewerDemoUsername: true,
        reviewerDemoPassword: true,
        reviewDetailId: true,
      },
    });

    res.json({
      reviewerFirstName: cached?.reviewerFirstName ?? "",
      reviewerLastName: cached?.reviewerLastName ?? "",
      reviewerPhone: cached?.reviewerPhone ?? "",
      reviewerEmail: cached?.reviewerEmail ?? "",
      reviewerDemoAccountRequired: cached?.reviewerDemoAccountRequired ?? false,
      reviewerDemoUsername: cached?.reviewerDemoUsername ?? "",
      reviewerDemoPassword: cached?.reviewerDemoPassword ?? "",
      reviewDetailId: cached?.reviewDetailId ?? null,
    });
  }),
);

ascRouter.patch(
  "/versions/reviewer-info",
  bundleAccess("body"),
  handle("updateReviewerInfo", async (req, res) => {
    const {
      versionId,
      reviewerFirstName,
      reviewerLastName,
      reviewerPhone,
      reviewerEmail,
      reviewerDemoAccountRequired,
      reviewerDemoUsername,
      reviewerDemoPassword,
    } = req.body as {
      versionId?: string;
      reviewerFirstName?: string;
      reviewerLastName?: string;
      reviewerPhone?: string;
      reviewerEmail?: string;
      reviewerDemoAccountRequired?: boolean;
      reviewerDemoUsername?: string;
      reviewerDemoPassword?: string;
    };

    if (!versionId) {
      res.status(400).json({ error: "versionId required" });
      return;
    }

    const dbVersion = await loadVersionInBundle(res, versionId, req.bundleApp!.bundleId);
    if (!dbVersion) return;

    const asc = await ascClientForUser(req.user!.userId);
    const existingDetailId = dbVersion.reviewDetailId ?? null;

    const newDetailId = await asc.upsertReviewDetail(versionId, existingDetailId, {
      firstName: reviewerFirstName ?? "",
      lastName: reviewerLastName ?? "",
      phone: reviewerPhone ?? "",
      email: reviewerEmail ?? "",
      demoAccountRequired: reviewerDemoAccountRequired ?? false,
      demoAccountName: reviewerDemoUsername,
      demoAccountPassword: reviewerDemoPassword,
    });

    await prisma.appStoreVersion.update({
      where: { id: versionId },
      data: {
        reviewerFirstName: reviewerFirstName ?? null,
        reviewerLastName: reviewerLastName ?? null,
        reviewerPhone: reviewerPhone ?? null,
        reviewerEmail: reviewerEmail ?? null,
        reviewerDemoAccountRequired: reviewerDemoAccountRequired ?? false,
        reviewerDemoUsername: reviewerDemoUsername ?? null,
        reviewerDemoPassword: reviewerDemoPassword ?? null,
        reviewDetailId: newDetailId,
      },
    });

    res.json({ ok: true });
  }),
);

ascRouter.post(
  "/versions/reviewer-info/sync",
  bundleAccess("body"),
  handle("syncReviewerInfo", async (req, res) => {
    const { versionId } = req.body as {
      versionId?: string;
    };

    if (!versionId) {
      res.status(400).json({ error: "versionId required" });
      return;
    }

    if (!(await loadVersionInBundle(res, versionId, req.bundleApp!.bundleId))) return;

    const asc = await ascClientForUser(req.user!.userId);
    const detail = await asc.getReviewDetail(versionId);

    if (detail) {
      await prisma.appStoreVersion.update({
        where: { id: versionId },
        data: {
          reviewerFirstName: detail.firstName || null,
          reviewerLastName: detail.lastName || null,
          reviewerPhone: detail.phone || null,
          reviewerEmail: detail.email || null,
          reviewerDemoAccountRequired: detail.demoAccountRequired,
          reviewerDemoUsername: detail.demoAccountName || null,
          reviewerDemoPassword: detail.demoAccountPassword || null,
          reviewDetailId: detail.id,
        },
      });
    }

    res.json({
      ok: true,
      reviewerFirstName: detail?.firstName ?? "",
      reviewerLastName: detail?.lastName ?? "",
      reviewerPhone: detail?.phone ?? "",
      reviewerEmail: detail?.email ?? "",
      reviewerDemoAccountRequired: detail?.demoAccountRequired ?? false,
      reviewerDemoUsername: detail?.demoAccountName ?? "",
      reviewerDemoPassword: detail?.demoAccountPassword ?? "",
    });
  }),
);
