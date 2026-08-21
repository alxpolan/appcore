import { Router, type Request, type Response, type RequestHandler } from "express";
import axios from "../../services/utils/http";
import { prisma, logger } from "../../config";
import { requireAuth, bundleAccess, loadVersionInBundle, loadVersionLocalizationInBundle } from "../auth";
import { AppStoreConnectClient } from "../../services/appstore-connect";
import { LOCALE_MAP } from "../../services/utils/country_lang";
import { priceMultiplierFor } from "../../services/utils/price-multipliers";
import { bossScheduler } from "../../jobs/boss";
import {
  QUEUE_NAME as TRANSLATE_LOCALIZATION_QUEUE,
  type TranslateLocalizationData,
} from "../../jobs/workers/translate-localization.worker";
import * as translationTracker from "../../jobs/translation-tracker";
import { runQuickScan } from "./quick-scan";
import { evaluateLocalizationQuality, isFirstVersionLocalizationSet } from "../lib/localization-quality";

export const ascRouter = Router();
ascRouter.use(requireAuth);

const CACHE_TTL_MS = 5 * 60 * 1000;

const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "PENDING_DEVELOPER_RELEASE",
]);

function isFresh(syncedAt: Date): boolean {
  return Date.now() - syncedAt.getTime() < CACHE_TTL_MS;
}

function isDemoBundle(bundleId: string | undefined | null): boolean {
  return typeof bundleId === "string" && bundleId.startsWith("com.marteso.demo.");
}

function toLocalizationResponse(l: any) {
  return {
    locale: l.locale,
    appInfoLocalizationId: l.appInfoLocalizationId,
    versionLocalizationId: l.versionLocalizationId,
    name: l.name,
    subtitle: l.subtitle,
    description: l.description,
    keywords: l.keywords,
    whatsNew: l.whatsNew,
    promotionalText: l.promotionalText,
    supportUrl: l.supportUrl,
    marketingUrl: l.marketingUrl,
    privacyPolicyUrl: l.privacyPolicyUrl,
  };
}

function toLocalizationSummaries(localizations: any[]) {
  const isFirstVersion = isFirstVersionLocalizationSet(localizations);
  return localizations.map((l) => {
    const quality = evaluateLocalizationQuality(l, isFirstVersion);
    return {
      locale: l.locale,
      appInfoLocalizationId: l.appInfoLocalizationId,
      versionLocalizationId: l.versionLocalizationId,
      isComplete: quality.isComplete,
      isOptimal: quality.isOptimal,
      // Why a locale is yellow (non-optimal) or gray (incomplete); empty when green.
      qualityReasons: quality.reasons,
    };
  });
}

function pickInitialLocale(
  localizations: Array<{ locale: string }>,
  requestedLocale?: string,
  primaryLocale?: string | null,
): string | null {
  if (requestedLocale && localizations.some((l) => l.locale === requestedLocale)) return requestedLocale;
  if (primaryLocale && localizations.some((l) => l.locale === primaryLocale)) return primaryLocale;
  if (localizations.some((l) => l.locale === "en-US")) return "en-US";
  return localizations[0]?.locale ?? null;
}

function handle(label: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const ascErrors = err?.response?.data?.errors;
      logger.error(`ASC ${label} failed`, ascErrors ?? err);
      const detail =
        ascErrors?.map((e: any) => e.detail ?? e.title).filter(Boolean).join("; ") ||
        err?.message ||
        "An error occurred. Please try again.";
      res.status(500).json({ error: detail, _debug: { label, ascErrors: ascErrors ?? null } });
    }
  };
}

async function tryCreateLocalization<T>(
  label: string,
  locale: string,
  fn: () => Promise<T>,
  swallowCodes: number[] = [],
): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("409")) {
      logger.info(`${label}: locale ${locale} already exists in ASC (409), will try fallback lookup`);
      return null;
    }
    const swallowed = swallowCodes.find((c) => msg.includes(String(c)));
    if (swallowed) {
      logger.warn(`${label}: locale ${locale} creation returned ${swallowed} — ${msg.split("\n")[0]}`);
      return null;
    }
    throw err;
  }
}

async function upsertVersionsToDb(
  bundleId: string,
  ascAppId: string,
  appName: string,
  versions: Array<{
    id: string;
    attributes: {
      versionString: string;
      appStoreState: string;
      platform: string;
      releaseType?: string;
    };
  }>,
): Promise<void> {
  await Promise.all(
    versions.map((v) =>
      prisma.appStoreVersion.upsert({
        where: { id: v.id },
        create: {
          id: v.id,
          bundleId,
          ascAppId,
          appName,
          versionString: v.attributes.versionString,
          appStoreState: v.attributes.appStoreState,
          platform: v.attributes.platform,
          releaseType: v.attributes.releaseType ?? null,
          syncedAt: new Date(),
        },
        update: {
          appStoreState: v.attributes.appStoreState,
          versionString: v.attributes.versionString,
          syncedAt: new Date(),
        },
      }),
    ),
  );
}

async function upsertVersionDetailToDb(
  bundleId: string,
  ascAppId: string,
  appName: string,
  version: {
    id: string;
    attributes: {
      versionString: string;
      appStoreState: string;
      platform: string;
      releaseType?: string;
    };
  },
  localizations: Array<{
    locale: string;
    appInfoLocalizationId: string | null;
    versionLocalizationId: string | null;
    name: string;
    subtitle: string;
    description: string;
    keywords: string;
    whatsNew: string;
    promotionalText: string;
    supportUrl: string;
    marketingUrl: string;
    privacyPolicyUrl: string;
  }>,
  copyright?: string | null,
  ageRating?: string | null,
): Promise<void> {
  await prisma.appStoreVersion.upsert({
    where: { id: version.id },
    create: {
      id: version.id,
      bundleId,
      ascAppId,
      appName,
      versionString: version.attributes.versionString,
      appStoreState: version.attributes.appStoreState,
      platform: version.attributes.platform,
      releaseType: version.attributes.releaseType ?? null,
      copyright: copyright ?? null,
      ageRating: ageRating ?? null,
      syncedAt: new Date(),
    },
    update: {
      appStoreState: version.attributes.appStoreState,
      versionString: version.attributes.versionString,
      copyright: copyright !== undefined ? (copyright ?? null) : undefined,
      ageRating: ageRating !== undefined ? (ageRating ?? null) : undefined,
      syncedAt: new Date(),
    },
  });

  const existing = await prisma.appStoreVersion.findUnique({
    where: { id: version.id },
    select: { reviewerFirstName: true, reviewDetailId: true },
  });

  if (!existing?.reviewerFirstName && !existing?.reviewDetailId) {
    const app = await prisma.app.findUnique({
      where: { bundleId },
      select: { teamId: true },
    });

    if (app?.teamId) {
      const ts = await prisma.teamSettings.findUnique({
        where: { teamId: app.teamId },
        select: {
          presetCopyright: true,
          reviewerFirstName: true,
          reviewerLastName: true,
          reviewerPhone: true,
          reviewerEmail: true,
          reviewerDemoAccountRequired: true,
          reviewerDemoUsername: true,
          reviewerDemoPassword: true,
        },
      });

      if (ts) {
        await prisma.appStoreVersion.update({
          where: { id: version.id },
          data: {
            copyright: copyright ?? ts.presetCopyright ?? null,
            reviewerFirstName: ts.reviewerFirstName ?? null,
            reviewerLastName: ts.reviewerLastName ?? null,
            reviewerPhone: ts.reviewerPhone ?? null,
            reviewerEmail: ts.reviewerEmail ?? null,
            reviewerDemoAccountRequired: ts.reviewerDemoAccountRequired ?? false,
            reviewerDemoUsername: ts.reviewerDemoUsername ?? null,
            reviewerDemoPassword: ts.reviewerDemoPassword ?? null,
          },
        });
      }
    }
  }

  await Promise.all(
    localizations.map((loc) =>
      prisma.appStoreVersionLocalization.upsert({
        where: {
          versionId_locale: { versionId: version.id, locale: loc.locale },
        },
        create: { versionId: version.id, ...loc },
        update: { ...loc },
      }),
    ),
  );

  await prisma.appStoreVersionLocalization.deleteMany({
    where: {
      versionId: version.id,
      locale: { notIn: localizations.map((loc) => loc.locale) },
    },
  });
}

async function invalidateVersionCache(bundleId: string): Promise<void> {
  await prisma.appStoreVersion
    .updateMany({
      where: { bundleId },
      data: { syncedAt: new Date(0) },
    })
    .catch(() => {});
}

async function ascClientForUser(userId: string): Promise<AppStoreConnectClient> {
  const membership = await prisma.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  const s = membership
    ? await prisma.teamSettings.findUnique({
        where: { teamId: membership.teamId },
      })
    : null;
  if (s?.ascIssuerId && s?.ascKeyId && s?.ascPrivateKey) {
    return new AppStoreConnectClient(
      { issuerId: s.ascIssuerId, keyId: s.ascKeyId, privateKey: s.ascPrivateKey },
      { teamId: membership?.teamId },
    );
  }
  return new AppStoreConnectClient();
}

