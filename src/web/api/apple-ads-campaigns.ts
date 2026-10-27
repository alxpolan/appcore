import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings, verifyAppOwnershipByBundleId } from "../auth";
import { logActivity } from "../../services/activity-log";
import {
  listAppleAdsCampaigns,
  listAppleAdsApps,
  listAppleAdsSearchTerms,
  getAppleAdsCampaignDetail,
  getAppleAdsDailyStats,
  mergeDailyStatsLists,
  resolveAppleAdsRange,
  createAppleAdsCampaignFull,
  validateCreateCampaignInput,
  updateAppleAdsCampaignStatus,
  deleteAppleAdsCampaign,
  listTeamAppleAdsOrgs,
  resolveAppOrgByAdamId,
  AppleAdsCampaignNotFoundError,
  type CreateAppleAdsCampaignInput,
} from "../../services/apple-ads";
import { webActor, bestEffort } from "./ads-shared";
import { appleAdsKeyMissing, appleAdsKeyCreds, orgCredsForCampaign, appleWriteErrorMessage } from "./apple-ads-helpers";

export const appleAdsCampaignsRouter = Router();

appleAdsCampaignsRouter.get("/campaigns", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const keyCreds = appleAdsKeyCreds(s);
    const bundleId = req.query.bundleId as string | undefined;
    let orgIds: string[];
    let groupAppId: string | null = null;

    if (bundleId) {
      const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
      if (!app) return;

      if (!app.appleAdsOrgId) {
        res.status(400).json({ error: "No campaign group mapped for this app — map one in Integrations." });

        return;
      }

      groupAppId = app.id;
      orgIds = [app.appleAdsOrgId];
    } else {
      orgIds = (await listTeamAppleAdsOrgs(req.user!.teamId)).map((o) => o.orgId);
    }

    const lists = await Promise.all(orgIds.map((orgId) => listAppleAdsCampaigns({ ...keyCreds, orgId }, range)));
    const campaigns = lists.flat();

    if (!groupAppId) {
      res.json({ campaigns });

      return;
    }

    const members = await prisma.appleAdsCampaignGroupMember.findMany({
      where: { appId: groupAppId, externalCampaignId: { in: campaigns.map((c) => c.id) } },
      select: { externalCampaignId: true, groupId: true },
    });

    const groupByCampaign = new Map(members.map((m) => [m.externalCampaignId, m.groupId]));

    res.json({ campaigns: campaigns.map((c) => ({ ...c, groupId: groupByCampaign.get(c.id) ?? null })) });
  } catch (err: any) {
    logger.error("[apple-ads] campaigns fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    res.status(500).json({ error: "Failed to load campaigns from Apple Search Ads" });
  }
});

appleAdsCampaignsRouter.get("/daily", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const keyCreds = appleAdsKeyCreds(s);
    const bundleId = req.query.bundleId as string | undefined;
    let orgIds: string[];

    if (bundleId) {
      const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
      if (!app) return;

      if (!app.appleAdsOrgId) {
        res.status(400).json({ error: "No campaign group mapped for this app — map one in Integrations." });

        return;
      }

      orgIds = [app.appleAdsOrgId];
    } else {
      orgIds = (await listTeamAppleAdsOrgs(req.user!.teamId)).map((o) => o.orgId);
    }

    const lists = await Promise.all(
      orgIds.map((orgId) => getAppleAdsDailyStats({ ...keyCreds, orgId }, range)),
    );

    res.json({ days: mergeDailyStatsLists(lists), startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    logger.error("[apple-ads] daily stats fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    res.status(500).json({ error: "Failed to load daily stats from Apple Search Ads" });
  }
});

appleAdsCampaignsRouter.post("/campaigns", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    let input: CreateAppleAdsCampaignInput;
    try {
      input = validateCreateCampaignInput(req.body);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    const mapping = await resolveAppOrgByAdamId(req.user!.teamId, input.adamId);

    if (!mapping) {
      res.status(400).json({ error: "No campaign group mapped for the advertised app — map one in Integrations." });

      return;
    }

    const created = await createAppleAdsCampaignFull({ ...appleAdsKeyCreds(s), orgId: mapping.orgId }, input);

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.campaign.create",
      entityType: "ads_campaign",
      entityId: created.id,
      summary: `Created campaign "${created.name}" (${created.status}) with ${created.adGroups.length} ad group(s)`,
      details: {
        name: input.name,
        adamId: input.adamId,
        orgId: mapping.orgId,
        countriesOrRegions: input.countriesOrRegions,
        dailyBudgetAmount: input.dailyBudgetAmount,
        budgetAmount: input.budgetAmount ?? null,
        currency: input.currency,
        supplySources: input.supplySources,
        adGroups: created.adGroups.map((g) => ({ name: g.name, keywords: g.keywordCount, negatives: g.negativeKeywordCount })),
        negativeKeywordCount: created.negativeKeywordCount,
      },
    });
    res.json({ campaign: created });
  } catch (err: any) {
    logger.error("[apple-ads] campaign create error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
      partialResult: (err as any)?.partialResult,
    });

    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsCampaignsRouter.get("/apps", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  const teamApps = await prisma.app.findMany({
    where: { teamId: req.user!.teamId, trackId: { not: null } },
    select: { trackId: true, name: true, displayName: true, bundleId: true },
    orderBy: { name: "asc" },
  });

  let storeAppsAvailable = true;
  let storeApps: { adamId: string; name: string }[] = [];

  const mappedOrgs = await listTeamAppleAdsOrgs(req.user!.teamId);

  if (mappedOrgs.length === 0) {
    storeAppsAvailable = false;
  } else {
    try {
      storeApps = await listAppleAdsApps({ ...appleAdsKeyCreds(s), orgId: mappedOrgs[0].orgId });
    } catch (err: any) {
      logger.warn("[apple-ads] store apps fetch failed, falling back to team apps", { err: String(err?.message ?? err) });
      storeAppsAvailable = false;
    }
  }

  const apps = new Map<string, { adamId: string; name: string; bundleId: string | null }>();
  for (const a of teamApps) {
    if (a.trackId == null) continue;
    apps.set(String(a.trackId), { adamId: String(a.trackId), name: a.displayName ?? a.name, bundleId: a.bundleId });
  }
  for (const a of storeApps) {
    if (!apps.has(a.adamId)) apps.set(a.adamId, { adamId: a.adamId, name: a.name, bundleId: null });
  }
  res.json({ apps: [...apps.values()], storeAppsAvailable });
});

