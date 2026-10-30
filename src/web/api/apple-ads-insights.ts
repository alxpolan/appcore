import { Router } from "express";
import { logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings } from "../auth";
import { logActivity } from "../../services/activity-log";
import {
  listAppleAdsAdGroups,
  resolveAppleAdsRange,
  listAppleAdsNegativeKeywords,
  createAppleAdsNegativeKeywordsBulk,
  deleteAppleAdsNegativeKeywordsBulk,
  getAppleAdsCampaignCountryBreakdown,
  getAppleAdsKeywordCountryBreakdown,
  getAppleAdsKeywordDeviceBreakdown,
  listTeamAppleAdsOrgs,
  AppleAdsCampaignNotFoundError,
  type CreateAppleAdsNegativeKeywordInput,
} from "../../services/apple-ads";
import { getAppleAdsCampaignRevenue, mergeCountryRevenue } from "../../services/apple-ads-revenue";
import { webActor, bestEffort } from "./ads-shared";
import { appleAdsKeyMissing, appleAdsKeyCreds, orgCredsForCampaign, appleWriteErrorMessage, countryBreakdownError, accessibleRevenueApps } from "./apple-ads-helpers";

export const appleAdsInsightsRouter = Router();

appleAdsInsightsRouter.get("/campaigns/:campaignId/countries", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const accessibleApps = await accessibleRevenueApps(req);
    const mappedOrgIds = (await listTeamAppleAdsOrgs(req.user!.teamId)).map((o) => o.orgId);
    const [apple, revenue] = await Promise.all([
      getAppleAdsCampaignCountryBreakdown(creds, req.params.campaignId as string, range),
      getAppleAdsCampaignRevenue(accessibleApps, mappedOrgIds, range),
    ]);

    const countries = mergeCountryRevenue(apple, revenue.byCampaign[req.params.campaignId as string]?.byCountry);

    res.json({ countries, revenueAvailable: accessibleApps.length > 0, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    countryBreakdownError(res, err, "[apple-ads] campaign country breakdown fetch error");
  }
});

appleAdsInsightsRouter.get(
  "/campaigns/:campaignId/adgroups/:adGroupId/keywords/:keywordId/countries",
  loadTeamSettings,
  async (req, res) => {
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    try {
      const range = resolveAppleAdsRange(req.query);
      const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
      const accessibleApps = await accessibleRevenueApps(req);
      const mappedOrgIds = (await listTeamAppleAdsOrgs(req.user!.teamId)).map((o) => o.orgId);
      const [apple, revenue] = await Promise.all([
        getAppleAdsKeywordCountryBreakdown(
          creds,
          req.params.campaignId as string,
          req.params.adGroupId as string,
          req.params.keywordId as string,
          range,
        ),
        getAppleAdsCampaignRevenue(accessibleApps, mappedOrgIds, range),
      ]);

      const keywordBucket =
        revenue.byCampaign[req.params.campaignId as string]?.byKeyword[req.params.keywordId as string];

      const countries = mergeCountryRevenue(apple, keywordBucket?.byCountry);

      res.json({ countries, revenueAvailable: accessibleApps.length > 0, startDate: range.startDate, endDate: range.endDate });
    } catch (err: any) {
      countryBreakdownError(res, err, "[apple-ads] keyword country breakdown fetch error");
    }
  },
);

appleAdsInsightsRouter.get(
  "/campaigns/:campaignId/adgroups/:adGroupId/keywords/:keywordId/devices",
  loadTeamSettings,
  async (req, res) => {
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    try {
      const range = resolveAppleAdsRange(req.query);
      const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
      const devices = await getAppleAdsKeywordDeviceBreakdown(
        creds,
        req.params.campaignId as string,
        req.params.adGroupId as string,
        req.params.keywordId as string,
        range,
      );

      res.json({ devices, startDate: range.startDate, endDate: range.endDate });
    } catch (err: any) {
      countryBreakdownError(res, err, "[apple-ads] keyword device breakdown fetch error");
    }
  },
);

