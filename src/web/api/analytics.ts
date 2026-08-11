import { Router } from "express";
import { prisma, logger, getEffectiveSettingsForTeam } from "../../config";
import { requireAuth, requireBundleAccess } from "../auth";
import { bossScheduler } from "../../jobs/boss";
import { QUEUE_NAME as SYNC_ANALYTICS_QUEUE } from "../../jobs/workers/sync-analytics.worker";

export const analyticsRouter = Router();

async function getAnchorDate(bundleId: string): Promise<Date> {
  const latest = await prisma.appStoreAnalytics.findFirst({
    where: { bundleId },
    orderBy: { reportDate: "desc" },
    select: { reportDate: true },
  });
  return latest?.reportDate ?? new Date();
}

function resolveSince(query: Record<string, any>, anchor: Date): Date | null {
  if (query.period === "all") return null;

  if (query.startDate) {
    return new Date(query.startDate as string);
  }

  if (query.period === "ytd") {
    return new Date(anchor.getFullYear(), 0, 1);
  }

  const days = parseInt(query.days as string, 10);
  const n = !isNaN(days) && days > 0 ? days : 30;
  const d = new Date(anchor);
  d.setDate(d.getDate() - (n - 1));
  return d;
}

function resolveUntil(query: Record<string, any>): Date | null {
  if (query.endDate) return new Date(query.endDate as string);
  return null;
}

function majorIosVersion(platformVersion: string): string {
  const major = platformVersion.match(/^iOS (\d+)/)?.[1];
  return major ? `iOS ${major}` : platformVersion || "Unknown";
}