ascRouter.get(
  "/apps",
  handle("listApps", async (req, res) => {
    const apps = await ascClientForUser(req.user!.userId).then((c) => c.listApps());
    const iconMap = new Map<string, string>();

    if (apps.length > 0) {
      try {
        const ids = apps.map((a) => a.id).join(",");
        const { data } = await axios.get(`https://itunes.apple.com/lookup?id=${ids}`);
        for (const r of data.results ?? []) {
          if (r.trackId && r.artworkUrl100) {
            iconMap.set(String(r.trackId), (r.artworkUrl100 as string).replace("100x100", "200x200"));
          }
        }
      } catch {
        // icons are optional
      }
    }

    res.json(
      apps.map((a) => ({
        ascId: a.id,
        name: a.attributes.name,
        bundleId: a.attributes.bundleId,
        sku: a.attributes.sku ?? null,
        primaryLocale: a.attributes.primaryLocale ?? null,
        iconUrl: iconMap.get(a.id) ?? null,
      })),
    );
  }),
);

ascRouter.get(
  "/store-search",
  handle("storeSearch", async (req, res) => {
    const q = ((req.query.q as string) ?? "").trim();

    if (!q) {
      res.json([]);
      return;
    }

    const { AppStoreScraper } = await import("../../services/appstore-scraper");
    const scraper = new AppStoreScraper("us");
    const isUrl = /https?:\/\//i.test(q);
    const idMatch = q.match(/id(\d{5,})/) ?? q.match(/\/(\d{5,})(?:[/?#]|$)/);

    let results;
    if (isUrl && idMatch) {
      const app = await scraper.lookupByTrackId(Number(idMatch[1]));
      results = app ? [app] : [];
    } else {
      results = await scraper.searchApps(q, 8);
    }

    res.json(
      results.map((r) => ({
        trackId: String(r.trackId),
        name: r.trackName,
        bundleId: r.bundleId,
        sellerName: r.sellerName,
        iconUrl: r.artworkUrl512 ?? null,
        rating: r.averageUserRating ?? null,
        ratingsCount: r.userRatingCount ?? null,
        genre: r.primaryGenreName ?? null,
      })),
    );
  }),
);

ascRouter.post(
  "/import",
  handle("import", async (req, res) => {
    const { ascId, bundleId, name } = req.body as {
      ascId?: string;
      bundleId?: string;
      name?: string;
    };

    if (!ascId || !bundleId || !name) {
      res.status(400).json({ error: "ascId, bundleId and name are required" });
      return;
    }

    const teamId = req.user!.teamId;
    const existing = await prisma.app.findUnique({ where: { bundleId } });

    if (existing && existing.teamId && existing.teamId !== teamId && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "App is owned by another team" });
      return;
    }

    const app = await prisma.app.upsert({
      where: { bundleId },
      create: {
        bundleId,
        name,
        trackId: BigInt(ascId),
        isOwnApp: true,
        country: "us",
        teamId,
      },
      update: {
        name,
        trackId: BigInt(ascId),
        isOwnApp: true,
        teamId,
      },
    });

    res.json({
      ok: true,
      app: {
        id: app.id,
        name: app.name,
        bundleId: app.bundleId,
        trackId: app.trackId?.toString() ?? null,
        isOwnApp: app.isOwnApp,
      },
    });

    const { fillDisplayNameFromTitle } = await import("../../services/utils/app-display-name");
    await fillDisplayNameFromTitle(app.id, name);

    const { AppStoreScraper } = await import("../../services/appstore-scraper");
    await new AppStoreScraper(app.country, undefined, bundleId).runFullScrapeJob();

    logger.info(`Post-import scrape completed for ${bundleId}`);
  }),
);

ascRouter.get("/scan", bundleAccess("query"), handle("scan", runQuickScan));

ascRouter.get(
  "/versions/list",
  bundleAccess("query"),
  handle("listVersions", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const refresh = req.query.refresh === "true";

    const demoBundle = isDemoBundle(bundleId);
    if (!refresh || demoBundle) {
      const cached = await prisma.appStoreVersion.findMany({
        where: { bundleId },
        orderBy: { syncedAt: "desc" },
      });
      if (cached.length > 0 && (demoBundle || isFresh(cached[0].syncedAt))) {
        res.json(
          cached.map((v) => ({
            versionId: v.id,
            versionString: v.versionString,
            appStoreState: v.appStoreState,
            platform: v.platform,
            isEditable: EDITABLE_STATES.has(v.appStoreState),
          })),
        );
        return;
      }
    }

    if (demoBundle) {
      res.json([]);
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const versions = await asc.listVersions(app.id);
    await upsertVersionsToDb(app.attributes.bundleId, app.id, app.attributes.name, versions);

    res.json(
      versions.map((v) => ({
        versionId: v.id,
        versionString: v.attributes.versionString,
        appStoreState: v.attributes.appStoreState,
        platform: v.attributes.platform,
        isEditable: EDITABLE_STATES.has(v.attributes.appStoreState),
      })),
    );
  }),
);

ascRouter.get(
  "/versions",
  bundleAccess("query"),
  handle("getVersions", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const versionId = (req.query.versionId as string) || undefined;
    const requestedLocale = (req.query.locale as string) || undefined;
    const refresh = req.query.refresh === "true";

    const demoBundle = isDemoBundle(bundleId);
    if (!refresh || demoBundle) {
      let cached: any = null;
      const sinceFilter = demoBundle ? undefined : new Date(Date.now() - CACHE_TTL_MS);
      if (versionId) {
        cached = await prisma.appStoreVersion.findFirst({
          where: { id: versionId, bundleId },
          include: { localizations: true },
        });
        if (cached && !demoBundle && !isFresh(cached.syncedAt)) cached = null;
      } else if (bundleId) {
        cached = await prisma.appStoreVersion.findFirst({
          where: {
            bundleId,
            appStoreState: { in: [...EDITABLE_STATES] },
            ...(sinceFilter ? { syncedAt: { gte: sinceFilter } } : {}),
          },
          include: { localizations: true },
          orderBy: { syncedAt: "desc" },
        });
        if (!cached) {
          cached = await prisma.appStoreVersion.findFirst({
            where: {
              bundleId,
              ...(sinceFilter ? { syncedAt: { gte: sinceFilter } } : {}),
            },
            include: { localizations: true },
            orderBy: { syncedAt: "desc" },
          });
        }
      }

      if (cached && cached.localizations.length > 0) {
        let primaryLocale: string | null = null;
        if (!requestedLocale && bundleId && !demoBundle) {
          const asc = await ascClientForUser(req.user!.userId);
          const app = await asc.getApp(bundleId).catch(() => null);
          primaryLocale = app?.attributes.primaryLocale ?? null;
        }
        const selectedLocale = pickInitialLocale(cached.localizations, requestedLocale, primaryLocale);
        const selectedLocalizations = selectedLocale
          ? cached.localizations.filter((l: any) => l.locale === selectedLocale)
          : [];
        res.json({
          appId: cached.ascAppId,
          appName: cached.appName,
          bundleId: cached.bundleId,
          primaryLocale,
          versionId: cached.id,
          versionString: cached.versionString,
          appStoreState: cached.appStoreState,
          isEditable: EDITABLE_STATES.has(cached.appStoreState),
          translatingLocales: translationTracker.getLocales(cached.id),
          copyright: cached.copyright ?? "",
          ageRating: cached.ageRating ?? undefined,
          reviewerFirstName: cached.reviewerFirstName ?? "",
          reviewerLastName: cached.reviewerLastName ?? "",
          reviewerPhone: cached.reviewerPhone ?? "",
          reviewerEmail: cached.reviewerEmail ?? "",
          reviewerDemoAccountRequired: cached.reviewerDemoAccountRequired ?? false,
          reviewerDemoUsername: cached.reviewerDemoUsername ?? "",
          reviewerDemoPassword: cached.reviewerDemoPassword ?? "",
          reviewDetailId: cached.reviewDetailId ?? null,
          localizationSummaries: toLocalizationSummaries(cached.localizations),
          localizations: selectedLocalizations.map(toLocalizationResponse),
        });
        return;
      }
    }

    if (demoBundle) {
      res.status(404).json({ error: "Demo app version cache not populated" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const appInfoLocalizations = await asc.getAppInfoLocalizations(app.id);

    let version: {
      id: string;
      attributes: {
        versionString: string;
        appStoreState: string;
        platform: string;
        releaseType: string;
        copyright?: string;
      };
    } | null = null;

    if (versionId) {
      const allVersions = await asc.listVersions(app.id);
      version = allVersions.find((v) => v.id === versionId) ?? null;
    } else {
      version = await asc.getEditableVersion(app.id);
      if (!version) version = await asc.getLiveVersion(app.id);
    }

    const isEditable = version ? EDITABLE_STATES.has(version.attributes.appStoreState) : false;

    let versionLocalizations: any[] = [];
    if (version) {
      versionLocalizations = await asc.getVersionLocalizations(version.id);
    }

    const localeMap = new Map<string, any>();
    const appInfoById = new Map(appInfoLocalizations.map((info: any) => [info.attributes.locale, info]));

    for (const vl of versionLocalizations) {
      const loc = vl.attributes.locale;
      const existing = localeMap.get(loc);
      const appInfo = appInfoById.get(loc) as any | undefined;
      localeMap.set(loc, {
        locale: loc,
        appInfoLocalizationId: existing?.appInfoLocalizationId ?? appInfo?.id ?? null,
        name: existing?.name ?? appInfo?.attributes.name ?? "",
        subtitle: existing?.subtitle ?? appInfo?.attributes.subtitle ?? "",
        privacyPolicyUrl: existing?.privacyPolicyUrl ?? appInfo?.attributes.privacyPolicyUrl ?? "",
        versionLocalizationId: vl.id,
        description: vl.attributes.description ?? "",
        keywords: vl.attributes.keywords ?? "",
        whatsNew: vl.attributes.whatsNew ?? "",
        promotionalText: vl.attributes.promotionalText ?? "",
        supportUrl: vl.attributes.supportUrl ?? "",
        marketingUrl: vl.attributes.marketingUrl ?? "",
      });
    }

    const localizations = Array.from(localeMap.values());
    const selectedLocale = pickInitialLocale(localizations, requestedLocale, app.attributes.primaryLocale);

    if (version) {
      await upsertVersionDetailToDb(app.attributes.bundleId, app.id, app.attributes.name, version, localizations);
    }

    res.json({
      appId: app.id,
      appName: app.attributes.name,
      bundleId: app.attributes.bundleId,
      primaryLocale: app.attributes.primaryLocale ?? null,
      versionId: version?.id ?? null,
      versionString: version?.attributes.versionString ?? null,
      appStoreState: version?.attributes.appStoreState ?? null,
      isEditable,
      translatingLocales: version ? translationTracker.getLocales(version.id) : [],
      copyright: version?.attributes.copyright ?? "",
      localizationSummaries: toLocalizationSummaries(localizations),
      localizations: selectedLocale ? localizations.filter((l) => l.locale === selectedLocale) : [],
    });
  }),
);

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

ascRouter.post(
  "/subscriptions/groups",
  bundleAccess("body"),
  handle("createSubscriptionGroup", async (req, res) => {
    const { bundleId, referenceName } = req.body as {
      bundleId: string;
      referenceName?: string;
    };
    if (!referenceName) {
      res.status(400).json({ error: "referenceName is required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);
    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const { data: resp } = await asc.client.post("/subscriptionGroups", {
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName },
        relationships: {
          app: { data: { type: "apps", id: app.id } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      subscriptions: [],
    });
  }),
);

ascRouter.patch(
  "/subscriptions/groups/:id",
  handle("updateSubscriptionGroup", async (req, res) => {
    const { id } = req.params;
    const { referenceName } = req.body as { referenceName?: string };
    if (!referenceName) {
      res.status(400).json({ error: "referenceName is required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.patch(`/subscriptionGroups/${id}`, {
      data: {
        type: "subscriptionGroups",
        id,
        attributes: { referenceName },
      },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/groups/:id",
  handle("deleteSubscriptionGroup", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptionGroups/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/groups/:id/localizations",
  handle("listSubscriptionGroupLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptionGroups/${id}/subscriptionGroupLocalizations`, {
      params: {
        "fields[subscriptionGroupLocalizations]": "name,customAppName,locale,state",
        limit: 50,
      },
    });
    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        customAppName: l.attributes?.customAppName ?? null,
        state: l.attributes?.state ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/subscriptions/groups/localizations",
  handle("createSubscriptionGroupLocalization", async (req, res) => {
    const { groupId, locale, name, customAppName } = req.body as {
      groupId?: string;
      locale?: string;
      name?: string;
      customAppName?: string;
    };
    if (!groupId || !locale || !name) {
      res.status(400).json({ error: "groupId, locale and name are required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionGroupLocalizations", {
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: { locale, name, ...(customAppName ? { customAppName } : {}) },
        relationships: {
          subscriptionGroup: {
            data: { type: "subscriptionGroups", id: groupId },
          },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      customAppName: resp.data.attributes?.customAppName ?? customAppName ?? null,
      state: resp.data.attributes?.state ?? "",
    });
  }),
);

ascRouter.patch(
  "/subscriptions/groups/localizations/:id",
  handle("updateSubscriptionGroupLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, customAppName } = req.body as {
      name?: string;
      customAppName?: string;
    };
    const attributes: Record<string, any> = {};
    if (name !== undefined) attributes.name = name;
    if (customAppName !== undefined) attributes.customAppName = customAppName;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.patch(`/subscriptionGroupLocalizations/${id}`, {
      data: { type: "subscriptionGroupLocalizations", id, attributes },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/groups/localizations/:id",
  handle("deleteSubscriptionGroupLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptionGroupLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.post(
  "/subscriptions",
  handle("createSubscription", async (req, res) => {
    const { groupId, name, productId, familySharable, subscriptionPeriod, groupLevel, reviewNote } = req.body as {
      groupId?: string;
      name?: string;
      productId?: string;
      familySharable?: boolean;
      subscriptionPeriod?: string;
      groupLevel?: number;
      reviewNote?: string;
    };
    if (!groupId || !name || !productId || !subscriptionPeriod) {
      res.status(400).json({
        error: "groupId, name, productId and subscriptionPeriod are required",
      });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptions", {
      data: {
        type: "subscriptions",
        attributes: {
          name,
          productId,
          familySharable: familySharable ?? false,
          subscriptionPeriod,
          ...(groupLevel != null ? { groupLevel } : {}),
          ...(reviewNote ? { reviewNote } : {}),
        },
        relationships: {
          group: { data: { type: "subscriptionGroups", id: groupId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      name: resp.data.attributes?.name ?? name,
      productId: resp.data.attributes?.productId ?? productId,
      familySharable: resp.data.attributes?.familySharable ?? false,
      state: resp.data.attributes?.state ?? "",
      subscriptionPeriod: resp.data.attributes?.subscriptionPeriod ?? subscriptionPeriod,
      reviewNote: resp.data.attributes?.reviewNote ?? null,
      groupLevel: resp.data.attributes?.groupLevel ?? null,
    });
  }),
);

ascRouter.patch(
  "/subscriptions/:id",
  handle("updateSubscription", async (req, res) => {
    const { id } = req.params;
    const { name, familySharable, subscriptionPeriod, reviewNote, groupLevel } = req.body as {
      name?: string;
      familySharable?: boolean;
      subscriptionPeriod?: string;
      reviewNote?: string;
      groupLevel?: number;
    };

    const attributes: Record<string, any> = {};
    if (name !== undefined) attributes.name = name;
    if (familySharable !== undefined) attributes.familySharable = familySharable;
    if (subscriptionPeriod !== undefined) attributes.subscriptionPeriod = subscriptionPeriod;
    if (reviewNote !== undefined) attributes.reviewNote = reviewNote;
    if (groupLevel !== undefined) attributes.groupLevel = groupLevel;

    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.patch(`/subscriptions/${id}`, {
      data: { type: "subscriptions", id, attributes },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/:id",
  handle("deleteSubscription", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptions/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/:id/localizations",
  handle("listSubscriptionLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/subscriptionLocalizations`, {
      params: {
        "fields[subscriptionLocalizations]": "name,locale,description,state",
        limit: 200,
      },
    });
    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        description: l.attributes?.description ?? "",
        state: l.attributes?.state ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/subscriptions/localizations",
  handle("createSubscriptionLocalization", async (req, res) => {
    const { subscriptionId, locale, name, description } = req.body as {
      subscriptionId?: string;
      locale?: string;
      name?: string;
      description?: string;
    };
    if (!subscriptionId || !locale || !name) {
      res.status(400).json({ error: "subscriptionId, locale and name are required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionLocalizations", {
      data: {
        type: "subscriptionLocalizations",
        attributes: { locale, name, ...(description ? { description } : {}) },
        relationships: {
          subscription: {
            data: { type: "subscriptions", id: subscriptionId },
          },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      description: resp.data.attributes?.description ?? description ?? "",
      state: resp.data.attributes?.state ?? "",
    });
  }),
);

ascRouter.patch(
  "/subscriptions/localizations/:id",
  handle("updateSubscriptionLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body as {
      name?: string;
      description?: string;
    };
    const attributes: Record<string, any> = {};
    if (name !== undefined) attributes.name = name;
    if (description !== undefined) attributes.description = description;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.patch(`/subscriptionLocalizations/${id}`, {
      data: { type: "subscriptionLocalizations", id, attributes },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/localizations/:id",
  handle("deleteSubscriptionLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptionLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/:id/price-points",
  handle("listSubscriptionPricePoints", async (req, res) => {
    const { id } = req.params;
    const territory = (req.query.territory as string) || undefined;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/pricePoints`, {
      params: {
        include: "territory",
        "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
        "fields[territories]": "currency",
        ...(territory ? { "filter[territory]": territory } : {}),
        limit: 8000,
      },
    });
    const included: any[] = resp.included ?? [];
    const terrMap = new Map<string, any>(included.map((t: any) => [t.id, t]));
    res.json(
      (resp.data ?? []).map((pp: any) => {
        const terrId = pp.relationships?.territory?.data?.id ?? null;
        const terr = terrId ? terrMap.get(terrId) : null;
        return {
          id: pp.id,
          customerPrice: pp.attributes?.customerPrice ?? null,
          proceeds: pp.attributes?.proceeds ?? null,
          territory: terrId,
          currency: terr?.attributes?.currency ?? null,
        };
      }),
    );
  }),
);

async function fetchSubscriptionPrices(asc: AppStoreConnectClient, subscriptionId: string): Promise<any[]> {
  const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/prices`, {
    params: {
      include: "territory,subscriptionPricePoint",
      "fields[subscriptionPrices]": "startDate,preserved,territory,subscriptionPricePoint",
      "fields[territories]": "currency",
      "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
      limit: 200,
    },
  });
  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>(
    included.filter((i: any) => i.type === "territories").map((t: any) => [t.id, t]),
  );
  const ppMap = new Map<string, any>(
    included.filter((i: any) => i.type === "subscriptionPricePoints").map((pp: any) => [pp.id, pp]),
  );
  return (resp.data ?? []).map((p: any) => {
    const terrId = p.relationships?.territory?.data?.id ?? null;
    const ppId = p.relationships?.subscriptionPricePoint?.data?.id ?? null;
    const terr = terrId ? terrMap.get(terrId) : null;
    const pp = ppId ? ppMap.get(ppId) : null;
    return {
      id: p.id,
      territory: terrId,
      currency: terr?.attributes?.currency ?? null,
      customerPrice: pp?.attributes?.customerPrice ?? null,
      proceeds: pp?.attributes?.proceeds ?? null,
      pricePointId: ppId,
      startDate: p.attributes?.startDate ?? null,
      preserved: p.attributes?.preserved ?? false,
    };
  });
}

ascRouter.get(
  "/subscriptions/:id/prices",
  handle("listSubscriptionPrices", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    res.json(await fetchSubscriptionPrices(asc, String(id)));
  }),
);

ascRouter.post(
  "/subscriptions/prices",
  handle("createSubscriptionPrice", async (req, res) => {
    const { subscriptionId, pricePointId, territory, startDate, preserveCurrentPrice } = req.body as {
      subscriptionId?: string;
      pricePointId?: string;
      territory?: string;
      startDate?: string | null;
      preserveCurrentPrice?: boolean;
    };
    if (!subscriptionId || !pricePointId) {
      res.status(400).json({ error: "subscriptionId and pricePointId are required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        attributes: {
          ...(startDate !== undefined ? { startDate } : {}),
          ...(preserveCurrentPrice !== undefined ? { preserveCurrentPrice } : {}),
        },
        relationships: {
          subscription: {
            data: { type: "subscriptions", id: subscriptionId },
          },
          subscriptionPricePoint: {
            data: { type: "subscriptionPricePoints", id: pricePointId },
          },
          ...(territory ? { territory: { data: { type: "territories", id: territory } } } : {}),
        },
      },
    });
    res.status(201).json({ id: resp.data.id, ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/prices/:id",
  handle("deleteSubscriptionPrice", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptionPrices/${id}`);
    res.json({ ok: true });
  }),
);

// ---- Smart pricing (purchasing-power based suggestions from a USA base price) ----

const SMART_PRICING_BASE_TERRITORY = "USA";

interface EqualizedPricePoint {
  id: string;
  customerPrice: string | null;
  proceeds: string | null;
  territory: string | null;
  currency: string | null;
}

function nearestPricePoint(
  catalog: Array<{ id: string; customerPrice: string | null }>,
  target: number,
): { id: string; customerPrice: string | null } | null {
  let best: { id: string; customerPrice: string | null } | null = null;
  let bestDiff = Infinity;
  for (const point of catalog) {
    const price = Number(point.customerPrice);
    if (!Number.isFinite(price)) continue;
    const diff = Math.abs(price - target);
    // Prefer the cheaper point on ties so suggestions never round up ambiguously.
    if (diff < bestDiff || (diff === bestDiff && best && price < Number(best.customerPrice))) {
      best = point;
      bestDiff = diff;
    }
  }
  return best;
}

async function buildSmartPriceRows(opts: {
  basePricePointId: string;
  baseCatalog: Array<{ id: string; customerPrice: string | null }>;
  currentByTerritory: Map<
    string,
    { pricePointId: string | null; customerPrice: string | null; currency: string | null }
  >;
  fetchEqualizations: (pricePointId: string) => Promise<EqualizedPricePoint[]>;
}) {
  const basePoint = opts.baseCatalog.find((p) => p.id === opts.basePricePointId);
  const basePrice = Number(basePoint?.customerPrice);
  if (!basePoint || !Number.isFinite(basePrice)) {
    throw new Error("Base price point not found in the USA price point catalog");
  }

  // Only snap to the classic x.99 tiers. The full catalog contains odd in-between
  // steps (1.09, 1.25, ...) whose equalized local prices look arbitrary in stores.
  const charmCatalog = opts.baseCatalog.filter((p) => p.customerPrice?.endsWith(".99"));
  const snapCatalog = charmCatalog.length > 0 ? charmCatalog : opts.baseCatalog;

  // One equalizations call for the base point yields Apple's exchange-rate
  // parity price in every available territory and doubles as the territory list.
  const baseEqualizations = await opts.fetchEqualizations(opts.basePricePointId);
  const parityByTerritory = new Map<string, EqualizedPricePoint>();
  const territoryGroups = new Map<string, string[]>();
  for (const point of baseEqualizations) {
    if (!point.territory || point.territory === SMART_PRICING_BASE_TERRITORY) continue;
    parityByTerritory.set(point.territory, point);
    const multiplier = priceMultiplierFor(point.territory);
    const targetPoint = nearestPricePoint(snapCatalog, basePrice * multiplier);
    if (!targetPoint) continue;
    const group = territoryGroups.get(targetPoint.id) ?? [];
    group.push(point.territory);
    territoryGroups.set(targetPoint.id, group);
  }

  // Multipliers come from a small discrete set, so distinct target tiers stay
  // in the low double digits regardless of how many territories exist.
  const suggestedByTerritory = new Map<string, EqualizedPricePoint>();
  await Promise.all(
    [...territoryGroups.entries()].map(async ([targetPointId, territories]) => {
      const equalized =
        targetPointId === opts.basePricePointId ? baseEqualizations : await opts.fetchEqualizations(targetPointId);
      const byTerritory = new Map(equalized.filter((p) => p.territory).map((p) => [p.territory!, p]));
      for (const territory of territories) {
        const point = byTerritory.get(territory) ?? parityByTerritory.get(territory);
        if (point) suggestedByTerritory.set(territory, point);
      }
    }),
  );

  const rows = [...suggestedByTerritory.entries()].map(([territory, suggested]) => {
    const current = opts.currentByTerritory.get(territory) ?? null;
    return {
      territory,
      currency: suggested.currency ?? current?.currency ?? null,
      multiplier: priceMultiplierFor(territory),
      currentPricePointId: current?.pricePointId ?? null,
      currentPrice: current?.customerPrice ?? null,
      suggestedPricePointId: suggested.id,
      suggestedPrice: suggested.customerPrice,
      suggestedProceeds: suggested.proceeds,
      changed: current?.pricePointId !== suggested.id,
    };
  });
  rows.sort((a, b) => a.territory.localeCompare(b.territory));

  const baseCurrent = opts.currentByTerritory.get(SMART_PRICING_BASE_TERRITORY) ?? null;
  rows.unshift({
    territory: SMART_PRICING_BASE_TERRITORY,
    currency: "USD",
    multiplier: 1,
    currentPricePointId: baseCurrent?.pricePointId ?? null,
    currentPrice: baseCurrent?.customerPrice ?? null,
    suggestedPricePointId: basePoint.id,
    suggestedPrice: basePoint.customerPrice,
    suggestedProceeds: null,
    changed: baseCurrent?.pricePointId !== basePoint.id,
  });

  return rows;
}

async function fetchSubscriptionEqualizations(
  asc: AppStoreConnectClient,
  pricePointId: string,
): Promise<EqualizedPricePoint[]> {
  const { data: resp } = await asc.client.get(`/subscriptionPricePoints/${pricePointId}/equalizations`, {
    params: {
      include: "territory",
      "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
      "fields[territories]": "currency",
      limit: 8000,
    },
  });
  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>(
    included.filter((i: any) => i.type === "territories").map((t: any) => [t.id, t]),
  );
  return (resp.data ?? []).map((pp: any) => {
    const terrId = pp.relationships?.territory?.data?.id ?? null;
    return {
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
      proceeds: pp.attributes?.proceeds ?? null,
      territory: terrId,
      currency: terrId ? (terrMap.get(terrId)?.attributes?.currency ?? null) : null,
    };
  });
}

ascRouter.post(
  "/subscriptions/:id/smart-prices",
  handle("previewSubscriptionSmartPrices", async (req, res) => {
    const { id } = req.params;
    const { basePricePointId } = (req.body ?? {}) as { basePricePointId?: string };
    const asc = await ascClientForUser(req.user!.userId);

    const [catalogResp, currentPrices] = await Promise.all([
      asc.client.get(`/subscriptions/${id}/pricePoints`, {
        params: {
          "fields[subscriptionPricePoints]": "customerPrice",
          "filter[territory]": SMART_PRICING_BASE_TERRITORY,
          limit: 8000,
        },
      }),
      fetchSubscriptionPrices(asc, String(id)),
    ]);
    const baseCatalog = (catalogResp.data.data ?? []).map((pp: any) => ({
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
    }));
    const currentByTerritory = new Map<string, any>(
      currentPrices.filter((p: any) => p.territory).map((p: any) => [p.territory, p]),
    );

    const baseId = basePricePointId ?? currentByTerritory.get(SMART_PRICING_BASE_TERRITORY)?.pricePointId;
    if (!baseId) {
      res.status(400).json({ error: "No USA price set. Pick a US base price first." });
      return;
    }

    const rows = await buildSmartPriceRows({
      basePricePointId: baseId,
      baseCatalog,
      currentByTerritory,
      fetchEqualizations: (pointId) => fetchSubscriptionEqualizations(asc, pointId),
    });
    res.json({ baseTerritory: SMART_PRICING_BASE_TERRITORY, basePricePointId: baseId, rows });
  }),
);

ascRouter.post(
  "/subscriptions/prices/bulk",
  handle("bulkCreateSubscriptionPrices", async (req, res) => {
    const { subscriptionId, items, preserveCurrentPrice, startDate } = req.body as {
      subscriptionId?: string;
      items?: Array<{ territory?: string; pricePointId?: string }>;
      preserveCurrentPrice?: boolean;
      startDate?: string;
    };
    if (!subscriptionId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "subscriptionId and a non-empty items array are required" });
      return;
    }
    if (items.some((i) => !i.territory || !i.pricePointId)) {
      res.status(400).json({ error: "Every item needs territory and pricePointId" });
      return;
    }

    // For an already-approved subscription, a price without a startDate is
    // treated as the (immutable) initial price and rejected with "Initial price
    // cannot be created again after subscription is approved." Scheduling the
    // change with a startDate makes it a valid price change. ASC additionally
    // enforces a minimum lead time (~2 days), so today's date is rejected with
    // "a future date is expected, and must be on or after YYYY-MM-DD". Default
    // to today + 2 days, and if ASC still demands a later date, parse it from
    // the error and retry once.
    const daysFromNow = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const defaultStartDate = startDate ?? daysFromNow(2);

    const asc = await ascClientForUser(req.user!.userId);

    const postPrice = (item: { territory?: string; pricePointId?: string }, start: string) =>
      asc.client.post("/subscriptionPrices", {
        data: {
          type: "subscriptionPrices",
          attributes: {
            startDate: start,
            ...(preserveCurrentPrice !== undefined ? { preserveCurrentPrice } : {}),
          },
          relationships: {
            subscription: { data: { type: "subscriptions", id: subscriptionId } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: item.pricePointId! } },
            territory: { data: { type: "territories", id: item.territory! } },
          },
        },
      });

    const results: Array<{ territory: string; ok: boolean; error?: string }> = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          try {
            await postPrice(item, defaultStartDate);
            return { territory: item.territory!, ok: true };
          } catch (err: any) {
            const detail = err?.response?.data?.errors?.[0]?.detail ?? err?.message ?? "Unknown error";
            // ASC tells us the earliest allowed date; retry once with it.
            const requiredDate = /on or after (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1];
            if (requiredDate && requiredDate !== defaultStartDate) {
              try {
                await postPrice(item, requiredDate);
                return { territory: item.territory!, ok: true };
              } catch (retryErr: any) {
                const retryDetail =
                  retryErr?.response?.data?.errors?.[0]?.detail ?? retryErr?.message ?? "Unknown error";
                logger.error(
                  `ASC bulkCreateSubscriptionPrices retry failed for ${item.territory}`,
                  retryErr?.response?.data?.errors ?? retryErr,
                );
                return { territory: item.territory!, ok: false, error: retryDetail };
              }
            }
            logger.error(
              `ASC bulkCreateSubscriptionPrices failed for ${item.territory}`,
              err?.response?.data?.errors ?? err,
            );
            return { territory: item.territory!, ok: false, error: detail };
          }
        }),
      );
      results.push(...chunkResults);
    }
    const failed = results.filter((r) => !r.ok).length;
    res.json({ ok: failed === 0, applied: results.length - failed, failed, results });
  }),
);

ascRouter.get(
  "/subscriptions/:id/review-screenshot",
  handle("getSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/appStoreReviewScreenshot`, {
      params: {
        "fields[subscriptionAppStoreReviewScreenshots]":
          "fileName,fileSize,sourceFileChecksum,imageAsset,assetToken,assetType,uploadOperations,assetDeliveryState",
      },
    });
    if (!resp.data) {
      res.json(null);
      return;
    }
    const d = resp.data;
    const asset = d.attributes?.imageAsset ?? null;
    res.json({
      id: d.id,
      fileName: d.attributes?.fileName ?? null,
      fileSize: d.attributes?.fileSize ?? null,
      assetDeliveryState: d.attributes?.assetDeliveryState ?? null,
      imageUrl: asset?.templateUrl
        ? asset.templateUrl
            .replace("{w}", String(asset.width ?? 320))
            .replace("{h}", String(asset.height ?? 180))
            .replace("{f}", "png")
        : null,
      width: asset?.width ?? null,
      height: asset?.height ?? null,
    });
  }),
);

ascRouter.post(
  "/subscriptions/:id/review-screenshot",
  handle("createSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const { fileName, fileSize, fileData } = req.body as {
      fileName?: string;
      fileSize?: number;
      fileData?: string;
    };
    if (!fileName || !fileSize || !fileData) {
      res.status(400).json({ error: "fileName, fileSize and fileData are required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    const { data: createResp } = await asc.client.post("/subscriptionAppStoreReviewScreenshots", {
      data: {
        type: "subscriptionAppStoreReviewScreenshots",
        attributes: { fileName, fileSize },
        relationships: {
          subscription: { data: { type: "subscriptions", id } },
        },
      },
    });

    const screenshotId = createResp.data.id;
    const uploadOps: any[] = createResp.data.attributes?.uploadOperations ?? [];
    const fileBytes = Buffer.from(fileData, "base64");

    for (const op of uploadOps) {
      const chunk = fileBytes.slice(op.offset, op.offset + op.length);
      await axios.put(op.url, chunk, {
        headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
      });
    }

    await asc.client.patch(`/subscriptionAppStoreReviewScreenshots/${screenshotId}`, {
      data: {
        type: "subscriptionAppStoreReviewScreenshots",
        id: screenshotId,
        attributes: { uploaded: true },
      },
    });

    res.status(201).json({ id: screenshotId, ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/review-screenshots/:id",
  handle("deleteSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/subscriptionAppStoreReviewScreenshots/${id}`);
    res.json({ ok: true });
  }),
);

const ASC_V2 = "https://api.appstoreconnect.apple.com/v2";

function mapProduct(p: any) {
  return {
    id: p.id,
    name: p.attributes?.name ?? "",
    productId: p.attributes?.productId ?? "",
    inAppPurchaseType: p.attributes?.inAppPurchaseType ?? "CONSUMABLE",
    state: p.attributes?.state ?? "",
    reviewNote: p.attributes?.reviewNote ?? null,
  };
}

ascRouter.get(
  "/products",
  bundleAccess("query"),
  handle("listProducts", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }

    const { data: resp } = await asc.client.get(`/apps/${app.id}/inAppPurchasesV2`, {
      params: {
        "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state,reviewNote",
        limit: 200,
      },
    });

    res.json((resp.data ?? []).map(mapProduct));
  }),
);

ascRouter.post(
  "/products",
  bundleAccess("body"),
  handle("createProduct", async (req, res) => {
    const { name, productId, inAppPurchaseType, reviewNote } = req.body as {
      name: string;
      productId: string;
      inAppPurchaseType: string;
      reviewNote?: string;
    };

    if (!name || !productId || !inAppPurchaseType) {
      res.status(400).json({ error: "name, productId, inAppPurchaseType are required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(req.bundleApp!.bundleId);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const attrs: Record<string, any> = { name, productId, inAppPurchaseType };
    if (reviewNote) attrs.reviewNote = reviewNote;

    const { data: resp } = await asc.client.post(`${ASC_V2}/inAppPurchases`, {
      data: {
        type: "inAppPurchases",
        attributes: attrs,
        relationships: { app: { data: { type: "apps", id: app.id } } },
      },
    });

    res.status(201).json(mapProduct(resp.data));
  }),
);

ascRouter.patch(
  "/products/:id",
  handle("updateProduct", async (req, res) => {
    const { id } = req.params;
    const { name, reviewNote } = req.body as { name?: string; reviewNote?: string | null };
    const asc = await ascClientForUser(req.user!.userId);
    const attrs: Record<string, any> = {};

    if (name !== undefined) attrs.name = name;
    if (reviewNote !== undefined) attrs.reviewNote = reviewNote;

    await asc.client.patch(`${ASC_V2}/inAppPurchases/${id}`, {
      data: { type: "inAppPurchases", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/products/:id",
  handle("deleteProduct", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`${ASC_V2}/inAppPurchases/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/products/:id/localizations",
  handle("listProductLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`${ASC_V2}/inAppPurchases/${id}/inAppPurchaseLocalizations`, {
      params: {
        "fields[inAppPurchaseLocalizations]": "locale,name,description,state",
        limit: 50,
      },
    });

    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        description: l.attributes?.description ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/products/localizations",
  handle("createProductLocalization", async (req, res) => {
    const {
      productId: iapId,
      locale,
      name,
      description,
    } = req.body as {
      productId: string;
      locale: string;
      name: string;
      description?: string;
    };

    if (!iapId || !locale || !name) {
      res.status(400).json({ error: "productId, locale, name required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/inAppPurchaseLocalizations", {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: { locale, name, description: description ?? "" },
        relationships: {
          inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      description: resp.data.attributes?.description ?? "",
    });
  }),
);

ascRouter.patch(
  "/products/localizations/:id",
  handle("updateProductLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body as { name?: string; description?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const attrs: Record<string, any> = {};

    if (name !== undefined) attrs.name = name;
    if (description !== undefined) attrs.description = description;

    await asc.client.patch(`/inAppPurchaseLocalizations/${id}`, {
      data: { type: "inAppPurchaseLocalizations", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/products/localizations/:id",
  handle("deleteProductLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.delete(`/inAppPurchaseLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/products/:id/price-points",
  handle("listProductPricePoints", async (req, res) => {
    const { id } = req.params;
    const territory = req.query.territory as string | undefined;
    const asc = await ascClientForUser(req.user!.userId);
    const params: Record<string, any> = {
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds,territory",
      limit: 8000,
    };

    if (territory) params["filter[territory]"] = territory;

    const { data: resp } = await asc.client.get(`${ASC_V2}/inAppPurchases/${id}/pricePoints`, { params });
    res.json(
      (resp.data ?? []).map((p: any) => ({
        id: p.id,
        customerPrice: p.attributes?.customerPrice ?? null,
        proceeds: p.attributes?.proceeds ?? null,
        territory: p.attributes?.territory ?? null,
        currency: null,
      })),
    );
  }),
);

async function fetchIapSchedulePrices(
  asc: AppStoreConnectClient,
  scheduleId: string,
  relation: "manualPrices" | "automaticPrices",
): Promise<any[]> {
  const { data: resp } = await asc.client.get(`/inAppPurchasePriceSchedules/${scheduleId}/${relation}`, {
    params: {
      include: "territory,inAppPurchasePricePoint",
      "fields[inAppPurchasePrices]": "startDate,territory,inAppPurchasePricePoint",
      "fields[territories]": "currency",
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds",
      limit: 200,
    },
  });

  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>();
  const ppMap = new Map<string, any>();

  for (const item of included) {
    if (item.type === "territories") terrMap.set(item.id, item);
    if (item.type === "inAppPurchasePricePoints") ppMap.set(item.id, item);
  }

  return (resp.data ?? []).map((price: any) => {
    const terrId = price.relationships?.territory?.data?.id;
    const ppId = price.relationships?.inAppPurchasePricePoint?.data?.id;
    const terr = terrId ? terrMap.get(terrId) : null;
    const pp = ppId ? ppMap.get(ppId) : null;
    return {
      id: price.id,
      territory: terrId ?? null,
      currency: terr?.attributes?.currency ?? null,
      customerPrice: pp?.attributes?.customerPrice ?? null,
      proceeds: pp?.attributes?.proceeds ?? null,
      startDate: price.attributes?.startDate ?? null,
      pricePointId: ppId ?? null,
    };
  });
}

async function getIapScheduleId(asc: AppStoreConnectClient, iapId: string): Promise<string | null> {
  try {
    const { data: sched } = await asc.client.get(`${ASC_V2}/inAppPurchases/${iapId}/iapPriceSchedule`);
    return sched.data?.id ?? null;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

async function fetchProductPrices(asc: AppStoreConnectClient, iapId: string): Promise<any[]> {
  const scheduleId = await getIapScheduleId(asc, iapId);
  if (!scheduleId) return [];

  const [manual, automatic] = await Promise.all([
    fetchIapSchedulePrices(asc, scheduleId, "manualPrices"),
    fetchIapSchedulePrices(asc, scheduleId, "automaticPrices"),
  ]);

  const byTerritory = new Map<string, any>();
  for (const p of [...automatic, ...manual]) {
    if (p.territory) byTerritory.set(p.territory, p);
  }

  return [...byTerritory.values()].sort((a, b) => (a.territory ?? "").localeCompare(b.territory ?? ""));
}

ascRouter.get(
  "/products/:id/prices",
  handle("listProductPrices", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    res.json(await fetchProductPrices(asc, String(id)));
  }),
);

ascRouter.post(
  "/products/prices",
  handle("setProductPrice", async (req, res) => {
    const {
      productId: iapId,
      pricePointId,
      territory,
    } = req.body as {
      productId: string;
      pricePointId: string;
      territory: string;
    };

    if (!iapId || !pricePointId || !territory) {
      res.status(400).json({ error: "productId, pricePointId, territory required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    await asc.client.post("/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          baseTerritory: { data: { type: "territories", id: territory } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${manualPrice1}" }] },
        },
      },
      included: [
        {
          type: "inAppPurchasePrices",
          id: "${manualPrice1}",
          attributes: { startDate: null },
          relationships: {
            inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
            territory: { data: { type: "territories", id: territory } },
          },
        },
      ],
    });

    res.json({ ok: true });
  }),
);

async function fetchProductEqualizations(
  asc: AppStoreConnectClient,
  pricePointId: string,
): Promise<EqualizedPricePoint[]> {
  // equalizations lives on the v1 API (like subscriptionPricePoints), so use a
  // relative path against the v1 base rather than the v2 host. Hitting /v2 here
  // returns 404 "The path provided does not match a defined resource type."
  const { data: resp } = await asc.client.get(`/inAppPurchasePricePoints/${pricePointId}/equalizations`, {
    params: {
      include: "territory",
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds,territory",
      "fields[territories]": "currency",
      limit: 8000,
    },
  });
  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>(
    included.filter((i: any) => i.type === "territories").map((t: any) => [t.id, t]),
  );
  return (resp.data ?? []).map((pp: any) => {
    const terrId = pp.relationships?.territory?.data?.id ?? pp.attributes?.territory ?? null;
    return {
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
      proceeds: pp.attributes?.proceeds ?? null,
      territory: terrId,
      currency: terrId ? (terrMap.get(terrId)?.attributes?.currency ?? null) : null,
    };
  });
}

ascRouter.post(
  "/products/:id/smart-prices",
  handle("previewProductSmartPrices", async (req, res) => {
    const { id } = req.params;
    const { basePricePointId } = (req.body ?? {}) as { basePricePointId?: string };
    const asc = await ascClientForUser(req.user!.userId);

    const [catalogResp, currentPrices] = await Promise.all([
      asc.client.get(`${ASC_V2}/inAppPurchases/${id}/pricePoints`, {
        params: {
          "fields[inAppPurchasePricePoints]": "customerPrice",
          "filter[territory]": SMART_PRICING_BASE_TERRITORY,
          limit: 8000,
        },
      }),
      fetchProductPrices(asc, String(id)),
    ]);
    const baseCatalog = (catalogResp.data.data ?? []).map((pp: any) => ({
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
    }));
    const currentByTerritory = new Map<string, any>(
      currentPrices.filter((p: any) => p.territory).map((p: any) => [p.territory, p]),
    );

    const baseId = basePricePointId ?? currentByTerritory.get(SMART_PRICING_BASE_TERRITORY)?.pricePointId;
    if (!baseId) {
      res.status(400).json({ error: "No USA price set. Pick a US base price first." });
      return;
    }

    const rows = await buildSmartPriceRows({
      basePricePointId: baseId,
      baseCatalog,
      currentByTerritory,
      fetchEqualizations: (pointId) => fetchProductEqualizations(asc, pointId),
    });
    res.json({ baseTerritory: SMART_PRICING_BASE_TERRITORY, basePricePointId: baseId, rows });
  }),
);

ascRouter.post(
  "/products/prices/bulk",
  handle("bulkSetProductPrices", async (req, res) => {
    const { productId: iapId, items } = req.body as {
      productId?: string;
      items?: Array<{ territory?: string; pricePointId?: string }>;
    };
    if (!iapId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "productId and a non-empty items array are required" });
      return;
    }
    if (items.some((i) => !i.territory || !i.pricePointId)) {
      res.status(400).json({ error: "Every item needs territory and pricePointId" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    // Creating a price schedule replaces the whole schedule in ASC, so merge the
    // new prices with the existing manual ones to avoid dropping other territories.
    const scheduleId = await getIapScheduleId(asc, iapId);
    let baseTerritory = SMART_PRICING_BASE_TERRITORY;
    const merged = new Map<string, string>();
    if (scheduleId) {
      try {
        const { data: bt } = await asc.client.get(`/inAppPurchasePriceSchedules/${scheduleId}/baseTerritory`);
        baseTerritory = bt.data?.id ?? SMART_PRICING_BASE_TERRITORY;
      } catch {
        // keep default base territory
      }
      const existingManual = await fetchIapSchedulePrices(asc, scheduleId, "manualPrices");
      for (const p of existingManual) {
        if (p.territory && p.pricePointId) merged.set(p.territory, p.pricePointId);
      }
    }
    for (const item of items) merged.set(item.territory!, item.pricePointId!);

    if (!merged.has(baseTerritory)) {
      res
        .status(400)
        .json({ error: `The base territory (${baseTerritory}) needs a price. Include it in the selection.` });
      return;
    }

    const entries = [...merged.entries()];
    await asc.client.post("/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          baseTerritory: { data: { type: "territories", id: baseTerritory } },
          manualPrices: {
            data: entries.map((_, i) => ({ type: "inAppPurchasePrices", id: `\${manualPrice${i + 1}}` })),
          },
        },
      },
      included: entries.map(([territory, pricePointId], i) => ({
        type: "inAppPurchasePrices",
        id: `\${manualPrice${i + 1}}`,
        attributes: { startDate: null },
        relationships: {
          inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
          territory: { data: { type: "territories", id: territory } },
        },
      })),
    });

    res.json({
      ok: true,
      applied: items.length,
      failed: 0,
      results: items.map((i) => ({ territory: i.territory!, ok: true })),
    });
  }),
);

async function getGameCenterDetailId(asc: AppStoreConnectClient, appId: string): Promise<string | null> {
  try {
    const { data: resp } = await asc.client.get(`/apps/${appId}/gameCenterDetail`);
    return resp.data?.id ?? null;
  } catch {
    return null;
  }
}

async function gcDetailIdForBundle(asc: AppStoreConnectClient, bundleId: string): Promise<string | null> {
  const app = await asc.getApp(bundleId);
  if (!app) return null;
  return getGameCenterDetailId(asc, app.id);
}

async function verifyGcResource(
  asc: AppStoreConnectClient,
  resourcePath: "gameCenterLeaderboards" | "gameCenterAchievements" | "gameCenterLeaderboardSets",
  resourceId: string,
  gcDetailId: string,
): Promise<boolean> {
  try {
    const { data: resp } = await asc.client.get(`/${resourcePath}/${resourceId}/relationships/gameCenterDetail`);
    return resp.data?.id === gcDetailId;
  } catch {
    return false;
  }
}

const LOCALIZATION_PARENT: Record<
  string,
  {
    locPath: string;
    parentRel: string;
    parentPath: "gameCenterLeaderboards" | "gameCenterAchievements" | "gameCenterLeaderboardSets";
  }
> = {
  leaderboard: {
    locPath: "gameCenterLeaderboardLocalizations",
    parentRel: "gameCenterLeaderboard",
    parentPath: "gameCenterLeaderboards",
  },
  achievement: {
    locPath: "gameCenterAchievementLocalizations",
    parentRel: "gameCenterAchievement",
    parentPath: "gameCenterAchievements",
  },
  challenge: {
    locPath: "gameCenterLeaderboardSetLocalizations",
    parentRel: "gameCenterLeaderboardSet",
    parentPath: "gameCenterLeaderboardSets",
  },
};

async function verifyGcLocalization(
  asc: AppStoreConnectClient,
  kind: "leaderboard" | "achievement" | "challenge",
  localizationId: string,
  gcDetailId: string,
): Promise<boolean> {
  const cfg = LOCALIZATION_PARENT[kind];
  try {
    const { data: resp } = await asc.client.get(`/${cfg.locPath}/${localizationId}/relationships/${cfg.parentRel}`);
    const parentId = resp.data?.id;
    if (!parentId) return false;
    return verifyGcResource(asc, cfg.parentPath, parentId, gcDetailId);
  } catch {
    return false;
  }
}

function forbidResource(res: Response) {
  res.status(404).json({ error: "Resource not found" });
}

ascRouter.get(
  "/gamecenter/leaderboards",
  bundleAccess("query"),
  handle("gamecenter leaderboards", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);
    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }
    const gcDetailId = await getGameCenterDetailId(asc, app.id);
    if (!gcDetailId) {
      res.json({ leaderboards: [], gcDetailId: null, gcEnabled: false });
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterLeaderboards`, {
      params: {
        "fields[gameCenterLeaderboards]":
          "referenceName,vendorIdentifier,defaultFormatter,archived,scoreSortType,submissionType",
        limit: 200,
      },
    });
    const leaderboards = (resp.data ?? []).map((lb: any) => ({
      id: lb.id,
      referenceName: lb.attributes?.referenceName ?? "",
      vendorIdentifier: lb.attributes?.vendorIdentifier ?? "",
      defaultFormatter: lb.attributes?.defaultFormatter ?? "INTEGER",
      archived: lb.attributes?.archived ?? false,
      scoreSortType: lb.attributes?.scoreSortType ?? "HIGH_TO_LOW",
      submissionType: lb.attributes?.submissionType ?? "INDIVIDUAL",
    }));
    res.json({ leaderboards, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/leaderboards",
  bundleAccess("body"),
  handle("create leaderboard", async (req, res) => {
    const { referenceName, vendorIdentifier, defaultFormatter, scoreSortType, submissionType } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
      defaultFormatter?: string;
      scoreSortType?: string;
      submissionType?: string;
    };
    if (!referenceName || !vendorIdentifier) {
      res.status(400).json({ error: "referenceName, vendorIdentifier required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });
      return;
    }
    const { data: resp } = await asc.client.post("/gameCenterLeaderboards", {
      data: {
        type: "gameCenterLeaderboards",
        attributes: {
          referenceName,
          vendorIdentifier,
          defaultFormatter: defaultFormatter ?? "INTEGER",
          scoreSortType: scoreSortType ?? "HIGH_TO_LOW",
          submissionType: submissionType ?? "INDIVIDUAL",
        },
        relationships: {
          gameCenterDetail: {
            data: { type: "gameCenterDetails", id: gcDetailId },
          },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
      defaultFormatter: resp.data.attributes?.defaultFormatter ?? defaultFormatter ?? "INTEGER",
      archived: resp.data.attributes?.archived ?? false,
      scoreSortType: resp.data.attributes?.scoreSortType ?? scoreSortType ?? "HIGH_TO_LOW",
      submissionType: resp.data.attributes?.submissionType ?? submissionType ?? "INDIVIDUAL",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/leaderboards/:id",
  bundleAccess("body"),
  handle("update leaderboard", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName, archived } = req.body as {
      referenceName?: string;
      archived?: boolean;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const attrs: Record<string, unknown> = {};
    if (referenceName !== undefined) attrs.referenceName = referenceName;
    if (archived !== undefined) attrs.archived = archived;
    await asc.client.patch(`/gameCenterLeaderboards/${id}`, {
      data: { type: "gameCenterLeaderboards", id, attributes: attrs },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/leaderboards/:id",
  bundleAccess("query"),
  handle("delete leaderboard", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);
      return;
    }

    await asc.client.delete(`/gameCenterLeaderboards/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/leaderboards/:id/localizations",
  bundleAccess("query"),
  handle("leaderboard localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterLeaderboards/${id}/localizations`, {
      params: {
        "fields[gameCenterLeaderboardLocalizations]": "locale,name,formatterSuffix,formatterSuffixSingular",
      },
    });

    const localizations = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
      formatterSuffix: l.attributes?.formatterSuffix ?? "",
      formatterSuffixSingular: l.attributes?.formatterSuffixSingular ?? "",
    }));
    res.json(localizations);
  }),
);

ascRouter.post(
  "/gamecenter/leaderboard-localizations",
  bundleAccess("body"),
  handle("create leaderboard localization", async (req, res) => {
    const { leaderboardId, locale, name, formatterSuffix, formatterSuffixSingular } = req.body as {
      leaderboardId: string;
      locale: string;
      name: string;
      formatterSuffix?: string;
      formatterSuffixSingular?: string;
    };
    if (!leaderboardId || !locale || !name) {
      res.status(400).json({ error: "leaderboardId, locale, name required" });
      return;
    }
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboards", leaderboardId, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const attrs: Record<string, string> = { locale, name };
    if (formatterSuffix) attrs.formatterSuffix = formatterSuffix;
    if (formatterSuffixSingular) attrs.formatterSuffixSingular = formatterSuffixSingular;
    const { data: resp } = await asc.client.post("/gameCenterLeaderboardLocalizations", {
      data: {
        type: "gameCenterLeaderboardLocalizations",
        attributes: attrs,
        relationships: {
          gameCenterLeaderboard: {
            data: { type: "gameCenterLeaderboards", id: leaderboardId },
          },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      locale,
      name: resp.data.attributes?.name ?? name,
      formatterSuffix: resp.data.attributes?.formatterSuffix ?? "",
      formatterSuffixSingular: resp.data.attributes?.formatterSuffixSingular ?? "",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/leaderboard-localizations/:id",
  bundleAccess("body"),
  handle("update leaderboard localization", async (req, res) => {
    const id = req.params.id as string;
    const { name, formatterSuffix, formatterSuffixSingular } = req.body as {
      name?: string;
      formatterSuffix?: string;
      formatterSuffixSingular?: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "leaderboard", id, gcDetailId))) {
      forbidResource(res);
      return;
    }

    const attrs: Record<string, string> = {};
    if (name !== undefined) attrs.name = name;
    if (formatterSuffix !== undefined) attrs.formatterSuffix = formatterSuffix;
    if (formatterSuffixSingular !== undefined) attrs.formatterSuffixSingular = formatterSuffixSingular;
    await asc.client.patch(`/gameCenterLeaderboardLocalizations/${id}`, {
      data: {
        type: "gameCenterLeaderboardLocalizations",
        id,
        attributes: attrs,
      },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/leaderboard-localizations/:id",
  bundleAccess("query"),
  handle("delete leaderboard localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcLocalization(asc, "leaderboard", id, gcDetailId))) {
      forbidResource(res);
      return;
    }

    await asc.client.delete(`/gameCenterLeaderboardLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/achievements",
  bundleAccess("query"),
  handle("gamecenter achievements", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);
    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }
    const gcDetailId = await getGameCenterDetailId(asc, app.id);
    if (!gcDetailId) {
      res.json({ achievements: [], gcDetailId: null, gcEnabled: false });
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterAchievements`, {
      params: {
        "fields[gameCenterAchievements]": "referenceName,vendorIdentifier,points,showBeforeEarned,repeatable,archived",
        limit: 200,
      },
    });
    const achievements = (resp.data ?? []).map((a: any) => ({
      id: a.id,
      referenceName: a.attributes?.referenceName ?? "",
      vendorIdentifier: a.attributes?.vendorIdentifier ?? "",
      points: a.attributes?.points ?? 0,
      showBeforeEarned: a.attributes?.showBeforeEarned ?? true,
      repeatable: a.attributes?.repeatable ?? false,
      archived: a.attributes?.archived ?? false,
    }));
    res.json({ achievements, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/achievements",
  bundleAccess("body"),
  handle("create achievement", async (req, res) => {
    const { referenceName, vendorIdentifier, points, showBeforeEarned, repeatable } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
      points: number;
      showBeforeEarned: boolean;
      repeatable: boolean;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });
      return;
    }
    const { data: resp } = await asc.client.post("/gameCenterAchievements", {
      data: {
        type: "gameCenterAchievements",
        attributes: { referenceName, vendorIdentifier, points, showBeforeEarned, repeatable },
        relationships: {
          gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
      points: resp.data.attributes?.points ?? points,
      showBeforeEarned: resp.data.attributes?.showBeforeEarned ?? showBeforeEarned,
      repeatable: resp.data.attributes?.repeatable ?? repeatable,
      archived: false,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/achievements/:id",
  bundleAccess("body"),
  handle("update achievement", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName, points, showBeforeEarned, repeatable, archived } = req.body as {
      referenceName?: string;
      points?: number;
      showBeforeEarned?: boolean;
      repeatable?: boolean;
      archived?: boolean;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const attrs: Record<string, unknown> = {};
    if (referenceName !== undefined) attrs.referenceName = referenceName;
    if (points !== undefined) attrs.points = points;
    if (showBeforeEarned !== undefined) attrs.showBeforeEarned = showBeforeEarned;
    if (repeatable !== undefined) attrs.repeatable = repeatable;
    if (archived !== undefined) attrs.archived = archived;
    await asc.client.patch(`/gameCenterAchievements/${id}`, {
      data: { type: "gameCenterAchievements", id, attributes: attrs },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/achievements/:id",
  bundleAccess("query"),
  handle("delete achievement", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);
      return;
    }

    await asc.client.delete(`/gameCenterAchievements/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/achievements/:id/localizations",
  bundleAccess("query"),
  handle("achievement localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterAchievements/${id}/localizations`, {
      params: {
        "fields[gameCenterAchievementLocalizations]": "locale,name,afterEarnedDescription,beforeEarnedDescription",
        limit: 200,
      },
    });
    const locs = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
      afterEarnedDescription: l.attributes?.afterEarnedDescription ?? "",
      beforeEarnedDescription: l.attributes?.beforeEarnedDescription ?? "",
    }));
    res.json(locs);
  }),
);

ascRouter.post(
  "/gamecenter/achievement-localizations",
  bundleAccess("body"),
  handle("create achievement localization", async (req, res) => {
    const { achievementId, locale, name, afterEarnedDescription, beforeEarnedDescription } = req.body as {
      achievementId: string;
      locale: string;
      name: string;
      afterEarnedDescription?: string;
      beforeEarnedDescription?: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterAchievements", achievementId, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const { data: resp } = await asc.client.post("/gameCenterAchievementLocalizations", {
      data: {
        type: "gameCenterAchievementLocalizations",
        attributes: { locale, name, afterEarnedDescription, beforeEarnedDescription },
        relationships: {
          gameCenterAchievement: { data: { type: "gameCenterAchievements", id: achievementId } },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      afterEarnedDescription: resp.data.attributes?.afterEarnedDescription ?? afterEarnedDescription ?? "",
      beforeEarnedDescription: resp.data.attributes?.beforeEarnedDescription ?? beforeEarnedDescription ?? "",
    });
  }),
);

ascRouter.patch(
  "/gamecenter/achievement-localizations/:id",
  bundleAccess("body"),
  handle("update achievement localization", async (req, res) => {
    const id = req.params.id as string;
    const { name, afterEarnedDescription, beforeEarnedDescription } = req.body as {
      name?: string;
      afterEarnedDescription?: string;
      beforeEarnedDescription?: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcLocalization(asc, "achievement", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const attrs: Record<string, unknown> = {};
    if (name !== undefined) attrs.name = name;
    if (afterEarnedDescription !== undefined) attrs.afterEarnedDescription = afterEarnedDescription;
    if (beforeEarnedDescription !== undefined) attrs.beforeEarnedDescription = beforeEarnedDescription;
    await asc.client.patch(`/gameCenterAchievementLocalizations/${id}`, {
      data: { type: "gameCenterAchievementLocalizations", id, attributes: attrs },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/achievement-localizations/:id",
  bundleAccess("query"),
  handle("delete achievement localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcLocalization(asc, "achievement", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    await asc.client.delete(`/gameCenterAchievementLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/challenges",
  bundleAccess("query"),
  handle("gamecenter challenges", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);
    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
    }
    const gcDetailId = await getGameCenterDetailId(asc, app.id);
    if (!gcDetailId) {
      res.json({ challenges: [], gcDetailId: null, gcEnabled: false });
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterLeaderboardSets`, {
      params: {
        "fields[gameCenterLeaderboardSets]": "referenceName,vendorIdentifier",
        limit: 200,
      },
    });
    const challenges = (resp.data ?? []).map((c: any) => ({
      id: c.id,
      referenceName: c.attributes?.referenceName ?? "",
      vendorIdentifier: c.attributes?.vendorIdentifier ?? "",
    }));
    res.json({ challenges, gcDetailId, gcEnabled: true });
  }),
);

ascRouter.post(
  "/gamecenter/challenges",
  bundleAccess("body"),
  handle("create challenge", async (req, res) => {
    const { referenceName, vendorIdentifier } = req.body as {
      referenceName: string;
      vendorIdentifier: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId) {
      res.status(404).json({ error: "Game Center not enabled for this app" });
      return;
    }
    const { data: resp } = await asc.client.post("/gameCenterLeaderboardSets", {
      data: {
        type: "gameCenterLeaderboardSets",
        attributes: { referenceName, vendorIdentifier },
        relationships: {
          gameCenterDetail: { data: { type: "gameCenterDetails", id: gcDetailId } },
        },
      },
    });
    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/challenges/:id",
  bundleAccess("body"),
  handle("update challenge", async (req, res) => {
    const id = req.params.id as string;
    const { referenceName } = req.body as {
      referenceName?: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);

    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);
      return;
    }

    const attrs: Record<string, unknown> = {};
    if (referenceName !== undefined) attrs.referenceName = referenceName;
    await asc.client.patch(`/gameCenterLeaderboardSets/${id}`, {
      data: { type: "gameCenterLeaderboardSets", id, attributes: attrs },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/challenges/:id",
  bundleAccess("query"),
  handle("delete challenge", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    await asc.client.delete(`/gameCenterLeaderboardSets/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/gamecenter/challenges/:id/localizations",
  bundleAccess("query"),
  handle("challenge localizations", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const { data: resp } = await asc.client.get(`/gameCenterLeaderboardSets/${id}/localizations`, {
      params: {
        "fields[gameCenterLeaderboardSetLocalizations]": "locale,name",
        limit: 200,
      },
    });
    const locs = (resp.data ?? []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale ?? "",
      name: l.attributes?.name ?? "",
    }));
    res.json(locs);
  }),
);

ascRouter.post(
  "/gamecenter/challenge-localizations",
  bundleAccess("body"),
  handle("create challenge localization", async (req, res) => {
    const { challengeId, locale, name } = req.body as {
      challengeId: string;
      locale: string;
      name: string;
    };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcResource(asc, "gameCenterLeaderboardSets", challengeId, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const { data: resp } = await asc.client.post("/gameCenterLeaderboardSetLocalizations", {
      data: {
        type: "gameCenterLeaderboardSetLocalizations",
        attributes: { locale, name },
        relationships: {
          gameCenterLeaderboardSet: { data: { type: "gameCenterLeaderboardSets", id: challengeId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
    });
  }),
);

ascRouter.patch(
  "/gamecenter/challenge-localizations/:id",
  bundleAccess("body"),
  handle("update challenge localization", async (req, res) => {
    const id = req.params.id as string;
    const { name } = req.body as { name?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcLocalization(asc, "challenge", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    const attrs: Record<string, unknown> = {};
    if (name !== undefined) attrs.name = name;
    await asc.client.patch(`/gameCenterLeaderboardSetLocalizations/${id}`, {
      data: { type: "gameCenterLeaderboardSetLocalizations", id, attributes: attrs },
    });
    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/gamecenter/challenge-localizations/:id",
  bundleAccess("query"),
  handle("delete challenge localization", async (req, res) => {
    const id = req.params.id as string;
    const asc = await ascClientForUser(req.user!.userId);
    const gcDetailId = await gcDetailIdForBundle(asc, req.bundleApp!.bundleId);
    if (!gcDetailId || !(await verifyGcLocalization(asc, "challenge", id, gcDetailId))) {
      forbidResource(res);
      return;
    }
    await asc.client.delete(`/gameCenterLeaderboardSetLocalizations/${id}`);
    res.json({ ok: true });
  }),
);

ascRouter.get("/supported-locales", async (req, res) => {
  res.json(Object.keys(LOCALE_MAP));
});

ascRouter.get(
  "/keyword-fields",
  bundleAccess("query"),
  handle("getKeywordFields", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    let version = await prisma.appStoreVersion.findFirst({
      where: { bundleId, appStoreState: { in: [...EDITABLE_STATES] } },
      include: { localizations: { select: { locale: true, name: true, subtitle: true, keywords: true } } },
      orderBy: { syncedAt: "desc" },
    });
    if (!version) {
      version = await prisma.appStoreVersion.findFirst({
        where: { bundleId },
        include: { localizations: { select: { locale: true, name: true, subtitle: true, keywords: true } } },
        orderBy: { syncedAt: "desc" },
      });
    }
    const fields: Record<string, string> = {};
    const indexedText: Record<string, string> = {};

    for (const loc of version?.localizations ?? []) {
      fields[loc.locale] = loc.keywords ?? "";
      indexedText[loc.locale] = [loc.name, loc.subtitle, loc.keywords].filter(Boolean).join(" ");
    }
    res.json({ keywordFields: fields, indexedText });
  }),
);
