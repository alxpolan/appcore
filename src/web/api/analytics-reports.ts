import { Router } from "express";
import { prisma } from "../../config";
import { requireBundleAccess } from "../auth";
import {
  buildDownloadsBreakdown,
  fetchDownloadsInput,
  getAnchorDate,
  getOwnTeamApps,
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

analyticsRouter.get("/all", async (req, res) => {
  try {
    const ownApps = await getOwnTeamApps({ role: req.user!.role, teamId: req.user!.teamId });
    const bundleIds = ownApps.map((a) => a.bundleId);

    const anchorRow = await prisma.appStoreAnalytics.findFirst({
      where: { bundleId: { in: bundleIds } },
      orderBy: { reportDate: "desc" },
      select: { reportDate: true },
    });
    const anchor = anchorRow?.reportDate ?? new Date();
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};

    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const [metricAgg, reviewAgg, purchaseAgg, rcAgg, rcCustomers, lastSyncAgg] = await Promise.all([
      prisma.appStoreAnalytics.aggregate({
        where: {
          bundleId: { in: bundleIds },
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
        where: { bundleId: { in: bundleIds } },
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.appStoreCommercePurchase.aggregate({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        _sum: { payingUsers: true, proceedsUsd: true },
      }),
      prisma.revenueCatTransaction.aggregate({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
          ...(bundleIds.length
            ? {
                OR: await Promise.all(
                  bundleIds.map(async (bundleId) => {
                    const gapStart = await revenueCatGapStart(bundleId);

                    return {
                      bundleId,
                      OR: [{ store: { not: "app_store" } }, { occurredAt: { gte: gapStart } }],
                    };
                  }),
                ),
              }
            : {}),
        },
        _sum: { proceedsUsd: true },
      }),
      prisma.revenueCatTransaction.groupBy({
        by: ["customerId"],
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
        },
      }),
      prisma.appStoreAnalytics.aggregate({
        where: { bundleId: { in: bundleIds } },
        _max: { createdAt: true },
      }),
    ]);

    const downloads = metricAgg._sum.downloads ?? 0;
    const impressions = metricAgg._sum.impressions ?? 0;
    const pageViews = metricAgg._sum.pageViews ?? 0;

    const downloadsInput = await fetchDownloadsInput(bundleIds, dateFilter);

    res.json({
      summary: {
        totalDownloads: downloads,
        totalProceeds:
          (metricAgg._sum.proceeds ?? 0) + (purchaseAgg._sum.proceedsUsd ?? 0) + (rcAgg._sum.proceedsUsd ?? 0),
        totalImpressions: impressions,
        totalPageViews: pageViews,
        totalTaps: metricAgg._sum.taps ?? 0,
        totalSessions: metricAgg._sum.sessions ?? 0,
        totalPayingUsers: (purchaseAgg._sum.payingUsers ?? 0) + rcCustomers.length,
        minimumOsVersion: null,
        impressionsBelowMinOs: null,
        conversionRate: impressions > 0 ? (downloads / impressions) * 100 : null,
        avgRating: reviewAgg._avg.rating ?? null,
        reviewCount: reviewAgg._count.id,
        lastSyncAt: lastSyncAgg._max.createdAt ?? null,
      },
      downloads: buildDownloadsBreakdown(downloadsInput),
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

    res.json(buildDownloadsBreakdown({ rows, purchaseRows, sourceRows, installDeletionRows, rcRows }));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
