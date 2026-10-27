import { Router } from "express";
import axios from "../../services/utils/http";
import { prisma, logger } from "../../config";
import { requireAuth, bundleAccess, loadVersionInBundle } from "../auth";
import * as translationTracker from "../../jobs/translation-tracker";
import { runQuickScan } from "./quick-scan";
import {
  CACHE_TTL_MS,
  EDITABLE_STATES,
  ascClientForUser,
  handle,
  isDemoBundle,
  isFresh,
  pickInitialLocale,
  toLocalizationResponse,
  toLocalizationSummaries,
  upsertVersionDetailToDb,
  upsertVersionsToDb,
} from "./asc-shared";

export const ascRouter = Router();

ascRouter.use(requireAuth);

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
