import { Router } from "express";
import { prisma, env, getEffectiveSettings } from "../../config";
import { requireAuth } from "../auth";
import { ensureAccentColor } from "../../services/utils/icon-accent";
import {
  buildDownloadsBreakdown,
  resolveSince,
  resolveUntil,
  revenueCatGapStart,
} from "./analytics-shared";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/all", async (req, res) => {
  try {
    const isAdmin = req.user!.role === "ADMIN";
    const teamId = req.user!.teamId;

    const ownApps = await prisma.app.findMany({
      where: isAdmin ? { isOwnApp: true } : teamId ? { teamId, isOwnApp: true } : { isOwnApp: true },
      select: { id: true, bundleId: true, revenueCatConnectedAt: true },
    });

    const appIds = ownApps.map((a) => a.id);
    const bundleIds = ownApps.map((a) => a.bundleId);

    const settings = await getEffectiveSettings(req.user!.userId);

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

    const [
      competitorCount,
      snapshotCount,
      keywordCount,
      rankingCount,
      pendingSuggestions,
      appliedSuggestions,
      recentSuggestions,
    ] = await Promise.all([
      prisma.competitorRelation.count({
        where: { OR: [{ appId: { in: appIds } }, { competitorId: { in: appIds } }] },
      }),
      prisma.appSnapshot.count({ where: { appId: { in: appIds } } }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "keywordId")::int AS count
        FROM "KeywordRanking"
        WHERE "appId" = ANY(${appIds}::text[])
      `.then(([r]) => Number(r.count)),
      prisma.keywordRanking.count({ where: { appId: { in: appIds } } }),
      prisma.aSOSuggestion.count({
        where: { status: "PENDING", appBundleId: { in: bundleIds } },
      }),
      prisma.aSOSuggestion.count({
        where: { status: "APPLIED", appBundleId: { in: bundleIds } },
      }),
      prisma.aSOSuggestion.findMany({
        where: { appBundleId: { in: bundleIds } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const gapStarts = await Promise.all(ownApps.map((a) => revenueCatGapStart(a.bundleId)));

    const [rows, purchaseRows, sourceRows, installDeletionRows, rcRows] = await Promise.all([
      prisma.appStoreAnalytics.findMany({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        orderBy: { reportDate: "asc" },
      }),
      prisma.appStoreCommercePurchase.findMany({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        select: { reportDate: true, proceedsUsd: true },
      }),
      prisma.appStoreCommerceDownload.groupBy({
        by: ["reportDate", "sourceType"],
        where: {
          bundleId: { in: bundleIds },
          downloadType: "First-time download",
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        _sum: { counts: true },
      }),
      prisma.appStoreInstallDeletion.findMany({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
        },
        select: { reportDate: true, event: true, counts: true },
      }),
      prisma.revenueCatTransaction.findMany({
        where: {
          bundleId: { in: bundleIds },
          ...(Object.keys(dateFilter).length ? { occurredAt: dateFilter } : {}),
          OR: ownApps.map((a, i) => ({
            bundleId: a.bundleId,
            OR: [{ store: { not: "app_store" } }, { occurredAt: { gte: gapStarts[i] } }],
          })),
        },
        select: { occurredAt: true, proceedsUsd: true },
      }),
    ]);

    res.json({
      dashboard: {
        app: null,
        stats: {
          apps: competitorCount,
          snapshots: snapshotCount,
          keywords: keywordCount,
          rankings: rankingCount,
          pendingSuggestions,
          appliedSuggestions,
        },
        config: {
          hasASC: !!(settings.ascIssuerId && settings.ascKeyId && settings.ascPrivateKey),
          hasRevenueCat: ownApps.some((a) => a.revenueCatConnectedAt != null),
          hasSearchAds: !!env.APPLE_ADS_CLIENT_ID,
        },
        recentSuggestions: recentSuggestions.map((s) => ({
          id: s.id,
          type: s.type,
          locale: s.locale,
          value: s.suggestedValue.substring(0, 80),
          confidence: s.confidenceScore,
          status: s.status,
          createdAt: s.createdAt,
        })),
      },
      downloads: buildDownloadsBreakdown({ rows, purchaseRows, sourceRows, installDeletionRows, rcRows }),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

dashboardRouter.get("/", async (req, res) => {
  try {
    const activeBundleId = req.query.bundleId as string | undefined;

    const ownApp = activeBundleId
      ? await prisma.app.findUnique({
          where: { bundleId: activeBundleId },
          include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
        })
      : null;

    if (ownApp && req.user!.role !== "ADMIN" && (!ownApp.teamId || ownApp.teamId !== req.user!.teamId)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const appId = ownApp?.id;
    let suggestionWhere: any;

    if (activeBundleId) {
      suggestionWhere = { appBundleId: activeBundleId };
    } else if (req.user!.role === "ADMIN") {
      suggestionWhere = {};
    } else {
      const teamApps = await prisma.app.findMany({
        where: { teamId: req.user!.teamId },
        select: { bundleId: true },
      });

      suggestionWhere = { appBundleId: { in: teamApps.map((a) => a.bundleId) } };
    }

    const [
      settings,
      competitorCount,
      snapshotCount,
      keywordCount,
      rankingCount,
      pendingSuggestions,
      appliedSuggestions,
      recentSuggestions,
    ] = await Promise.all([
      getEffectiveSettings(req.user!.userId),
      appId
        ? prisma.competitorRelation.count({
            where: { OR: [{ appId }, { competitorId: appId }] },
          })
        : Promise.resolve(0),
      appId ? prisma.appSnapshot.count({ where: { appId } }) : Promise.resolve(0),
      appId
        ? prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(DISTINCT "keywordId")::int AS count
            FROM "KeywordRanking"
            WHERE "appId" = ${appId}
          `.then(([r]) => Number(r.count))
        : Promise.resolve(0),
      appId ? prisma.keywordRanking.count({ where: { appId } }) : Promise.resolve(0),
      activeBundleId
        ? prisma.aSOSuggestion.count({
            where: { status: "PENDING", appBundleId: activeBundleId },
          })
        : Promise.resolve(0),
      activeBundleId
        ? prisma.aSOSuggestion.count({
            where: { status: "APPLIED", appBundleId: activeBundleId },
          })
        : Promise.resolve(0),
      prisma.aSOSuggestion.findMany({
        where: suggestionWhere,
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const iconUrl = ownApp?.snapshots[0]?.iconUrl ?? null;
    const accentColor = ownApp?.accentColor ?? null;

    if (ownApp && iconUrl && ownApp.accentColorIconUrl !== iconUrl) {
      ensureAccentColor(ownApp.id, iconUrl, {
        accentColor: ownApp.accentColor,
        accentColorIconUrl: ownApp.accentColorIconUrl,
      }).catch(() => {});
    }

    res.json({
      app: ownApp
        ? {
            name: ownApp.name,
            displayName: ownApp.displayName,
            bundleId: ownApp.bundleId,
            title: ownApp.currentTitle,
            subtitle: ownApp.currentSubtitle,
            keywords: ownApp.currentKeywords,
            rating: ownApp.snapshots[0]?.rating,
            ratingsCount: ownApp.snapshots[0]?.ratingsCount,
            iconUrl,
            accentColor,
          }
        : null,
      stats: {
        apps: competitorCount,
        snapshots: snapshotCount,
        keywords: keywordCount,
        rankings: rankingCount,
        pendingSuggestions,
        appliedSuggestions,
      },
      config: {
        hasASC: !!(settings.ascIssuerId && settings.ascKeyId && settings.ascPrivateKey),
        hasRevenueCat: !!ownApp?.revenueCatConnectedAt,
        hasSearchAds: !!env.APPLE_ADS_CLIENT_ID,
      },
      recentSuggestions: recentSuggestions.map((s) => ({
        id: s.id,
        type: s.type,
        locale: s.locale,
        value: s.suggestedValue.substring(0, 80),
        confidence: s.confidenceScore,
        status: s.status,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
