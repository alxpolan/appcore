import { Router } from "express";
import { logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings } from "../auth";
import { logActivity } from "../../services/activity-log";
import {
  addGoogleAdsNegativeKeywords,
  deleteGoogleAdsNegativeKeywords,
  googleAdsErrorMessage,
  listGoogleAdsAdGroups,
  listGoogleAdsNegativeKeywords,
} from "../../services/google-ads";
import { webActor, bestEffort } from "./ads-shared";
import { googleAdsKeyMissing, googleAdsCreds } from "./google-ads-helpers";

export const googleAdsNegativesRouter = Router();

function validateNegativesBody(body: any): {
  adGroupId: string | null;
  keywords?: { text: string; matchType: "EXACT" | "PHRASE" | "BROAD" }[];
  ids?: (string | number)[];
} {
  const adGroupId = body?.adGroupId != null && body.adGroupId !== "" ? String(body.adGroupId) : null;

  if (body?.keywords != null) {
    if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
      throw new Error("keywords must be a non-empty array");
    }
    const keywords = body.keywords.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`keyword ${i + 1}: text is required`);
      const matchType = String(k?.matchType ?? "").toUpperCase();
      if (!["EXACT", "PHRASE", "BROAD"].includes(matchType)) {
        throw new Error(`keyword ${i + 1}: matchType must be one of EXACT, PHRASE, BROAD`);
      }

      return { text, matchType: matchType as "EXACT" | "PHRASE" | "BROAD" };
    });

    return { adGroupId, keywords };
  }

  if (body?.ids != null) {
    if (!Array.isArray(body.ids) || body.ids.length === 0) throw new Error("ids must be a non-empty array");

    return { adGroupId, ids: body.ids };
  }

  throw new Error("Either keywords or ids is required");
}

googleAdsNegativesRouter.get("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });

    return;
  }

  try {
    const creds = googleAdsCreds(s);
    const campaignId = req.params.campaignId as string;
    const [campaign, adGroups] = await Promise.all([
      listGoogleAdsNegativeKeywords(creds, campaignId, null),
      listGoogleAdsAdGroups(creds, campaignId),
    ]);

    const byAdGroup = await Promise.all(
      adGroups.map(async (g) => ({
        id: g.id,
        name: g.name,
        negatives: await listGoogleAdsNegativeKeywords(creds, campaignId, g.id),
      })),
    );

    res.json({ campaign, adGroups: byAdGroup });
  } catch (err: any) {
    logger.error("[google-ads] negatives fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "negatives list") });
  }
});

googleAdsNegativesRouter.post("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (googleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Google Ads is not connected" });

      return;
    }

    let validated;
    try {
      validated = validateNegativesBody(req.body);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    if (!validated.keywords) {
      res.status(400).json({ error: "keywords is required" });

      return;
    }

    const added = await addGoogleAdsNegativeKeywords(
      googleAdsCreds(s),
      req.params.campaignId as string,
      validated.adGroupId,
      validated.keywords,
    );

    const addedTexts = validated.keywords.map((k) => k.text);
    const addScope = validated.adGroupId ? `ad group ${validated.adGroupId}` : "campaign level";
    await logActivity({
      ...webActor(req),
      source: "web",
      action: "google_ads.negatives.add",
      entityType: "google_ads_campaign",
      entityId: req.params.campaignId as string,
      summary: `Added ${added.length} Google Ads negative keyword(s) (${addedTexts.map((t) => `"${t}"`).join(", ")}, ${addScope}, campaign ${req.params.campaignId})`,
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
    logger.error("[google-ads] negatives create error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "negatives add") });
  }
});

googleAdsNegativesRouter.delete("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;

    if (googleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Google Ads is not connected" });

      return;
    }

    let validated;
    try {
      validated = validateNegativesBody(req.body);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    if (!validated.ids) {
      res.status(400).json({ error: "ids is required" });

      return;
    }

    const ids = validated.ids;
    const scopeAdGroupId = validated.adGroupId;
    const creds = googleAdsCreds(s);

    const before = await bestEffort(() =>
      listGoogleAdsNegativeKeywords(creds, req.params.campaignId as string, scopeAdGroupId),
    );

    const want = new Set(ids.map((id: unknown) => String(id)));
    const removedTexts = (before ?? [])
      .filter((k) => want.has(String(k.id)))
      .map((k) => k.text)
      .slice(0, 10);

    const deleted = await deleteGoogleAdsNegativeKeywords(creds, req.params.campaignId as string, scopeAdGroupId, ids);
    const scope = scopeAdGroupId ? `ad group ${scopeAdGroupId}` : "campaign level";
    const texts = removedTexts.map((t) => `"${t}"`).join(", ");
    await logActivity({
      ...webActor(req),
      source: "web",
      action: "google_ads.negatives.delete",
      entityType: "google_ads_campaign",
      entityId: req.params.campaignId as string,
      summary: `Deleted ${deleted} Google Ads negative keyword(s) (${texts ? `${texts}, ` : ""}${scope}, campaign ${req.params.campaignId})`,
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
    logger.error("[google-ads] negatives delete error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "negatives delete") });
  }
});
