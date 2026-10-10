import { Router, type Request } from "express";
import { prisma, logger } from "../../config";
import {
  requireAuth,
  requireTeamAdmin,
  loadTeamSettings,
  memberAllowedApp,
  verifyAppOwnership,
  verifyAppOwnershipByBundleId,
} from "../auth";
import { encrypt, decryptNullable } from "../../config/encryption";
import { logActivity } from "../../services/activity-log";
import {
  listAppleAdsOrgs,
  listAppleAdsCampaigns,
  listAppleAdsAdGroups,
  getAppleAdsCampaignDetail,
  getAppleAdsCampaignDailySpend,
  resolveAppleAdsRange,
  listAppleAdsApps,
  createAppleAdsCampaignFull,
  validateCreateCampaignInput,
  listAppleAdsNegativeKeywords,
  createAppleAdsNegativeKeywordsBulk,
  deleteAppleAdsNegativeKeywordsBulk,
  updateAppleAdsCampaignStatus,
  deleteAppleAdsCampaign,
  getAppleAdsCampaignCountryBreakdown,
  getAppleAdsKeywordCountryBreakdown,
  listTeamAppleAdsOrgs,
  resolveAppOrgByAdamId,
  resolveCampaignOrgId,
  AppleAdsCampaignNotFoundError,
  type AppleAdsCredentials,
  type AppleAdsOrgCredentials,
  type CreateAppleAdsCampaignInput,
  type CreateAppleAdsNegativeKeywordInput,
} from "../../services/apple-ads";
import { getAppleAdsCampaignRevenue, mergeCountryRevenue } from "../../services/apple-ads-revenue";

export const appleAdsRouter = Router();
appleAdsRouter.use(requireAuth);

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

/** Credentials live at team level; the campaign group (org) is mapped per app. */
function appleAdsKeyMissing(s: any): boolean {
  return (
    !s?.appleAdsConnectedAt || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey
  );
}

function appleAdsKeyCreds(s: any): AppleAdsOrgCredentials {
  return {
    clientId: s.appleAdsClientId,
    teamId: s.appleAdsTeamId,
    keyId: s.appleAdsKeyId,
    privateKey: decryptNullable(s.appleAdsPrivateKey)!,
  };
}

/** Resolve the campaign group holding a campaign, scanning mapped groups. */
async function orgCredsForCampaign(
  teamId: string,
  keyCreds: AppleAdsOrgCredentials,
  campaignId: string,
): Promise<AppleAdsCredentials> {
  const orgs = await listTeamAppleAdsOrgs(teamId);
  const orgId = await resolveCampaignOrgId(
    keyCreds,
    orgs.map((o) => o.orgId),
    campaignId,
  );
  return { ...keyCreds, orgId };
}

function appleWriteErrorMessage(err: any): string {
  const data = err?.response?.data;
  const appleErr = data?.error;

  if (appleErr) {
    const details = Array.isArray(appleErr.errors)
      ? appleErr.errors.map((e: any) => e.message ?? e.messageCode ?? JSON.stringify(e)).join("; ")
      : (appleErr.message ?? JSON.stringify(appleErr));
    return `Apple Search Ads rejected the request: ${details}`;
  }

  return String(err?.message ?? err);
}

appleAdsRouter.get("/status", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  const connected = !appleAdsKeyMissing(s);
  const apps = await prisma.app.findMany({
    where: { teamId: req.user!.teamId, isOwnApp: true },
    select: {
      id: true,
      bundleId: true,
      name: true,
      displayName: true,
      appleAdsOrgId: true,
      appleAdsOrgName: true,
    },
    orderBy: { name: "asc" },
  });
  const visible =
    req.user!.role === "ADMIN"
      ? apps
      : (
          await Promise.all(
            apps.map(async (app) => ({
              app,
              allowed: await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id),
            })),
          )
        )
          .filter(({ allowed }) => allowed)
          .map(({ app }) => app);
  res.json({
    connected,
    connectedAt: s?.appleAdsConnectedAt?.toISOString() ?? null,
    apps: visible.map((app) => ({
      id: app.id,
      bundleId: app.bundleId,
      name: app.displayName ?? app.name,
      orgId: app.appleAdsOrgId,
      orgName: app.appleAdsOrgName,
    })),
  });
});

