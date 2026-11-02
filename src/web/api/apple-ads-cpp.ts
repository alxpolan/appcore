import { Router } from "express";
import { logger } from "../../config";
import { loadTeamSettings, requireTeamAdmin } from "../auth";
import { logActivity } from "../../services/activity-log";
import {
  assignCustomProductPageToAdGroup,
  getAppleAdsCampaign,
  listAppleAdsAds,
  listAppleAdsProductPages,
  AppleAdsCampaignNotFoundError,
} from "../../services/apple-ads";
import { webActor } from "./ads-shared";
import { appleAdsKeyMissing, appleAdsKeyCreds, orgCredsForCampaign, appleWriteErrorMessage } from "./apple-ads-helpers";

export const appleAdsCppRouter = Router();

appleAdsCppRouter.get("/campaigns/:campaignId/product-pages", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const campaign = await getAppleAdsCampaign(creds, req.params.campaignId as string);

    if (!campaign.adamId) {
      res.status(400).json({ error: `Campaign ${campaign.id} has no adamId on record` });

      return;
    }

    const productPages = await listAppleAdsProductPages(creds, campaign.adamId);

    res.json({ productPages });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] product pages fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsCppRouter.get("/campaigns/:campaignId/adgroups/:adGroupId/ads", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (appleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });

    return;
  }

  try {
    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string);
    const ads = await listAppleAdsAds(creds, req.params.campaignId as string, req.params.adGroupId as string);

    res.json({ ads });
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] ad group ads fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsCppRouter.post("/campaigns/:campaignId/adgroups/:adGroupId/cpp", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });

      return;
    }

    const { productPageId, name } = req.body as { productPageId?: string; name?: string };
    const status = req.body?.status === "PAUSED" ? "PAUSED" : "ENABLED";

    if (!productPageId || !name) {
      res.status(400).json({ error: "productPageId and name are required" });

      return;
    }

    const campaignId = req.params.campaignId as string;
    const adGroupId = req.params.adGroupId as string;
    const creds = await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), campaignId);
    const campaign = await getAppleAdsCampaign(creds, campaignId);

    if (!campaign.adamId) {
      res.status(400).json({ error: `Campaign ${campaign.id} has no adamId on record` });

      return;
    }

    const result = await assignCustomProductPageToAdGroup(
      creds,
      campaign.adamId,
      campaignId,
      adGroupId,
      productPageId,
      name,
      status,
    );

    await logActivity({
      ...webActor(req),
      source: "web",
      action: "ads.adgroup.cpp",
      entityType: "ads_ad_group",
      entityId: adGroupId,
      summary: `Connected Custom Product Page "${name}" to ad group ${adGroupId}`,
      details: { campaignId, adGroupId, productPageId, creativeId: result.creative.id, adId: result.ad.id },
    });

    res.json(result);
  } catch (err: any) {
    if (err instanceof AppleAdsCampaignNotFoundError) {
      res.status(404).json({ error: err.message });

      return;
    }

    logger.error("[apple-ads] assign cpp error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    const status = err?.response?.status;

    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});
