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

export function majorVersionNumber(version: string): number | null {
  const major = version.match(/(\d+)/)?.[1];
  return major ? parseInt(major, 10) : null;
}

const DOWNLOAD_SOURCE_TYPES = [
  "App Store search",
  "App Store browse",
  "App referrer",
  "Web referrer",
  "Unavailable",
  "Institutional purchase",
] as const;

function downloadSourceLabel(sourceType: string): string {
  return (DOWNLOAD_SOURCE_TYPES as readonly string[]).includes(sourceType) ? sourceType : "Other";
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

    const minimumOsVersion = req.bundleApp!.minimumOsVersion;
    const minOsMajor = minimumOsVersion ? majorVersionNumber(minimumOsVersion) : null;

    const [metricAgg, reviewAgg, purchaseAgg, platformAgg] = await Promise.all([
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
      prisma.appStoreCommercePurchase.aggregate({
        where: {
          bundleId,
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        _sum: { payingUsers: true, proceedsUsd: true },
      }),
      minOsMajor != null
        ? prisma.appStoreAnalyticsPlatform.groupBy({
            by: ["platformVersion"],
            where: {
              bundleId,
              ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
            },
            _sum: { impressions: true },
          })
        : Promise.resolve([]),
    ]);

    const lastSyncAgg = await prisma.appStoreAnalytics.aggregate({
      where: { bundleId },
      _max: { createdAt: true },
    });
    const downloads = metricAgg._sum.downloads ?? 0;
    const impressions = metricAgg._sum.impressions ?? 0;
    const pageViews = metricAgg._sum.pageViews ?? 0;

    const impressionsBelowMinOs =
      minOsMajor != null
        ? platformAgg.reduce((sum, row) => {
            const major = majorVersionNumber(row.platformVersion);
            return major != null && major < minOsMajor ? sum + (row._sum.impressions ?? 0) : sum;
          }, 0)
        : null;

    res.json({
      totalDownloads: downloads,
      totalProceeds: (metricAgg._sum.proceeds ?? 0) + (purchaseAgg._sum.proceedsUsd ?? 0),
      totalImpressions: impressions,
      totalPageViews: pageViews,
      totalTaps: metricAgg._sum.taps ?? 0,
      totalSessions: metricAgg._sum.sessions ?? 0,
      totalPayingUsers: purchaseAgg._sum.payingUsers ?? 0,
      minimumOsVersion,
      impressionsBelowMinOs,
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
    const [rows, purchaseRows, sourceRows] = await Promise.all([
      prisma.appStoreAnalytics.findMany({
        where: {
          bundleId,
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
          ...(countryFilter ? { country: countryFilter.toUpperCase() } : {}),
        },
        orderBy: { reportDate: "asc" },
      }),

      countryFilter
        ? Promise.resolve([])
        : prisma.appStoreCommercePurchase.findMany({
            where: {
              bundleId,
              ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
            },
            select: { reportDate: true, proceedsUsd: true },
          }),

      countryFilter
        ? Promise.resolve([])
        : prisma.appStoreCommerceDownload.groupBy({
            by: ["reportDate", "sourceType"],
            where: {
              bundleId,
              downloadType: "First-time download",
              ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
            },
            _sum: { counts: true },
          }),
    ]);

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

    for (const p of purchaseRows) {
      const key = p.reportDate.toISOString().slice(0, 10);
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
      day.proceeds += p.proceedsUsd;
    }

    const byCountry = Object.entries(byCountryMap)
      .map(([country, v]) => ({ country, ...v }))
      .sort((a, b) => b.downloads - a.downloads);

    const bySourceDayMap: Record<string, Record<string, number>> = {};
    const sourceTotals: Record<string, number> = {};
    for (const r of sourceRows) {
      const key = r.reportDate.toISOString().slice(0, 10);
      const label = downloadSourceLabel(r.sourceType);
      const count = r._sum.counts ?? 0;
      const day = (bySourceDayMap[key] ??= {});
      day[label] = (day[label] ?? 0) + count;
      sourceTotals[label] = (sourceTotals[label] ?? 0) + count;
    }
    const presentSourceTypes = [...DOWNLOAD_SOURCE_TYPES, "Other"].filter((t) => (sourceTotals[t] ?? 0) > 0);
    const bySourceDay = Object.entries(bySourceDayMap)
      .map(([date, values]) => {
        const filled: Record<string, number> = {};
        for (const t of presentSourceTypes) filled[t] = values[t] ?? 0;
        return { date, ...filled };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      byDay: Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date)),
      byCountry,
      sourceTypes: presentSourceTypes,
      bySourceDay,
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

// ─── GET /api/analytics/purchases ────────────────────────────────────────────
analyticsRouter.get("/purchases", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

    const rows = await prisma.appStoreCommercePurchase.findMany({
      where: { bundleId },
      orderBy: { reportDate: "desc" },
      take: limit,
      select: {
        reportDate: true,
        purchaseType: true,
        contentName: true,
        paymentMethod: true,
        territory: true,
        purchases: true,
        proceedsUsd: true,
        salesUsd: true,
        payingUsers: true,
      },
    });

    res.json(
      rows.map((r) => ({
        date: r.reportDate.toISOString().slice(0, 10),
        purchaseType: r.purchaseType,
        contentName: r.contentName,
        paymentMethod: r.paymentMethod,
        territory: r.territory,
        purchases: r.purchases,
        proceedsUsd: r.proceedsUsd,
        salesUsd: r.salesUsd,
        payingUsers: r.payingUsers,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/ltv ──────────────────────────────────────────────────
// Apple's commerce reports are dimensional aggregates (no per-customer identity),
// so "LTV" here is a cohort proxy: cumulative proceeds ÷ cumulative installs to date.
//
// Revenue is summed from two separate Apple reports: appStoreAnalytics.proceeds
// only reflects paid-app purchase-price revenue (0 for free/freemium apps), while
// in-app purchase and subscription revenue lives exclusively in the Commerce
// report (appStoreCommercePurchase.proceedsUsd). Using only the former made LTV
// read as 0 for any app monetizing through IAP/subscriptions instead of a paid
// listing price.
analyticsRouter.get("/ltv", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);

    const [rows, purchaseRows] = await Promise.all([
      prisma.appStoreAnalytics.findMany({
        where: { bundleId },
        orderBy: { reportDate: "asc" },
        select: { reportDate: true, downloads: true, proceeds: true },
      }),
      prisma.appStoreCommercePurchase.findMany({
        where: { bundleId },
        select: { reportDate: true, proceedsUsd: true },
      }),
    ]);

    const byDayMap: Record<string, { downloads: number; proceeds: number }> = {};
    for (const r of rows) {
      const key = r.reportDate.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });
      d.downloads += r.downloads;
      d.proceeds += r.proceeds;
    }
    for (const p of purchaseRows) {
      const key = p.reportDate.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });
      d.proceeds += p.proceedsUsd;
    }

    const dates = Object.keys(byDayMap).sort();
    let cumulativeDownloads = 0;
    let cumulativeRevenue = 0;
    const series = dates.map((date) => {
      cumulativeDownloads += byDayMap[date].downloads;
      cumulativeRevenue += byDayMap[date].proceeds;
      return {
        date,
        cumulativeDownloads,
        cumulativeRevenue,
        ltv: cumulativeDownloads > 0 ? cumulativeRevenue / cumulativeDownloads : 0,
      };
    });

    const sinceKey = since ? since.toISOString().slice(0, 10) : null;
    const untilKey = until ? until.toISOString().slice(0, 10) : null;
    const byDay = series.filter((s) => (!sinceKey || s.date >= sinceKey) && (!untilKey || s.date <= untilKey));

    res.json({
      byDay,
      currentLtv: series.length ? series[series.length - 1].ltv : 0,
    });
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
