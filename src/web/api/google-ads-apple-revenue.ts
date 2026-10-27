import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings, memberAllowedApp } from "../auth";
import { resolveGoogleAdsRange } from "../../services/google-ads";
import { mergeCampaignDayMetrics } from "../../services/utils/google-ads-mapping";

export const googleAdsAppleRevenueRouter = Router();

googleAdsAppleRevenueRouter.get("/campaigns/:campaignId/apple-revenue", loadTeamSettings, async (req, res) => {
  try {
    const mapping = await prisma.googleAdsCampaignToken.findUnique({
      where: { teamId_googleCampaignId: { teamId: req.user!.teamId!, googleCampaignId: req.params.campaignId as string } },
      include: { app: { select: { id: true, bundleId: true, displayName: true, name: true } } },
    });

    if (!mapping) {
      res.json({ mapped: false });

      return;
    }

    if (req.user!.role !== "ADMIN" && !(await memberAllowedApp(req.user!.userId, req.user!.teamId!, mapping.appId))) {
      res.status(404).json({ error: "Not found" });

      return;
    }

    const range = resolveGoogleAdsRange(req.query);
    const end = new Date(`${range.endDate}T00:00:00Z`);

    end.setUTCDate(end.getUTCDate() + 1);
    const rows = await prisma.appStoreCampaignMetrics.findMany({
      where: {
        bundleId: mapping.app.bundleId,
        campaign: mapping.ctToken,
        reportDate: { gte: new Date(`${range.startDate}T00:00:00Z`), lt: end },
      },
      orderBy: { reportDate: "asc" },
    });

    const days = mergeCampaignDayMetrics(
      rows.map((r) => ({
        date: r.reportDate.toISOString().slice(0, 10),
        territory: r.territory,
        downloads: r.downloads,
        purchases: r.purchases,
        trials: r.trials,
        proceedsUsd: r.proceedsUsd,
      })),
    );

    const totals = days.reduce(
      (acc, d) => ({
        downloads: acc.downloads + d.downloads,
        purchases: acc.purchases + d.purchases,
        trials: acc.trials + d.trials,
        proceedsUsd: acc.proceedsUsd + d.proceedsUsd,
      }),
      { downloads: 0, purchases: 0, trials: 0, proceedsUsd: 0 },
    );

    const priceStart = new Date();

    priceStart.setUTCDate(priceStart.getUTCDate() - 90);
    priceStart.setUTCHours(0, 0, 0, 0);
    const priceSample = await prisma.revenueCatTransaction.aggregate({
      where: {
        bundleId: mapping.app.bundleId,
        occurredAt: { gte: priceStart },
        environment: "production",
        proceedsUsd: { gt: 0 },
      },
      _avg: { proceedsUsd: true },
    });

    const avgTrialValueUsd = Math.round((priceSample._avg.proceedsUsd ?? 0) * 100) / 100;

    res.json({
      mapped: true,
      app: mapping.app,
      ctToken: mapping.ctToken,
      range,
      totals,
      days,
      avgTrialValueUsd,
    });
  } catch (err: any) {
    logger.error("[google-ads] apple revenue fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load Apple revenue" });
  }
});

googleAdsAppleRevenueRouter.patch("/campaigns/:campaignId/apple-mapping", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;
    const { appId, ctToken } = req.body as { appId?: string; ctToken?: string };

    if (!appId || !ctToken?.trim()) {
      res.status(400).json({ error: "appId and ctToken are both required" });

      return;
    }

    const app = await prisma.app.findFirst({ where: { id: appId, teamId }, select: { id: true } });

    if (!app) {
      res.status(404).json({ error: "App not found on this team" });

      return;
    }

    const mapping = await prisma.googleAdsCampaignToken.upsert({
      where: { teamId_googleCampaignId: { teamId, googleCampaignId: req.params.campaignId as string } },
      create: { teamId, googleCampaignId: req.params.campaignId as string, appId, ctToken: ctToken.trim() },
      update: { appId, ctToken: ctToken.trim() },
    });

    res.json({ mapping: { appId: mapping.appId, ctToken: mapping.ctToken } });
  } catch (err: any) {
    logger.error("[google-ads] apple mapping save error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to save mapping" });
  }
});

googleAdsAppleRevenueRouter.delete("/campaigns/:campaignId/apple-mapping", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    await prisma.googleAdsCampaignToken.deleteMany({
      where: { teamId: req.user!.teamId!, googleCampaignId: req.params.campaignId as string },
    });
    res.json({ ok: true });
  } catch (err: any) {
    logger.error("[google-ads] apple mapping delete error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to delete mapping" });
  }
});
