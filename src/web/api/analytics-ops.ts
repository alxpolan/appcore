import { prisma, logger, getEffectiveSettingsForTeam } from "../../config";
import { requireAuth, requireBundleAccess } from "../auth";
import { bossScheduler } from "../../jobs/boss";
import { QUEUE_NAME as SYNC_ANALYTICS_QUEUE } from "../../jobs/workers/sync-analytics.worker";
import { QUEUE_NAME as SYNC_REVENUECAT_QUEUE } from "../../jobs/workers/sync-revenuecat.worker";
import { resolveSince, resolveUntil } from "./analytics-shared";
import { analyticsRouter } from "./analytics-reports";

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
