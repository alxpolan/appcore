import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings, memberAllowedApp } from "../auth";
import {
  aggregateAppleMetricsByCampaign,
  attachCampaignMappings,
  filterCampaignsByApp,
  sumMergedDownloadsPerDay,
  WEB_METRICS_TERRITORY,
  type AppleMetricsKey,
} from "../../services/utils/google-ads-mapping";
import { logActivity } from "../../services/activity-log";
import {
  createGoogleAdsCampaignFull,
  deleteGoogleAdsCampaign,
  getGoogleAdsCampaignCountryBreakdown,
  getGoogleAdsCampaignDailySpend,
  getGoogleAdsCampaignDetail,
  getGoogleAdsDailyStats,
  googleAdsErrorMessage,
  listGoogleAdsCampaigns,
  listGoogleAdsSearchTerms,
  resolveGoogleAdsRange,
  updateGoogleAdsCampaignStatus,
  validateGoogleAdsCreateCampaignInput,
} from "../../services/google-ads";
import { webActor, bestEffort } from "./ads-shared";
import { googleAdsKeyMissing, googleAdsCreds } from "./google-ads-helpers";

export const googleAdsCampaignsRouter = Router();

googleAdsCampaignsRouter.get("/campaigns", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const range = resolveGoogleAdsRange(req.query);
    const campaigns = await listGoogleAdsCampaigns(googleAdsCreds(s), range);
    const appId = typeof req.query.appId === "string" && req.query.appId ? req.query.appId : undefined;
    const stored = await prisma.googleAdsCampaignToken.findMany({
      where: { teamId: req.user!.teamId!, ...(appId ? { appId } : {}) },
      include: { app: { select: { bundleId: true } } },
    });
    const visible = appId
      ? filterCampaignsByApp(campaigns, stored.map((m) => m.googleCampaignId))
      : campaigns;

    const visibleIds = new Set(visible.map((c) => c.id));
    const appleKeys: AppleMetricsKey[] = [];
    for (const m of stored) {
      if (!visibleIds.has(m.googleCampaignId)) continue;
      if (
        req.user!.role !== "ADMIN" &&
        !(await memberAllowedApp(req.user!.userId, req.user!.teamId!, m.appId))
      ) {
        continue;
      }
      appleKeys.push({ googleCampaignId: m.googleCampaignId, bundleId: m.app.bundleId, ctToken: m.ctToken });
    }
    const end = new Date(`${range.endDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const rows = appleKeys.length
      ? await prisma.appStoreCampaignMetrics.findMany({
          where: {
            OR: appleKeys.map((k) => ({ bundleId: k.bundleId, campaign: k.ctToken })),
            reportDate: { gte: new Date(`${range.startDate}T00:00:00Z`), lt: end },
          },
          select: {
            bundleId: true,
            campaign: true,
            reportDate: true,
            territory: true,
            downloads: true,
            trials: true,
            purchases: true,
            proceedsUsd: true,
          },
        })
      : [];

    const appleByCampaign = aggregateAppleMetricsByCampaign(rows, appleKeys);
    res.json({ campaigns: visible.map((c) => ({ ...c, apple: appleByCampaign.get(c.id) ?? null })) });
  } catch (err: any) {
    logger.error("[google-ads] campaigns fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign list") });
  }
});

googleAdsCampaignsRouter.get("/daily", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const range = resolveGoogleAdsRange(req.query);
    const appId = typeof req.query.appId === "string" && req.query.appId ? req.query.appId : undefined;
    let campaignIds: string[] | undefined;

    if (appId) {
      const stored = await prisma.googleAdsCampaignToken.findMany({
        where: { teamId: req.user!.teamId!, appId },
        select: { googleCampaignId: true },
      });
      campaignIds = stored.map((m) => m.googleCampaignId);
    }

    const days = await getGoogleAdsDailyStats(googleAdsCreds(s), range, campaignIds);
    const installKeys = await prisma.googleAdsCampaignToken.findMany({
      where: { teamId: req.user!.teamId!, ...(appId ? { appId } : {}) },
      include: { app: { select: { bundleId: true } } },
    });
    if (installKeys.length > 0) {
      const end = new Date(`${range.endDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const metricsRows = await prisma.appStoreCampaignMetrics.findMany({
        where: {
          OR: installKeys.map((k) => ({ bundleId: k.app.bundleId, campaign: k.ctToken })),
          reportDate: { gte: new Date(`${range.startDate}T00:00:00Z`), lt: end },
        },
        select: {
          bundleId: true,
          campaign: true,
          reportDate: true,
          territory: true,
          downloads: true,
          trials: true,
          purchases: true,
          proceedsUsd: true,
        },
      });
      const installsByDay = sumMergedDownloadsPerDay(metricsRows);
      for (const d of days) d.installs = installsByDay.get(d.date) ?? 0;
    }
    res.json({ days, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    logger.error("[google-ads] daily stats fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "daily stats") });
  }
});

googleAdsCampaignsRouter.get("/campaign-mappings", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const [campaigns, stored] = await Promise.all([
      listGoogleAdsCampaigns(googleAdsCreds(s)),
      prisma.googleAdsCampaignToken.findMany({
        where: { teamId: req.user!.teamId! },
        include: { app: { select: { id: true, displayName: true, name: true } } },
      }),
    ]);

    const mappings: Array<{ googleCampaignId: string; appId: string; appName: string; ctToken: string }> = [];
    for (const m of stored) {
      if (
        req.user!.role !== "ADMIN" &&
        !(await memberAllowedApp(req.user!.userId, req.user!.teamId!, m.appId))
      ) {
        continue;
      }
      mappings.push({
        googleCampaignId: m.googleCampaignId,
        appId: m.appId,
        appName: m.app.displayName ?? m.app.name,
        ctToken: m.ctToken,
      });
    }
    res.json({ campaigns: attachCampaignMappings(campaigns, mappings) });
  } catch (err: any) {
    logger.error("[google-ads] campaign mappings fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign mappings") });
  }
});

