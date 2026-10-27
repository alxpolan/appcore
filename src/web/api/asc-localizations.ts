import { prisma, logger } from "../../config";
import { bundleAccess, loadVersionInBundle, loadVersionLocalizationInBundle } from "../auth";
import { bossScheduler } from "../../jobs/boss";
import {
  QUEUE_NAME as TRANSLATE_LOCALIZATION_QUEUE,
  type TranslateLocalizationData,
} from "../../jobs/workers/translate-localization.worker";
import * as translationTracker from "../../jobs/translation-tracker";
import {
  ascClientForUser,
  handle,
  invalidateVersionCache,
  tryCreateLocalization,
} from "./asc-shared";
import { ascRouter } from "./asc-versions";

ascRouter.post(
  "/versions/localizations",
  bundleAccess("body"),
  handle("createLocalization", async (req, res) => {
    const { bundleId, versionId, locale, name } = req.body as {
      bundleId: string;
      versionId: string;
      locale: string;
      name: string;
    };

    if (!versionId || !locale || !name) {
      res.status(400).json({ error: "versionId, locale and name are required" });
      return;
    }

    if (!(await loadVersionInBundle(res, versionId, bundleId))) return;

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const appInfoId = await asc.getAppInfoId(app.id);

    if (!appInfoId) {
      res.status(404).json({ error: "App info not found" });
      return;
    }

    const [appInfoLoc, versionLoc] = await Promise.all([
      tryCreateLocalization(
        "appInfoLocalization",
        locale,
        () => asc.createAppInfoLocalization(appInfoId, locale, name),
        [500, 422],
      ),
      tryCreateLocalization(
        "versionLocalization",
        locale,
        () => asc.createVersionLocalization(versionId, locale),
        [500, 422],
      ),
    ]);

    let appInfoLocalizationId = appInfoLoc?.id ?? null;

    if (!appInfoLocalizationId) {
      const existing = await asc.getAppInfoLocalizations(app.id, appInfoId);

      appInfoLocalizationId = existing.find((l) => l.attributes.locale === locale)?.id ?? null;
    }

    let versionLocalizationId = versionLoc?.id ?? null;

    if (!versionLocalizationId) {
      const versionLocs = await asc.getVersionLocalizations(versionId);

      versionLocalizationId = versionLocs.find((l: any) => l.attributes.locale === locale)?.id ?? null;
    }

    if (!appInfoLocalizationId && !versionLocalizationId) {
      logger.warn(
        `ASC createLocalization: locale ${locale} could not be created or found — not supported by ASC for this app/version`,
      );

      res.status(422).json({
        error: `Locale ${locale} is not supported by App Store Connect for this app or version`,
      });

      return;
    }

    await prisma.appStoreVersionLocalization.upsert({
      where: { versionId_locale: { versionId, locale } },
      create: { versionId, locale, appInfoLocalizationId, versionLocalizationId, name },
      update: { appInfoLocalizationId, versionLocalizationId },
    });

    await invalidateVersionCache(bundleId);

    res.json({
      ok: true,
      locale,
      appInfoLocalizationId,
      versionLocalizationId,
    });
  }),
);

