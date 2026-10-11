import { Router, type Request } from "express";
import { prisma, logger, env } from "../../config";
import { requireTeamAdmin, loadTeamSettings, memberAllowedApp } from "../auth";
import {
  buildGoogleAdsAuthUrl,
  exchangeGoogleAdsCode,
  googleAdsOAuthAvailable,
  googleAdsOAuthRedirectUri,
  signGoogleAdsOAuthState,
  verifyGoogleAdsOAuthState,
} from "../../services/google-ads-oauth";
import { encrypt, decryptNullable } from "../../config/encryption";
import { logActivity } from "../../services/activity-log";
import {
  addGoogleAdsNegativeKeywords,
  createGoogleAdsCampaignFull,
  deleteGoogleAdsCampaign,
  deleteGoogleAdsNegativeKeywords,
  getGoogleAdsCampaignCountryBreakdown,
  getGoogleAdsCampaignDailySpend,
  getGoogleAdsCampaignDetail,
  googleAdsErrorMessage,
  googleAdsGateway,
  listGoogleAdsAdGroups,
  listGoogleAdsCampaigns,
  listGoogleAdsNegativeKeywords,
  resolveGoogleAdsRange,
  updateGoogleAdsCampaignStatus,
  validateGoogleAdsCreateCampaignInput,
  type GoogleAdsCredentials,
} from "../../services/google-ads";

export const googleAdsRouter = Router();

function webActor(req: Request) {
  return { teamId: req.user!.teamId, userId: req.user!.userId, actor: req.user!.email };
}

/** Best-effort read: history snapshots must never break the mutation itself. */
async function bestEffort<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

function googleAdsKeyMissing(s: any): boolean {
  return (
    !s?.googleAdsConnectedAt ||
    !s.googleAdsClientId ||
    !s.googleAdsClientSecret ||
    !s.googleAdsRefreshToken ||
    !s.googleAdsCustomerId
  );
}

function googleAdsCreds(s: any): GoogleAdsCredentials {
  return {
    customerId: String(s.googleAdsCustomerId).replace(/-/g, ""),
    clientId: s.googleAdsClientId,
    clientSecret: decryptNullable(s.googleAdsClientSecret)!,
    refreshToken: decryptNullable(s.googleAdsRefreshToken)!,
    developerToken: decryptNullable(s.googleAdsDeveloperToken) ?? undefined,
  };
}

googleAdsRouter.get("/status", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  res.json({
    connected: !googleAdsKeyMissing(s),
    customerId: s?.googleAdsCustomerId ?? null,
    connectedAt: s?.googleAdsConnectedAt?.toISOString() ?? null,
    oauthAvailable: googleAdsOAuthAvailable(),
    oauthRedirectUri: googleAdsOAuthRedirectUri(),
  });
});

googleAdsRouter.get("/campaigns", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (googleAdsKeyMissing(s)) {
    res.status(400).json({ error: "Google Ads is not connected" });
    return;
  }

  try {
    const campaigns = await listGoogleAdsCampaigns(googleAdsCreds(s), resolveGoogleAdsRange(req.query));
    res.json({ campaigns });
  } catch (err: any) {
    logger.error("[google-ads] campaigns fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "campaign list") });
  }
});