function validateNegativesBody(body: any): {
  adGroupId: string | null;
  keywords: CreateAppleAdsNegativeKeywordInput[];
} {
  if (!body || typeof body !== "object") throw new Error("Request body is required");
  const adGroupId = body.adGroupId ?? null;

  if (adGroupId != null && (typeof adGroupId !== "string" || adGroupId.trim().length === 0)) {
    throw new Error("adGroupId must be a non-empty string or omitted for campaign-level negatives");
  }

  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    throw new Error("At least one keyword is required");
  }

  if (body.keywords.length > 500) throw new Error("At most 500 negative keywords can be added at once");
  const keywords = body.keywords.map((k: any, j: number) => {
    if (!k || typeof k !== "object") throw new Error(`keywords[${j}] must be an object`);

    if (k.matchType !== "EXACT" && k.matchType !== "BROAD") {
      throw new Error(`keywords[${j}].matchType must be "EXACT" or "BROAD"`);
    }

    if (typeof k.text !== "string" || k.text.trim().length === 0 || k.text.trim().length > 100) {
      throw new Error(`keywords[${j}].text must be 1–100 characters`);
    }

    return { text: k.text.trim(), matchType: k.matchType };
  });

  return { adGroupId: adGroupId?.trim() ?? null, keywords };
}

appleAdsInsightsRouter.get("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const campaignId = req.params.campaignId as string;
    const [campaign, adGroups] = await Promise.all([
      listAppleAdsNegativeKeywords(creds, campaignId, null),
      listAppleAdsAdGroups(creds, campaignId),
    ]);

    const byAdGroup = await Promise.all(
      adGroups.map(async (g) => ({
        id: g.id,
        name: g.name,
        negatives: await listAppleAdsNegativeKeywords(creds, campaignId, g.id),
      })),
    );

    res.json({ campaign, adGroups: byAdGroup });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] negatives fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: "Failed to load negative keywords from Apple Search Ads" });
  }
});

appleAdsInsightsRouter.post("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    let validated: { adGroupId: string | null; keywords: CreateAppleAdsNegativeKeywordInput[] };
    try {
      validated = validateNegativesBody(req.body);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    const added = await createAppleAdsNegativeKeywordsBulk(
      await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string),
      req.params.campaignId as string,
      validated.adGroupId,
      validated.keywords,
    );

    const addedTexts = validated.keywords.map((k) => k.text);
    const addScope = validated.adGroupId ? `ad group ${validated.adGroupId}` : "campaign level";

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.negatives.add",
      entityType: "ads_campaign",
      entityId: req.params.campaignId as string,
      summary: `Added ${added.length} negative keyword(s) (${addedTexts.map((t) => `"${t}"`).join(", ")}, ${addScope}, campaign ${req.params.campaignId})`,
      details: {
        campaignId: req.params.campaignId,
        adGroupId: validated.adGroupId,
        scope: addScope,
        added: addedTexts,
        removed: [],
      },
    });
    res.json({ added });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] negatives create error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsInsightsRouter.delete("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    const adGroupId = req.body?.adGroupId ?? null;

    if (adGroupId != null && (typeof adGroupId !== "string" || adGroupId.trim().length === 0)) {
      res.status(400).json({ error: "adGroupId must be a non-empty string or omitted for campaign-level negatives" });

      return;
    }

    const ids = req.body?.ids;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
      res.status(400).json({ error: "ids must be a non-empty array of at most 500 negative keyword ids" });

      return;
    }

    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const scopeAdGroupId = adGroupId?.trim() ?? null;
    const before = await bestEffort(() => listAppleAdsNegativeKeywords(creds, req.params.campaignId as string, scopeAdGroupId));
    const want = new Set(ids.map((id: unknown) => String(id)));
    const removedTexts = (before ?? [])
      .filter((k) => want.has(String(k.id)))
      .map((k) => k.text)
      .slice(0, 10);

    const deleted = await deleteAppleAdsNegativeKeywordsBulk(creds, req.params.campaignId as string, scopeAdGroupId, ids);
    const scope = scopeAdGroupId ? `ad group ${scopeAdGroupId}` : "campaign level";
    const texts = removedTexts.map((t) => `"${t}"`).join(", ");

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.negatives.delete",
      entityType: "ads_campaign",
      entityId: req.params.campaignId as string,
      summary: `Deleted ${deleted} negative keyword(s) (${texts ? `${texts}, ` : ""}${scope}, campaign ${req.params.campaignId})`,
      details: {
        campaignId: req.params.campaignId,
        adGroupId: scopeAdGroupId,
        scope,
        added: [],
        removed: removedTexts,
      },
    });
    res.json({ deleted });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] negatives delete error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsInsightsRouter.get("/campaign-revenue", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const accessibleApps = await accessibleRevenueApps(req);
    const mappedOrgIds = (await listTeamAppleAdsOrgs(req.user!.teamId)).map((o) => o.orgId);

    res.json(await getAppleAdsCampaignRevenue(accessibleApps, mappedOrgIds, resolveAppleAdsRange(req.query)));
  } catch (err: any) {
    logger.error("[apple-ads] campaign revenue error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load campaign revenue" });
  }
});