appleAdsCampaignsRouter.patch("/campaigns/:campaignId/status", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    const status = req.body?.status;

    if (status !== "ENABLED" && status !== "PAUSED") {
      res.status(400).json({ error: 'status must be "ENABLED" or "PAUSED"' });

      return;
    }

    const creds = await orgCredsForCampaign(
      req.user!.teamId,
      appleAdsKeyCreds(s),
      req.params.campaignId as string,
    );

    const before = await bestEffort(() => listAppleAdsCampaigns(creds));
    const prev = before?.find((c) => String(c.id) === String(req.params.campaignId));

    const updated = await updateAppleAdsCampaignStatus(creds, req.params.campaignId as string, status);

    const verb = status === "ENABLED" ? "Published" : "Paused";
    const target = prev?.name ? `"${prev.name}" (${updated.id})` : `campaign ${updated.id}`;
    const transition = prev?.status ? `: ${prev.status} → ${status}` : "";

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.campaign.status",
      entityType: "ads_campaign",
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
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] campaign status error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsCampaignsRouter.delete("/campaigns/:campaignId", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const before = await bestEffort(() => listAppleAdsCampaigns(creds));
    const prev = before?.find((c) => String(c.id) === String(req.params.campaignId));

    const deleted = await deleteAppleAdsCampaign(creds, req.params.campaignId as string);

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.campaign.delete",
      entityType: "ads_campaign",
      entityId: deleted.id,
      summary: prev?.name ? `Deleted campaign "${prev.name}" (${deleted.id})` : `Deleted campaign ${deleted.id}`,
      details: { campaignId: deleted.id, name: prev?.name ?? null },
    });
    res.json({ campaign: deleted });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] campaign delete error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsCampaignsRouter.get("/campaigns/:campaignId/details", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const adGroups = await getAppleAdsCampaignDetail(
      await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string),
      req.params.campaignId as string,
      resolveAppleAdsRange(req.query),
    );

    res.json({ adGroups });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] campaign detail fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: "Failed to load campaign detail from Apple Search Ads" });
  }
});

appleAdsCampaignsRouter.get("/campaigns/:campaignId/search-terms", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const searchTerms = await listAppleAdsSearchTerms(
      await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string),
      req.params.campaignId as string,
      resolveAppleAdsRange(req.query),
    );

    res.json({ searchTerms });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] search terms fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: "Failed to load search terms from Apple Search Ads" });
  }
});

appleAdsCampaignsRouter.get("/campaigns/:campaignId/daily-spend", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const days = await getAppleAdsDailyStats(
      await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string),
      range,
      req.params.campaignId as string,
    );

    res.json({ days, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] campaign daily spend fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: "Failed to load daily campaign spend from Apple Search Ads" });
  }
});