ascRouter.delete(
  "/versions/localizations",
  bundleAccess("body"),
  handle("deleteLocalization", async (req, res) => {
    const { bundleId, appInfoLocalizationId, versionLocalizationId } = req.body as {
      bundleId: string;
      appInfoLocalizationId?: string;
      versionLocalizationId?: string;
    };

    if (!appInfoLocalizationId && !versionLocalizationId) {
      res.status(400).json({ error: "At least one localization ID is required" });
      return;
    }

    if (
      appInfoLocalizationId &&
      !(await loadVersionLocalizationInBundle(res, {
        ascLocalizationId: appInfoLocalizationId,
        kind: "appInfo",
        bundleId,
      }))
    ) {
      return;
    }

    if (
      versionLocalizationId &&
      !(await loadVersionLocalizationInBundle(res, {
        ascLocalizationId: versionLocalizationId,
        kind: "version",
        bundleId,
      }))
    ) {
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    await Promise.all([
      appInfoLocalizationId ? asc.deleteAppInfoLocalization(appInfoLocalizationId) : Promise.resolve(),
      versionLocalizationId ? asc.deleteVersionLocalization(versionLocalizationId) : Promise.resolve(),
    ]);

    await invalidateVersionCache(bundleId);

    res.json({ ok: true });
  }),
);

ascRouter.post(
  "/versions/localizations/translate",
  bundleAccess("body"),
  handle("translateLocalization", async (req, res) => {
    const {
      bundleId,
      versionId,
      targetLocale,
      sourceLocale,
      sourceFields,
      appInfoLocalizationId,
      versionLocalizationId,
      extraFields,
    } = req.body as {
      bundleId: string;
      versionId?: string;
      targetLocale: string;
      sourceLocale: string;
      sourceFields: {
        name?: string;
        subtitle?: string;
        keywords?: string;
        description?: string;
        promotionalText?: string;
        whatsNew?: string;
      };
      appInfoLocalizationId?: string | null;
      versionLocalizationId?: string | null;
      extraFields?: {
        privacyPolicyUrl?: string;
        supportUrl?: string;
        marketingUrl?: string;
      };
    };

    if (!versionId || !targetLocale || !sourceLocale || !sourceFields) {
      res.status(400).json({
        error: "versionId, targetLocale, sourceLocale, and sourceFields are required",
      });

      return;
    }

    if (!(await loadVersionInBundle(res, versionId, bundleId))) return;

    if (
      appInfoLocalizationId &&
      !(await loadVersionLocalizationInBundle(res, {
        ascLocalizationId: appInfoLocalizationId,
        kind: "appInfo",
        bundleId,
      }))
    ) {
      return;
    }

    if (
      versionLocalizationId &&
      !(await loadVersionLocalizationInBundle(res, {
        ascLocalizationId: versionLocalizationId,
        kind: "version",
        bundleId,
      }))
    ) {
      return;
    }

    const teamId = req.user!.teamId;

    if (translationTracker.isTranslating(versionId, targetLocale)) {
      res.status(409).json({ error: `Translation for ${targetLocale} already in progress` });

      return;
    }

    translationTracker.add(versionId, targetLocale);

    const data: TranslateLocalizationData = {
      teamId,
      bundleId,
      versionId,
      sourceLocale,
      targetLocale,
      appInfoLocalizationId: appInfoLocalizationId ?? null,
      versionLocalizationId: versionLocalizationId ?? null,
      sourceFields,
      extraFields,
    };

    try {
      await bossScheduler.sendJob(TRANSLATE_LOCALIZATION_QUEUE, data);
    } catch (err) {
      translationTracker.remove(versionId, targetLocale);
      throw err;
    }

    res.json({ ok: true, queued: true, locale: targetLocale });
  }),
);

ascRouter.get(
  "/versions/translations/status",
  handle("translationStatus", async (req, res) => {
    const versionId = req.query.versionId as string | undefined;

    if (!versionId) {
      res.status(400).json({ error: "versionId required" });
      return;
    }

    res.json({
      versionId,
      translatingLocales: translationTracker.getLocales(versionId),
    });
  }),
);

ascRouter.post(
  "/versions",
  bundleAccess("body"),
  handle("createVersion", async (req, res) => {
    const { bundleId, versionString, releaseType } = req.body as {
      bundleId: string;
      versionString: string;
      releaseType?: "MANUAL" | "AFTER_APPROVAL";
    };

    if (!versionString) {
      res.status(400).json({ error: "versionString is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const version = await asc.createNewVersion(app.id, versionString, releaseType ?? "MANUAL");

    res.json({
      versionId: version.id,
      versionString: version.attributes.versionString,
      appStoreState: version.attributes.appStoreState,
      platform: version.attributes.platform,
      isEditable: true,
    });
  }),
);

ascRouter.get(
  "/subscriptions/groups",
  bundleAccess("query"),
  handle("listSubscriptionGroups", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const { data: resp } = await asc.client.get(`/apps/${app.id}/subscriptionGroups`, {
      params: {
        include: "subscriptions",
        "fields[subscriptionGroups]": "referenceName,subscriptions",
        "fields[subscriptions]": "name,productId,familySharable,state,subscriptionPeriod,reviewNote,groupLevel",
        "limit[subscriptions]": 50,
        limit: 200,
      },
    });

    const included: any[] = resp.included ?? [];
    const subMap = new Map<string, any>(included.map((s: any) => [s.id, s]));

    const groups = (resp.data ?? []).map((g: any) => ({
      id: g.id,
      referenceName: g.attributes?.referenceName ?? "",
      subscriptions: (g.relationships?.subscriptions?.data ?? [])
        .map((ref: any) => {
          const s = subMap.get(ref.id);
          if (!s) return null;

          return {
            id: s.id,
            name: s.attributes?.name ?? "",
            productId: s.attributes?.productId ?? "",
            familySharable: s.attributes?.familySharable ?? false,
            state: s.attributes?.state ?? "",
            subscriptionPeriod: s.attributes?.subscriptionPeriod ?? null,
            reviewNote: s.attributes?.reviewNote ?? null,
            groupLevel: s.attributes?.groupLevel ?? null,
          };
        })
        .filter(Boolean),
    }));

    res.json(groups);
  }),
);
