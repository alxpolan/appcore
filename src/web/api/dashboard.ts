import { Router } from "express";
import { prisma, env, getEffectiveSettings } from "../../config";
import { requireAuth } from "../auth";
import { ensureAccentColor } from "../../services/utils/icon-accent";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

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