googleAdsRouter.post("/campaigns", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.get("/campaigns/:campaignId/details", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.get("/campaigns/:campaignId/daily-spend", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.get("/campaigns/:campaignId/countries", loadTeamSettings, async (req, res) => {
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
    res.json({ countries, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    logger.error("[google-ads] campaign country breakdown fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: googleAdsErrorMessage(err, "country breakdown") });
  }
});

googleAdsRouter.get("/campaigns/:campaignId/apple-revenue", loadTeamSettings, async (req, res) => {
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

    const totals = rows.reduce(
      (acc, r) => ({
        downloads: acc.downloads + r.downloads,
        purchases: acc.purchases + r.purchases,
        trials: acc.trials + r.trials,
        proceedsUsd: acc.proceedsUsd + r.proceedsUsd,
      }),
      { downloads: 0, purchases: 0, trials: 0, proceedsUsd: 0 },
    );
    res.json({
      mapped: true,
      app: mapping.app,
      ctToken: mapping.ctToken,
      range,
      totals,
      days: rows.map((r) => ({
        date: r.reportDate.toISOString().slice(0, 10),
        downloads: r.downloads,
        purchases: r.purchases,
        trials: r.trials,
        proceedsUsd: r.proceedsUsd,
      })),
    });
  } catch (err: any) {
    logger.error("[google-ads] apple revenue fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load Apple revenue" });
  }
});

googleAdsRouter.patch("/campaigns/:campaignId/apple-mapping", async (req, res) => {
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

googleAdsRouter.delete("/campaigns/:campaignId/apple-mapping", async (req, res) => {
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

googleAdsRouter.patch("/campaigns/:campaignId/status", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.delete("/campaigns/:campaignId", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.get("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.post("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.delete("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
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

googleAdsRouter.post("/oauth/start", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    if (!googleAdsOAuthAvailable()) {
      res.status(500).json({ error: "Google Ads OAuth is not configured on this server" });
      return;
    }

    const { customerId } = req.body as Record<string, string>;
    if (!customerId) {
      res.status(400).json({ error: "customerId is required" });
      return;
    }
    const normalizedCustomerId = String(customerId).replace(/-/g, "");
    if (!/^\d+$/.test(normalizedCustomerId)) {
      res.status(400).json({ error: "customerId must be the numeric Google Ads customer ID (dashes allowed)" });
      return;
    }

    const state = signGoogleAdsOAuthState({
      teamId: req.user!.teamId!,
      userId: req.user!.userId!,
      customerId: normalizedCustomerId,
    });
    res.json({ url: buildGoogleAdsAuthUrl(state) });
  } catch (err: any) {
    logger.error("[google-ads] oauth start error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

/** Public callback router (mounted without requireAuth): Google redirects the
 * browser here without our auth cookie. Security comes from the signed state
 * (created by an admin via /oauth/start, 10-min expiry) plus the admin
 * re-check below — same shape as the sign-in callback. */
export const googleAdsOAuthCallbackRouter = Router();

googleAdsOAuthCallbackRouter.get("/oauth/callback", async (req, res) => {
  const appUrl = env.APP_URL;
  const fail = (reason: string) =>
    res.redirect(`${appUrl}/integrations?googleAds=error&reason=${encodeURIComponent(reason)}`);

  try {
    if (req.query.error) return fail(String(req.query.error_description ?? req.query.error));
    const code = req.query.code as string | undefined;
    const stateRaw = req.query.state as string | undefined;
    if (!code || !stateRaw) return fail("missing_code_or_state");

    const parsed = verifyGoogleAdsOAuthState(stateRaw);
    if (!parsed) return fail("invalid_or_expired_state");

    const [oauthUser, oauthMember] = await Promise.all([
      prisma.user.findUnique({ where: { id: parsed.userId }, select: { role: true } }),
      prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: parsed.teamId, userId: parsed.userId } },
        select: { role: true },
      }),
    ]);
    const isAdmin =
      oauthUser?.role === "ADMIN" || oauthMember?.role === "OWNER" || oauthMember?.role === "ADMIN";
    if (!isAdmin) return fail("not_admin");

    const { refreshToken } = await exchangeGoogleAdsCode(code);

    const creds = {
      customerId: parsed.customerId,
      clientId: env.GOOGLE_ADS_OAUTH_CLIENT_ID!,
      clientSecret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET!,
      refreshToken,
    };
    try {
      const accessible = await googleAdsGateway(creds).listAccessibleCustomers();
      if (!accessible.some((name) => name.endsWith(`/${parsed.customerId}`))) {
        return fail("customer_not_accessible");
      }
    } catch {
      return fail("verification_failed");
    }

    const connectedAt = new Date();
    await prisma.teamSettings.upsert({
      where: { teamId: parsed.teamId },
      create: {
        teamId: parsed.teamId,
        googleAdsClientId: creds.clientId,
        googleAdsClientSecret: encrypt(creds.clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: parsed.customerId,
        googleAdsConnectedAt: connectedAt,
      },
      update: {
        googleAdsClientId: creds.clientId,
        googleAdsClientSecret: encrypt(creds.clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: parsed.customerId,
        googleAdsConnectedAt: connectedAt,
      },
    });

    logger.info("[google-ads] connected via OAuth", { teamId: parsed.teamId });
    res.redirect(`${appUrl}/integrations?googleAds=connected`);
  } catch (err: any) {
    logger.error("[google-ads] oauth callback error", { err: String(err?.message ?? err) });
    fail("callback_failed");
  }
});

googleAdsRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const { clientId, clientSecret, refreshToken, customerId } = req.body as Record<string, string>;

    if (!clientId || !clientSecret || !refreshToken || !customerId) {
      res.status(400).json({
        error: "clientId, clientSecret, refreshToken and customerId are all required",
      });
      return;
    }

    const normalizedCustomerId = String(customerId).replace(/-/g, "");
    if (!/^\d+$/.test(normalizedCustomerId)) {
      res.status(400).json({ error: "customerId must be the numeric Google Ads customer ID (dashes allowed)" });
      return;
    }

    try {
      const accessible = await googleAdsGateway({
        customerId: normalizedCustomerId,
        clientId,
        clientSecret,
        refreshToken,
      }).listAccessibleCustomers();
      if (!accessible.some((name) => name.endsWith(`/${normalizedCustomerId}`))) {
        res.status(400).json({ error: "That customer ID isn't accessible with these credentials." });
        return;
      }
    } catch (err: any) {
      logger.warn("[google-ads] credential verification failed", { err: String(err?.message ?? err) });
      res.status(400).json({ error: "Could not verify these credentials with Google Ads. Double-check them and try again." });
      return;
    }

    const connectedAt = new Date();
    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        googleAdsClientId: clientId,
        googleAdsClientSecret: encrypt(clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: normalizedCustomerId,
        googleAdsConnectedAt: connectedAt,
      },
      update: {
        googleAdsClientId: clientId,
        googleAdsClientSecret: encrypt(clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: normalizedCustomerId,
        googleAdsConnectedAt: connectedAt,
      },
    });

    res.json({ ok: true, customerId: normalizedCustomerId, connectedAt: connectedAt.toISOString() });
  } catch (err: any) {
    logger.error("[google-ads] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

googleAdsRouter.post("/disconnect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    await prisma.teamSettings.updateMany({
      where: { teamId },
      data: {
        googleAdsClientId: null,
        googleAdsClientSecret: null,
        googleAdsRefreshToken: null,
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: null,
        googleAdsConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    logger.error("[google-ads] disconnect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});
