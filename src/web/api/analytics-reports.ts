import { Router } from "express";
import { prisma } from "../../config";
import { requireBundleAccess } from "../auth";
import {
  DOWNLOAD_SOURCE_TYPES,
  downloadSourceLabel,
  getAnchorDate,
  majorVersionNumber,
  resolveSince,
  resolveUntil,
  revenueCatGapStart,
  revenueCatGapWhere,
} from "./analytics-shared";

export const analyticsRouter = Router();

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