googleAdsCampaignsRouter.post("/campaigns", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (googleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Google Ads is not connected" });

      return;
    }

    let input;
    try {
      input = validateGoogleAdsCreateCampaignInput(req.body);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    const created = await createGoogleAdsCampaignFull(googleAdsCreds(s), input);

    const keywordCount = created.adGroups.reduce((n, g) => n + g.keywords.length, 0);
    await logActivity({
      ...webActor(req),
      source: "web",
      action: "google_ads.campaign.create",
      entityType: "google_ads_campaign",
      entityId: created.id,
      summary: `Created Google Ads campaign "${created.name}" (${created.id}) with ${created.adGroups.length} ad group(s), ${keywordCount} keyword(s)`,
      details: {
        name: input.name,
        status: input.status,
        dailyBudgetAmount: input.dailyBudgetAmount,
        adGroups: created.adGroups.map((g) => ({ id: g.id, name: g.name, keywords: g.keywords.length })),
      },
    });
    res.json({ campaign: created });
  } catch (err: any) {
    logger.error("[google-ads] campaign create error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign creation") });
  }
});

googleAdsCampaignsRouter.get("/campaigns/:campaignId/details", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const adGroups = await getGoogleAdsCampaignDetail(
      googleAdsCreds(s),
      req.params.campaignId as string,
      resolveGoogleAdsRange(req.query),
    );

    res.json({ adGroups });
  } catch (err: any) {
    logger.error("[google-ads] campaign detail fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign detail") });
  }
});

googleAdsCampaignsRouter.get("/campaigns/:campaignId/search-terms", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const searchTerms = await listGoogleAdsSearchTerms(
      googleAdsCreds(s),
      req.params.campaignId as string,
      resolveGoogleAdsRange(req.query),
    );

    res.json({ searchTerms });
  } catch (err: any) {
    logger.error("[google-ads] search terms fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load search terms from Google Ads" });
  }
});

