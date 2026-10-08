import { Router } from "express";
import { prisma, logger, getEffectiveSettingsForTeam } from "../../config";
import { requireAuth, requireBundleAccess } from "../auth";
import { bossScheduler } from "../../jobs/boss";
import { QUEUE_NAME as SYNC_ANALYTICS_QUEUE } from "../../jobs/workers/sync-analytics.worker";
import { QUEUE_NAME as SYNC_REVENUECAT_QUEUE } from "../../jobs/workers/sync-revenuecat.worker";
import { AscAnalyticsService, type TrialPotential } from "../../services/asc-analytics";

export const analyticsRouter = Router();

const trialPotentialCache = new Map<string, { expiresAt: number; value: Promise<TrialPotential> }>();

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

async function revenueCatGapStart(bundleId: string): Promise<Date> {
  const agg = await prisma.appStoreCommercePurchase.aggregate({
    where: { bundleId },
    _max: { reportDate: true },
  });
  if (!agg._max.reportDate) return new Date(0);
  const start = new Date(agg._max.reportDate);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function revenueCatGapWhere(bundleId: string, gapStart: Date) {
  return {
    bundleId,
    OR: [{ store: { not: "app_store" } }, { occurredAt: { gte: gapStart } }],
  };
}

interface RevenueCatDetail {
  id: string;
  customerId: string;
  productId: string;
  store: string;
  environment: string;
  eventType: string;
  periodType: string;
  isTrialConversion: boolean;
  renewalNumber: number | null;
  transactionId: string | null;
  country: string | null;
  proceedsUsd: number;
  grossUsd: number;
  customer: {
    platform: string | null;
    platformVersion: string | null;
    appVersion: string | null;
    country: string | null;
    attributes: Record<string, string | null>;
  } | null;
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

    const rcGapStart = await revenueCatGapStart(bundleId);
    const rcWhere = {
      ...revenueCatGapWhere(bundleId, rcGapStart),
      ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
    };

    const [metricAgg, reviewAgg, purchaseAgg, platformAgg, rcAgg, rcCustomers] = await Promise.all([
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
      prisma.revenueCatTransaction.aggregate({
        where: rcWhere,
        _sum: { proceedsUsd: true },
      }),
      prisma.revenueCatTransaction.groupBy({ by: ["customerId"], where: rcWhere }),
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
      totalProceeds: (metricAgg._sum.proceeds ?? 0) + (purchaseAgg._sum.proceedsUsd ?? 0) + (rcAgg._sum.proceedsUsd ?? 0),
      totalImpressions: impressions,
      totalPageViews: pageViews,
      totalTaps: metricAgg._sum.taps ?? 0,
      totalSessions: metricAgg._sum.sessions ?? 0,
      totalPayingUsers: (purchaseAgg._sum.payingUsers ?? 0) + rcCustomers.length,
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
    const rcGapStart = countryFilter ? null : await revenueCatGapStart(bundleId);
    const [rows, purchaseRows, sourceRows, installDeletionRows, rcRows] = await Promise.all([
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

      prisma.appStoreInstallDeletion.findMany({
        where: {
          bundleId,
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
          ...(countryFilter ? { territory: countryFilter.toUpperCase() } : {}),
        },
        select: { reportDate: true, event: true, counts: true },
      }),

      rcGapStart === null
        ? Promise.resolve([])
        : prisma.revenueCatTransaction.findMany({
            where: {
              ...revenueCatGapWhere(bundleId, rcGapStart),
              ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
            },
            select: { occurredAt: true, proceedsUsd: true },
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
      installs: number;
      deletions: number;
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
        installs: 0,
        deletions: 0,
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
        installs: 0,
        deletions: 0,
      });
      day.proceeds += p.proceedsUsd;
    }

    for (const r of rcRows) {
      const key = r.occurredAt.toISOString().slice(0, 10);
      const day = (byDayMap[key] ??= {
        date: key,
        downloads: 0,
        updates: 0,
        proceeds: 0,
        impressions: 0,
        pageViews: 0,
        taps: 0,
        sessions: 0,
        installs: 0,
        deletions: 0,
      });
      day.proceeds += r.proceedsUsd;
    }

    for (const r of installDeletionRows) {
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
        installs: 0,
        deletions: 0,
      });
      const event = r.event.toLowerCase();
      if (event.startsWith("delet")) day.deletions += r.counts;
      else if (event.startsWith("install")) day.installs += r.counts;
    }

    const byCountry = Object.entries(byCountryMap)
      .map(([country, v]) => ({ country, ...v }))
      .sort((a, b) => b.downloads - a.downloads);

    // Daily download series for the top countries, remainder folded into "Other".
    const topCountryCodes = byCountry.slice(0, 5).map((c) => c.country);
    const byCountryDayMap: Record<string, Record<string, number>> = {};
    let otherCountryTotal = 0;
    for (const r of rows) {
      const key = r.reportDate.toISOString().slice(0, 10);
      const label = topCountryCodes.includes(r.country) ? r.country : "Other";
      if (label === "Other") otherCountryTotal += r.downloads;
      const day = (byCountryDayMap[key] ??= {});
      day[label] = (day[label] ?? 0) + r.downloads;
    }
    const countrySeries = otherCountryTotal > 0 ? [...topCountryCodes, "Other"] : topCountryCodes;
    const byCountryDay = Object.entries(byCountryDayMap)
      .map(([date, values]) => {
        const filled: Record<string, number> = {};
        for (const c of countrySeries) filled[c] = values[c] ?? 0;
        return { date, ...filled };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

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
      countrySeries,
      byCountryDay,
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

// ─── GET /api/analytics/retention ────────────────────────────────────────────
// Device-based retention from Apple's App Sessions report: each session row
// carries the install-cohort date ("App Download Date"). Day-0 active devices
// of a cohort are the denominator; devices active n days later the numerator.
analyticsRouter.get("/retention", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const maxDay = 30;

    const rows = await prisma.appStoreSessionCohort.findMany({
      where: { bundleId },
      select: { reportDate: true, downloadDate: true, sessions: true, totalDuration: true, uniqueDevices: true },
    });

    let totalSessions = 0;
    let totalDuration = 0;
    // cohort downloadDate -> day offset -> active unique devices
    const activeAt: Record<string, Record<number, number>> = {};
    let latestDay = "";

    for (const r of rows) {
      totalSessions += r.sessions;
      totalDuration += r.totalDuration;
      if (!r.downloadDate) continue;
      const day = r.reportDate.toISOString().slice(0, 10);
      if (day > latestDay) latestDay = day;
      const offset = Math.round((Date.parse(day) - Date.parse(r.downloadDate)) / 86400000);
      if (offset < 0 || offset > maxDay) continue;
      const cohort = (activeAt[r.downloadDate] ??= {});
      cohort[offset] = (cohort[offset] ?? 0) + r.uniqueDevices;
    }

    const latestMs = latestDay ? Date.parse(latestDay) : 0;
    const curve: { day: number; retention: number; activeDevices: number; cohortDevices: number }[] = [];

    for (let day = 0; day <= maxDay; day++) {
      let active = 0;
      let cohortSize = 0;
      for (const [downloadDate, offsets] of Object.entries(activeAt)) {
        const day0 = offsets[0] ?? 0;
        if (day0 === 0) continue;
        // Only cohorts old enough that day n has already happened.
        if (Date.parse(downloadDate) + day * 86400000 > latestMs) continue;
        cohortSize += day0;
        active += offsets[day] ?? 0;
      }
      curve.push({
        day,
        retention: cohortSize > 0 ? (active / cohortSize) * 100 : 0,
        activeDevices: active,
        cohortDevices: cohortSize,
      });
    }

    const at = (day: number) => curve.find((c) => c.day === day);
    const hasData = (curve[0]?.cohortDevices ?? 0) > 0;

    res.json({
      curve: hasData ? curve : [],
      d1: at(1)?.retention ?? null,
      d7: at(7)?.retention ?? null,
      d30: at(30)?.retention ?? null,
      avgSessionSeconds: totalSessions > 0 ? totalDuration / totalSessions : null,
      totalSessions,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/analytics/trial-potential ───────────────────────────────────────
analyticsRouter.get("/trial-potential", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const app = req.bundleApp!;
    if (!app.trackId) {
      res.json({ reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] });
      return;
    }

    const key = `${app.teamId ?? req.user!.teamId}:${app.bundleId}`;
    let cached = trialPotentialCache.get(key);
    if (!cached || cached.expiresAt < Date.now()) {
      const settings = await getEffectiveSettingsForTeam(app.teamId ?? req.user!.teamId);
      const value = new AscAnalyticsService(settings).fetchTrialPotential(String(app.trackId), app.bundleId);
      cached = { expiresAt: Date.now() + 30 * 60_000, value };
      trialPotentialCache.set(key, cached);
      value.then(
        (result) => {
          if (!result.reportDate || result.unpricedTrials > 0) trialPotentialCache.delete(key);
        },
        () => trialPotentialCache.delete(key),
      );
    }
    res.json(await cached.value);
  } catch (err) {
    logger.warn(`Trial potential lookup failed: ${String(err)}`);
    res.status(502).json({ error: "Trial data unavailable" });
  }
});

// ─── GET /api/analytics/purchases ────────────────────────────────────────────
analyticsRouter.get("/purchases", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const rcGapStart = await revenueCatGapStart(bundleId);

    const rcSelect = {
      rcId: true,
      customerId: true,
      productId: true,
      store: true,
      environment: true,
      eventType: true,
      periodType: true,
      isTrialConversion: true,
      renewalNumber: true,
      transactionId: true,
      country: true,
      occurredAt: true,
      quantity: true,
      proceedsUsd: true,
      grossUsd: true,
    } as const;

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

    const oldestAscDate = rows.length ? rows[rows.length - 1].reportDate : rcGapStart;
    const rcRows = await prisma.revenueCatTransaction.findMany({
      where: { bundleId, occurredAt: { gte: oldestAscDate } },
      orderBy: { occurredAt: "desc" },
      take: Math.max(limit * 4, 2000),
      select: rcSelect,
    });

    type RcRow = (typeof rcRows)[number];

    const rcByDayCountry = new Map<string, RcRow[]>();
    for (const r of rcRows) {
      const key = `${r.occurredAt.toISOString().slice(0, 10)}|${(r.country ?? "").toUpperCase()}`;
      const bucket = rcByDayCountry.get(key);
      if (bucket) bucket.push(r);
      else rcByDayCountry.set(key, [r]);
    }

    function withinTolerance(a: number, b: number): boolean {
      return Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.15);
    }

    const matches = new Map<(typeof rows)[number], RcRow>();
    for (const r of rows) {
      const key = `${r.reportDate.toISOString().slice(0, 10)}|${r.territory.toUpperCase()}`;
      const bucket = rcByDayCountry.get(key);
      if (!bucket?.length) continue;
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < bucket.length; i++) {
        const diff = Math.abs(bucket[i].proceedsUsd - r.proceedsUsd);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && withinTolerance(bucket[bestIdx].proceedsUsd, r.proceedsUsd)) {
        matches.set(r, bucket.splice(bestIdx, 1)[0]);
      }
    }

    const subscriptionContentNames = new Set<string>();
    for (const [ascRow, rcRow] of matches) {
      if (rcRow.eventType !== "NON_RENEWING_PURCHASE") subscriptionContentNames.add(ascRow.contentName);
    }

    const standaloneRc: RcRow[] = [];
    for (const bucket of rcByDayCountry.values()) {
      for (const r of bucket) {
        if (r.store !== "app_store" || r.occurredAt >= rcGapStart) standaloneRc.push(r);
      }
    }

    const usedCustomerIds = new Set<string>();
    for (const r of matches.values()) usedCustomerIds.add(r.customerId);
    for (const r of standaloneRc) usedCustomerIds.add(r.customerId);

    const customers = usedCustomerIds.size
      ? await prisma.revenueCatCustomer.findMany({
          where: { bundleId, customerId: { in: [...usedCustomerIds] } },
          select: { customerId: true, platform: true, platformVersion: true, appVersion: true, country: true, attributes: true },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.customerId, c]));

    function toRcDetail(r: RcRow): RevenueCatDetail {
      const customer = customerById.get(r.customerId);
      return {
        id: r.rcId,
        customerId: r.customerId,
        productId: r.productId,
        store: r.store,
        environment: r.environment,
        eventType: r.eventType,
        periodType: r.periodType,
        isTrialConversion: r.isTrialConversion,
        renewalNumber: r.renewalNumber,
        transactionId: r.transactionId,
        country: r.country,
        proceedsUsd: r.proceedsUsd,
        grossUsd: r.grossUsd,
        customer: customer
          ? {
              platform: customer.platform,
              platformVersion: customer.platformVersion,
              appVersion: customer.appVersion,
              country: customer.country,
              attributes: (customer.attributes as Record<string, string | null> | null) ?? {},
            }
          : null,
      };
    }

    function transactionType(r: RcRow | null, contentName: string): string {
      if (!r) return subscriptionContentNames.has(contentName) ? "Subscription" : "One Time";
      if (r.eventType === "NON_RENEWING_PURCHASE") return "One Time";
      if (r.periodType === "TRIAL") return "Trial";
      if (r.eventType === "RENEWAL") return r.isTrialConversion ? "Trial Converted" : "Renewal";
      return "New Subscription";
    }

    const ascPurchases = rows.map((r) => {
      const match = matches.get(r) ?? null;
      return {
        date: r.reportDate.toISOString().slice(0, 10),
        source: "App Store Connect" as const,
        type: transactionType(match, r.contentName),
        contentName: r.contentName,
        paymentMethod: r.paymentMethod,
        territory: r.territory,
        purchases: r.purchases,
        proceedsUsd: r.proceedsUsd,
        salesUsd: r.salesUsd,
        payingUsers: r.payingUsers,
        revenueCat: match ? toRcDetail(match) : null,
      };
    });

    const rcStandalone = standaloneRc.map((r) => ({
      date: r.occurredAt.toISOString().slice(0, 10),
      source: "RevenueCat" as const,
      type: transactionType(r, ""),
      contentName: r.productId,
      paymentMethod: r.store,
      territory: r.country ?? "",
      purchases: r.quantity,
      proceedsUsd: r.proceedsUsd,
      salesUsd: r.grossUsd,
      payingUsers: 1,
      revenueCat: toRcDetail(r),
    }));

    const merged = [...ascPurchases, ...rcStandalone].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

    res.json(merged);
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

    const rcGapStart = await revenueCatGapStart(bundleId);

    const [rows, purchaseRows, rcRows] = await Promise.all([
      prisma.appStoreAnalytics.findMany({
        where: { bundleId },
        orderBy: { reportDate: "asc" },
        select: { reportDate: true, downloads: true, proceeds: true },
      }),
      prisma.appStoreCommercePurchase.findMany({
        where: { bundleId },
        select: { reportDate: true, proceedsUsd: true },
      }),
      prisma.revenueCatTransaction.findMany({
        where: revenueCatGapWhere(bundleId, rcGapStart),
        select: { occurredAt: true, proceedsUsd: true },
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
    for (const r of rcRows) {
      const key = r.occurredAt.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });
      d.proceeds += r.proceedsUsd;
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

// ─── GET /api/analytics/ratings ──────────────────────────────────────────────
// AppReview only covers *written* reviews (Apple's customerReviews API has no
// endpoint for star-only ratings), so the true aggregate rating/count — as
// shown on the App Store listing — is sourced from the periodic iTunes-lookup
// snapshots (AppSnapshot) instead, taken every 12h regardless of whether
// anything changed.
analyticsRouter.get("/ratings", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const appId = req.bundleApp!.id;
    const anchorSnapshot = await prisma.appSnapshot.findFirst({
      where: { appId },
      orderBy: { scrapedAt: "desc" },
      select: { scrapedAt: true, rating: true, ratingsCount: true },
    });
    const anchor = anchorSnapshot?.scrapedAt ?? new Date();
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};
    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const snapshots = await prisma.appSnapshot.findMany({
      where: {
        appId,
        rating: { not: null },
        ...(Object.keys(dateFilter).length ? { scrapedAt: dateFilter } : {}),
      },
      orderBy: { scrapedAt: "asc" },
      select: { scrapedAt: true, rating: true, ratingsCount: true },
    });

    const byDayMap: Record<string, { rating: number; ratingsCount: number | null }> = {};
    for (const s of snapshots) {
      const key = s.scrapedAt.toISOString().slice(0, 10);
      byDayMap[key] = { rating: s.rating!, ratingsCount: s.ratingsCount };
    }

    const byDay = Object.entries(byDayMap)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      byDay,
      current: {
        rating: anchorSnapshot?.rating ?? null,
        ratingsCount: anchorSnapshot?.ratingsCount ?? null,
      },
    });
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
    const hasAsc = !!(settings.ascIssuerId && settings.ascKeyId && settings.ascPrivateKey && settings.ascVendorNumber);

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
      select: { bundleId: true, trackId: true, name: true, revenueCatConnectedAt: true, revenueCatProjectId: true },
    });

    if (ownApps.length === 0) {
      res.status(400).json({
        error: "No own apps found. Add your app in the Apps section first and mark it as 'Own App'.",
      });
      return;
    }

    const anyRevenueCat = ownApps.some((a) => a.revenueCatConnectedAt && a.revenueCatProjectId);
    if (!hasAsc && !anyRevenueCat) {
      res.status(400).json({ error: "Neither App Store Connect nor RevenueCat is configured." });
      return;
    }

    const enqueued: string[] = [];
    for (const app of ownApps) {
      if (hasAsc && app.trackId) {
        await bossScheduler.sendJob(SYNC_ANALYTICS_QUEUE, {
          teamId,
          bundleId: app.bundleId,
          ascAppId: app.trackId.toString(),
        });
        logger.info(`[BOSS] Enqueued ${SYNC_ANALYTICS_QUEUE} for ${app.bundleId}`);
        enqueued.push("App Store Connect");
      }
      if (app.revenueCatConnectedAt && app.revenueCatProjectId) {
        await bossScheduler.sendJob(SYNC_REVENUECAT_QUEUE, { bundleId: app.bundleId });
        logger.info(`[BOSS] Enqueued ${SYNC_REVENUECAT_QUEUE} for ${app.bundleId}`);
        enqueued.push("RevenueCat");
      }
    }

    res.json({
      ok: true,
      message: `${[...new Set(enqueued)].join(" + ") || "Analytics"} sync enqueued for ${ownApps.map((a) => a.name).join(", ")}`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