// ─── GET /api/analytics/summary ──────────────────────────────────────────────
analyticsRouter.get("/summary", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};

    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const [metricAgg, reviewAgg] = await Promise.all([
      prisma.appStoreAnalytics.aggregate({
        where: {
          bundleId,
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        _sum: {
          downloads: true,
          proceeds: true,
          impressions: true,
          pageViews: true,
          taps: true,
          sessions: true,
        },
      }),
      prisma.appReview.aggregate({
        where: { bundleId },
        _avg: { rating: true },
        _count: { id: true },
      }),
    ]);

    const lastSyncAgg = await prisma.appStoreAnalytics.aggregate({
      where: { bundleId },
      _max: { createdAt: true },
    });
    const downloads = metricAgg._sum.downloads ?? 0;
    const impressions = metricAgg._sum.impressions ?? 0;
    const pageViews = metricAgg._sum.pageViews ?? 0;

    res.json({
      totalDownloads: downloads,
      totalProceeds: metricAgg._sum.proceeds ?? 0,
      totalImpressions: impressions,
      totalPageViews: pageViews,
      totalTaps: metricAgg._sum.taps ?? 0,
      totalSessions: metricAgg._sum.sessions ?? 0,
      conversionRate: impressions > 0 ? (downloads / impressions) * 100 : null,
      avgRating: reviewAgg._avg.rating ?? null,
      reviewCount: reviewAgg._count.id,
      lastSyncAt: lastSyncAgg._max.createdAt ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/downloads ────────────────────────────────────────────
analyticsRouter.get("/downloads", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};

    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const countryFilter = req.query.country as string | undefined;
    const rows = await prisma.appStoreAnalytics.findMany({
      where: {
        bundleId,
        ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        ...(countryFilter ? { country: countryFilter.toUpperCase() } : {}),
      },
      orderBy: { reportDate: "asc" },
    });

    type DayEntry = {
      date: string;
      downloads: number;
      updates: number;
      proceeds: number;
      impressions: number;
      pageViews: number;
      taps: number;
      sessions: number;
    };

    type CountryEntry = {
      downloads: number;
      impressions: number;
      pageViews: number;
      taps: number;
    };

    const byDayMap: Record<string, DayEntry> = {};
    const byCountryMap: Record<string, CountryEntry> = {};

    for (const r of rows) {
      const key = r.reportDate.toISOString().slice(0, 10);
      const day = (byDayMap[key] ??= {
        date: key,
        downloads: 0,
        updates: 0,
        proceeds: 0,
        impressions: 0,
        pageViews: 0,
        taps: 0,
        sessions: 0,
      });

      day.downloads += r.downloads;
      day.updates += r.updates;
      day.proceeds += r.proceeds;
      day.impressions += r.impressions;
      day.pageViews += r.pageViews;
      day.taps += r.taps;
      day.sessions += r.sessions;

      const c = (byCountryMap[r.country] ??= {
        downloads: 0,
        impressions: 0,
        pageViews: 0,
        taps: 0,
      });

      c.downloads += r.downloads;
      c.impressions += r.impressions;
      c.pageViews += r.pageViews;
      c.taps += r.taps;
    }

    const byCountry = Object.entries(byCountryMap)
      .map(([country, v]) => ({ country, ...v }))
      .sort((a, b) => b.downloads - a.downloads);

    res.json({
      byDay: Object.values(byDayMap),
      byCountry,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/platforms ────────────────────────────────────────────
analyticsRouter.get("/platforms", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};

    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const rows = await prisma.appStoreAnalyticsPlatform.findMany({
      where: {
        bundleId,
        ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
      },
    });

    type VersionEntry = {
      iosVersion: string;
      impressions: number;
      pageViews: number;
      taps: number;
      sessions: number;
    };

    const byVersionMap: Record<string, VersionEntry> = {};

    for (const r of rows) {
      const iosVersion = majorIosVersion(r.platformVersion);
      const v = (byVersionMap[iosVersion] ??= {
        iosVersion,
        impressions: 0,
        pageViews: 0,
        taps: 0,
        sessions: 0,
      });
      v.impressions += r.impressions;
      v.pageViews += r.pageViews;
      v.taps += r.taps;
      v.sessions += r.sessions;
    }

    const byVersion = Object.values(byVersionMap).sort(
      (a, b) => b.impressions + b.sessions - (a.impressions + a.sessions),
    );

    res.json({ byVersion });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/reviews ──────────────────────────────────────────────
analyticsRouter.get("/reviews", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

    const reviews = await prisma.appReview.findMany({
      where: { bundleId },
      orderBy: { reviewedAt: "desc" },
      take: limit,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        reviewerNickname: true,
        territory: true,
        reviewedAt: true,
      },
    });

    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/markers ──────────────────────────────────────────────
analyticsRouter.get("/markers", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;

    const app = await prisma.app.findUnique({
      where: { bundleId },
      select: { id: true, createdAt: true, isOwnApp: true, trackId: true },
    });

    if (!app) {
      res.json({ activatedAt: null, versionUpdates: [] });
      return;
    }

    let versionChanges = await prisma.appMetadataChange.findMany({
      where: { appId: app.id, field: "version" },
      orderBy: { detectedAt: "asc" },
      select: { newValue: true, detectedAt: true },
    });

    if (versionChanges.length === 0 && app.isOwnApp && app.trackId) {
      const { AppStoreScraper } = await import("../../services/appstore-scraper");
      const scraper = new AppStoreScraper();
      const history = await scraper.scrapeVersionHistory(Number(app.trackId));

      for (const { version, date } of history) {
        await prisma.appMetadataChange.create({
          data: {
            appId: app.id,
            field: "version",
            oldValue: null,
            newValue: version,
            detectedAt: new Date(date),
          },
        });
      }

      if (history.length > 0) {
        versionChanges = await prisma.appMetadataChange.findMany({
          where: { appId: app.id, field: "version" },
          orderBy: { detectedAt: "asc" },
          select: { newValue: true, detectedAt: true },
        });
      }
    }

    const seenVersions = new Set<string>();
    const versionUpdates: { date: string; version: string }[] = [];

    for (const c of versionChanges) {
      const version = c.newValue ?? "";
      if (!version || seenVersions.has(version)) continue;
      seenVersions.add(version);
      versionUpdates.push({
        date: c.detectedAt.toISOString().slice(0, 10),
        version,
      });
    }

    res.json({
      activatedAt: app.createdAt.toISOString().slice(0, 10),
      versionUpdates,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/analytics/sync ─────────────────────────────────────────────────
analyticsRouter.post("/sync", requireAuth, async (req, res) => {
  try {
    const teamId = req.user!.teamId;
    const settings = await getEffectiveSettingsForTeam(teamId!);

    if (!settings.ascIssuerId || !settings.ascKeyId || !settings.ascPrivateKey) {
      res.status(400).json({ error: "App Store Connect credentials not configured." });
      return;
    }

    if (!settings.ascVendorNumber) {
      res.status(400).json({ error: "ASC Vendor Number not configured in Settings." });
      return;
    }

    const requestedBundleId = (req.body.bundleId as string) || null;
    if (!requestedBundleId) {
      res.status(400).json({ error: "bundleId required" });
      return;
    }

    const teamFilter = req.user!.role === "ADMIN" ? {} : { teamId: req.user!.teamId };
    const ownApps = await prisma.app.findMany({
      where: {
        isOwnApp: true,
        bundleId: requestedBundleId,
        ...teamFilter,
      },
      select: { bundleId: true, trackId: true, name: true },
    });

    if (ownApps.length === 0) {
      res.status(400).json({
        error: "No own apps found. Add your app in the Apps section first and mark it as 'Own App'.",
      });
      return;
    }

    for (const app of ownApps) {
      if (!app.trackId) continue;
      await bossScheduler.sendJob(SYNC_ANALYTICS_QUEUE, {
        teamId,
        bundleId: app.bundleId,
        ascAppId: app.trackId.toString(),
      });
      logger.info(`[BOSS] Enqueued ${SYNC_ANALYTICS_QUEUE} for ${app.bundleId}`);
    }

    res.json({
      ok: true,
      message: `Analytics sync enqueued for ${ownApps.map((a) => a.name).join(", ")}`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