googleAdsCampaignsRouter.get("/campaigns/:campaignId/daily-spend", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const range = resolveGoogleAdsRange(req.query);
    const days = await getGoogleAdsCampaignDailySpend(googleAdsCreds(s), req.params.campaignId as string, range);
    res.json({ days, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    logger.error("[google-ads] campaign daily spend fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "daily spend") });
  }
});

googleAdsCampaignsRouter.get("/campaigns/:campaignId/countries", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const range = resolveGoogleAdsRange(req.query);
    const countries = await getGoogleAdsCampaignCountryBreakdown(
      googleAdsCreds(s),
      req.params.campaignId as string,
      range,
    );
    // Apple revenue per country (per-territory rows; the XW remainder is
    // unattributed and not shown per country).
    const mapping = await prisma.googleAdsCampaignToken.findUnique({
      where: { teamId_googleCampaignId: { teamId: req.user!.teamId!, googleCampaignId: req.params.campaignId as string } },
      include: { app: { select: { bundleId: true } } },
    });
    const revenueAllowed =
      !!mapping &&
      (req.user!.role === "ADMIN" || (await memberAllowedApp(req.user!.userId, req.user!.teamId!, mapping.appId)));
    const revenueByTerritory = new Map<string, { installs: number; trials: number; proceedsUsd: number }>();
    if (revenueAllowed && mapping) {
      const end = new Date(`${range.endDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const rows = await prisma.appStoreCampaignMetrics.findMany({
        where: {
          bundleId: mapping.app.bundleId,
          campaign: mapping.ctToken,
          territory: { not: WEB_METRICS_TERRITORY },
          reportDate: { gte: new Date(`${range.startDate}T00:00:00Z`), lt: end },
        },
        select: { territory: true, downloads: true, trials: true, proceedsUsd: true },
      });
      for (const r of rows) {
        const e = revenueByTerritory.get(r.territory) ?? { installs: 0, trials: 0, proceedsUsd: 0 };
        e.installs += r.downloads;
        e.trials += r.trials;
        e.proceedsUsd += r.proceedsUsd;
        revenueByTerritory.set(r.territory, e);
      }
    }

    res.json({
      countries: countries.map((c) => {
        const e = revenueByTerritory.get(c.countryOrRegion);
        return {
          ...c,
          installs: revenueAllowed ? (e?.installs ?? 0) : null,
          trials: revenueAllowed ? (e?.trials ?? 0) : null,
          proceedsUsd: revenueAllowed ? (e?.proceedsUsd ?? 0) : null,
        };
      }),
      revenueAvailable: revenueAllowed,
      startDate: range.startDate,
      endDate: range.endDate,
    });
  } catch (err: any) {
    logger.error("[google-ads] campaign country breakdown fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "country breakdown") });
  }
});

googleAdsCampaignsRouter.patch("/campaigns/:campaignId/status", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (googleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Google Ads is not connected" });

      return;
    }

    const status = req.body?.status;

    if (status !== "ENABLED" && status !== "PAUSED") {
      res.status(400).json({ error: 'status must be "ENABLED" or "PAUSED"' });

      return;
    }

    const creds = googleAdsCreds(s);
    const before = await bestEffort(() => listGoogleAdsCampaigns(creds));
    const prev = before?.find((c) => String(c.id) === String(req.params.campaignId));

    const updated = await updateGoogleAdsCampaignStatus(creds, req.params.campaignId as string, status);

    const verb = status === "ENABLED" ? "Published" : "Paused";
    const target = prev?.name ? `"${prev.name}" (${updated.id})` : `campaign ${updated.id}`;
    const transition = prev?.status ? `: ${prev.status} → ${status}` : "";
    await logActivity({
      ...webActor(req),
      source: "web",
      action: "google_ads.campaign.status",
      entityType: "google_ads_campaign",
      entityId: updated.id,
      summary: `${verb} ${target}${transition}`,
      details: {
        campaignId: updated.id,
        name: prev?.name ?? null,
        changes: [{ label: "Status", from: prev?.status ?? null, to: status }],
      },
    });
    res.json({ campaign: updated });
  } catch (err: any) {
    logger.error("[google-ads] campaign status error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign status update") });
  }
});

googleAdsCampaignsRouter.delete("/campaigns/:campaignId", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (googleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Google Ads is not connected" });

      return;
    }

    const creds = googleAdsCreds(s);
    const before = await bestEffort(() => listGoogleAdsCampaigns(creds));
    const prev = before?.find((c) => String(c.id) === String(req.params.campaignId));

    const deleted = await deleteGoogleAdsCampaign(creds, req.params.campaignId as string);
    await logActivity({
      ...webActor(req),
      source: "web",
      action: "google_ads.campaign.delete",
      entityType: "google_ads_campaign",
      entityId: deleted.id,
      summary: prev?.name
        ? `Deleted Google Ads campaign "${prev.name}" (${deleted.id})`
        : `Deleted Google Ads campaign ${deleted.id}`,
      details: { campaignId: deleted.id, name: prev?.name ?? null },
    });
    res.json({ campaign: deleted });
  } catch (err: any) {
    logger.error("[google-ads] campaign delete error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign delete") });
  }
});