appleAdsRouter.get("/campaigns", loadTeamSettings, async (req, res) => {
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
    const lists = await Promise.all(orgIds.map((orgId) => listAppleAdsCampaigns({ ...keyCreds, orgId }, range)));
    res.json({ campaigns: lists.flat() });
  } catch (err: any) {
    logger.error("[apple-ads] campaigns fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });

    res.status(500).json({ error: "Failed to load campaigns from Apple Search Ads" });
  }
});

appleAdsRouter.post("/campaigns", loadTeamSettings, async (req, res) => {
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

appleAdsRouter.get("/apps", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
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

appleAdsRouter.patch("/campaigns/:campaignId/status", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;
    if (
      !s?.appleAdsConnectedAt ||
      !s.appleAdsClientId ||
      !s.appleAdsTeamId ||
      !s.appleAdsKeyId ||
      !s.appleAdsPrivateKey
    ) {
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

appleAdsRouter.delete("/campaigns/:campaignId", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;
    if (
      !s?.appleAdsConnectedAt ||
      !s.appleAdsClientId ||
      !s.appleAdsTeamId ||
      !s.appleAdsKeyId ||
      !s.appleAdsPrivateKey
    ) {
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

appleAdsRouter.get("/campaigns/:campaignId/details", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
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

appleAdsRouter.get("/campaigns/:campaignId/daily-spend", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const days = await getAppleAdsCampaignDailySpend(
      await orgCredsForCampaign(req.user!.teamId, appleAdsKeyCreds(s), req.params.campaignId as string),
      req.params.campaignId as string,
      range,
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

function countryBreakdownError(res: any, err: any, logCtx: string) {
  if (err instanceof AppleAdsCampaignNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  logger.error(logCtx, {
    err: String(err?.message ?? err),
    status: err?.response?.status,
    body: err?.response?.data,
  });
  // Apple reports failures as HTTP 200 with a body-level error; pass the
  // message through so the UI can show why (e.g. grouping unsupported).
  const message = String(err?.message ?? "");
  if (message.includes("reports error")) {
    res.status(400).json({ error: message });
    return;
  }
  res.status(500).json({ error: "Failed to load country breakdown from Apple Search Ads" });
}

appleAdsRouter.get("/campaigns/:campaignId/countries", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
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

appleAdsRouter.get(
  "/campaigns/:campaignId/adgroups/:adGroupId/keywords/:keywordId/countries",
  loadTeamSettings,
  async (req, res) => {
    const s = req.teamSettings;
    if (
      !s?.appleAdsConnectedAt ||
      !s.appleAdsClientId ||
      !s.appleAdsTeamId ||
      !s.appleAdsKeyId ||
      !s.appleAdsPrivateKey
    ) {
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

appleAdsRouter.get("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
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

appleAdsRouter.post("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;
    if (
      !s?.appleAdsConnectedAt ||
      !s.appleAdsClientId ||
      !s.appleAdsTeamId ||
      !s.appleAdsKeyId ||
      !s.appleAdsPrivateKey
    ) {
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

appleAdsRouter.delete("/campaigns/:campaignId/negatives", loadTeamSettings, async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const s = req.teamSettings;
    if (
      !s?.appleAdsConnectedAt ||
      !s.appleAdsClientId ||
      !s.appleAdsTeamId ||
      !s.appleAdsKeyId ||
      !s.appleAdsPrivateKey
    ) {
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

async function accessibleRevenueApps(req: Request) {
  const apps = await prisma.app.findMany({
    where: { teamId: req.user!.teamId, revenueCatConnectedAt: { not: null } },
    select: { id: true, bundleId: true, displayName: true, name: true },
  });
  if (req.user!.role === "ADMIN") return apps;
  const checked = await Promise.all(
    apps.map(async (app) => ({
      app,
      allowed: await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id),
    })),
  );
  return checked.filter(({ allowed }) => allowed).map(({ app }) => app);
}

appleAdsRouter.get("/campaign-revenue", loadTeamSettings, async (req, res) => {
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

appleAdsRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const { clientId, teamId: appleTeamId, keyId, privateKey } = req.body as Record<string, string>;

    if (!clientId || !appleTeamId || !keyId || !privateKey) {
      res.status(400).json({ error: "clientId, teamId, keyId and privateKey are all required" });
      return;
    }

    if (privateKey.includes("BEGIN PUBLIC KEY")) {
      res.status(400).json({
        error:
          "That's a public key. Apple Search Ads keys are generated by you: paste the private half you generated, not the one you uploaded to Apple.",
      });
      return;
    }

    const orgCreds = { clientId, teamId: appleTeamId, keyId, privateKey };

    let orgs: { orgId: string; orgName: string }[];
    try {
      orgs = await listAppleAdsOrgs(orgCreds);
    } catch (err: any) {
      logger.warn("[apple-ads] credential verification failed", {
        err: String(err?.message ?? err),
        status: err?.response?.status,
        body: err?.response?.data,
      });
      res
        .status(400)
        .json({ error: "Could not verify these credentials with Apple Search Ads. Double-check them and try again." });
      return;
    }

    // Credentials are team-wide; the campaign group is mapped per app
    // afterwards in the Integrations card.
    const connectedAt = new Date();
    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        appleAdsClientId: clientId,
        appleAdsTeamId: appleTeamId,
        appleAdsKeyId: keyId,
        appleAdsPrivateKey: encrypt(privateKey),
        appleAdsConnectedAt: connectedAt,
      },
      update: {
        appleAdsClientId: clientId,
        appleAdsTeamId: appleTeamId,
        appleAdsKeyId: keyId,
        appleAdsPrivateKey: encrypt(privateKey),
        appleAdsConnectedAt: connectedAt,
      },
    });

    res.json({ ok: true, orgs, connectedAt: connectedAt.toISOString() });
  } catch (err: any) {
    logger.error("[apple-ads] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

appleAdsRouter.get("/orgs", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (
    !s?.appleAdsConnectedAt ||
    !s.appleAdsClientId ||
    !s.appleAdsTeamId ||
    !s.appleAdsKeyId ||
    !s.appleAdsPrivateKey
  ) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const orgs = await listAppleAdsOrgs(appleAdsKeyCreds(s));
    res.json({ orgs });
  } catch (err: any) {
    logger.error("[apple-ads] orgs fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load organizations from Apple Search Ads" });
  }
});

appleAdsRouter.post("/app-org", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const s = await prisma.teamSettings.findUnique({ where: { teamId } });
    if (appleAdsKeyMissing(s)) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });
      return;
    }

    const { appId, orgId } = req.body as { appId?: string; orgId?: string | null };
    if (!appId) {
      res.status(400).json({ error: "appId is required" });
      return;
    }
    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;

    if (orgId == null || orgId === "") {
      await prisma.app.update({
        where: { id: app.id },
        data: { appleAdsOrgId: null, appleAdsOrgName: null },
      });
      res.json({ ok: true, appId: app.id, orgId: null, orgName: null });
      return;
    }

    const orgs = await listAppleAdsOrgs(appleAdsKeyCreds(s));
    const match = orgs.find((o) => o.orgId === orgId);
    if (!match) {
      res.status(400).json({ error: "That organization isn't accessible with this API key." });
      return;
    }

    await prisma.app.update({
      where: { id: app.id },
      data: { appleAdsOrgId: match.orgId, appleAdsOrgName: match.orgName },
    });

    res.json({ ok: true, appId: app.id, orgId: match.orgId, orgName: match.orgName });
  } catch (err: any) {
    logger.error("[apple-ads] app org mapping error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

appleAdsRouter.post("/disconnect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    await prisma.teamSettings.updateMany({
      where: { teamId },
      data: {
        appleAdsClientId: null,
        appleAdsTeamId: null,
        appleAdsKeyId: null,
        appleAdsPrivateKey: null,
        appleAdsConnectedAt: null,
      },
    });
    await prisma.app.updateMany({
      where: { teamId },
      data: { appleAdsOrgId: null, appleAdsOrgName: null },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
