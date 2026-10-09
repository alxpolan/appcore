import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings, memberAllowedApp } from "../auth";
import { encrypt, decryptNullable } from "../../config/encryption";
import { listAppleAdsOrgs, listAppleAdsCampaigns, listAppleAdsAdGroups, getAppleAdsCampaignDetail, getAppleAdsCampaignDailySpend, resolveAppleAdsRange, listAppleAdsApps, createAppleAdsCampaignFull, validateCreateCampaignInput, listAppleAdsNegativeKeywords, createAppleAdsNegativeKeywordsBulk, deleteAppleAdsNegativeKeywordsBulk, type CreateAppleAdsCampaignInput, type CreateAppleAdsNegativeKeywordInput } from "../../services/apple-ads";
import { getAppleAdsCampaignRevenue } from "../../services/apple-ads-revenue";

export const appleAdsRouter = Router();
appleAdsRouter.use(requireAuth);

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
  res.json({
    connected: !!s?.appleAdsConnectedAt,
    orgId: s?.appleAdsOrgId ?? null,
    orgName: s?.appleAdsOrgName ?? null,
    connectedAt: s?.appleAdsConnectedAt?.toISOString() ?? null,
  });
});

appleAdsRouter.get("/campaigns", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const campaigns = await listAppleAdsCampaigns({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    }, resolveAppleAdsRange(req.query));
    res.json({ campaigns });
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
    if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
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

    const created = await createAppleAdsCampaignFull({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    }, input);
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
  if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
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
  try {
    storeApps = await listAppleAdsApps({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    });
  } catch (err: any) {
    logger.warn("[apple-ads] store apps fetch failed, falling back to team apps", { err: String(err?.message ?? err) });
    storeAppsAvailable = false;
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

appleAdsRouter.get("/campaigns/:campaignId/details", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const adGroups = await getAppleAdsCampaignDetail(
      {
        orgId: s.appleAdsOrgId,
        clientId: s.appleAdsClientId,
        teamId: s.appleAdsTeamId,
        keyId: s.appleAdsKeyId,
        privateKey: decryptNullable(s.appleAdsPrivateKey)!,
      },
      req.params.campaignId as string,
      resolveAppleAdsRange(req.query),
    );
    res.json({ adGroups });
  } catch (err: any) {
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
  if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const range = resolveAppleAdsRange(req.query);
    const days = await getAppleAdsCampaignDailySpend({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    }, req.params.campaignId as string, range);
    res.json({ days, startDate: range.startDate, endDate: range.endDate });
  } catch (err: any) {
    logger.error("[apple-ads] campaign daily spend fetch error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    res.status(500).json({ error: "Failed to load daily campaign spend from Apple Search Ads" });
  }
});

function validateNegativesBody(body: any): { adGroupId: string | null; keywords: CreateAppleAdsNegativeKeywordInput[] } {
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
  if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const creds = {
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    };
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
    if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
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

    const added = await createAppleAdsNegativeKeywordsBulk({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    }, req.params.campaignId as string, validated.adGroupId, validated.keywords);
    res.json({ added });
  } catch (err: any) {
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
    if (!s?.appleAdsConnectedAt || !s.appleAdsOrgId || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
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

    const deleted = await deleteAppleAdsNegativeKeywordsBulk({
      orgId: s.appleAdsOrgId,
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    }, req.params.campaignId as string, adGroupId?.trim() ?? null, ids);
    res.json({ deleted });
  } catch (err: any) {
    logger.error("[apple-ads] negatives delete error", {
      err: String(err?.message ?? err),
      status: err?.response?.status,
      body: err?.response?.data,
    });
    const status = err?.response?.status;
    res.status(status && status >= 400 && status < 500 ? 400 : 500).json({ error: appleWriteErrorMessage(err) });
  }
});

appleAdsRouter.get("/campaign-revenue", loadTeamSettings, async (req, res) => {
  const orgId = req.teamSettings?.appleAdsOrgId;
  if (!req.teamSettings?.appleAdsConnectedAt || !orgId) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const apps = await prisma.app.findMany({
      where: { teamId: req.user!.teamId, revenueCatConnectedAt: { not: null } },
      select: { id: true, bundleId: true, displayName: true, name: true },
    });
    const accessibleApps = req.user!.role === "ADMIN"
      ? apps
      : (await Promise.all(apps.map(async (app) => ({ app, allowed: await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id) }))))
          .filter(({ allowed }) => allowed).map(({ app }) => app);

    res.json(await getAppleAdsCampaignRevenue(accessibleApps, orgId, resolveAppleAdsRange(req.query)));
  } catch (err: any) {
    logger.error("[apple-ads] campaign revenue error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load campaign revenue" });
  }
});

appleAdsRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const { orgId, clientId, teamId: appleTeamId, keyId, privateKey } = req.body as Record<string, string>;

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
      res.status(400).json({ error: "Could not verify these credentials with Apple Search Ads. Double-check them and try again." });
      return;
    }

    // A key can see more than one org when it belongs to an agency/parent account.
    // Without an explicit pick we can't tell which one actually has the campaigns,
    // so hand the list back to the client instead of guessing.
    let selected = orgs.find((o) => o.orgId === orgId);
    if (!selected) {
      if (orgId) {
        res.status(400).json({ error: "That organization isn't accessible with this API key." });
        return;
      }
      if (orgs.length > 1) {
        res.json({ needsOrgSelection: true, orgs });
        return;
      }
      selected = orgs[0];
    }

    const connectedAt = new Date();
    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        appleAdsOrgId: selected.orgId,
        appleAdsOrgName: selected.orgName,
        appleAdsClientId: clientId,
        appleAdsTeamId: appleTeamId,
        appleAdsKeyId: keyId,
        appleAdsPrivateKey: encrypt(privateKey),
        appleAdsConnectedAt: connectedAt,
      },
      update: {
        appleAdsOrgId: selected.orgId,
        appleAdsOrgName: selected.orgName,
        appleAdsClientId: clientId,
        appleAdsTeamId: appleTeamId,
        appleAdsKeyId: keyId,
        appleAdsPrivateKey: encrypt(privateKey),
        appleAdsConnectedAt: connectedAt,
      },
    });

    res.json({ ok: true, orgId: selected.orgId, orgName: selected.orgName, connectedAt: connectedAt.toISOString() });
  } catch (err: any) {
    logger.error("[apple-ads] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

appleAdsRouter.get("/orgs", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;
  if (!s?.appleAdsConnectedAt || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
    res.status(400).json({ error: "Apple Search Ads is not connected" });
    return;
  }

  try {
    const orgs = await listAppleAdsOrgs({
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    });
    res.json({ orgs, selectedOrgId: s.appleAdsOrgId });
  } catch (err: any) {
    logger.error("[apple-ads] orgs fetch error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: "Failed to load organizations from Apple Search Ads" });
  }
});

appleAdsRouter.post("/org", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const s = await prisma.teamSettings.findUnique({ where: { teamId } });
    if (!s?.appleAdsConnectedAt || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey) {
      res.status(400).json({ error: "Apple Search Ads is not connected" });
      return;
    }

    const { orgId } = req.body as { orgId?: string };
    if (!orgId) {
      res.status(400).json({ error: "orgId is required" });
      return;
    }

    const orgs = await listAppleAdsOrgs({
      clientId: s.appleAdsClientId,
      teamId: s.appleAdsTeamId,
      keyId: s.appleAdsKeyId,
      privateKey: decryptNullable(s.appleAdsPrivateKey)!,
    });
    const match = orgs.find((o) => o.orgId === orgId);
    if (!match) {
      res.status(400).json({ error: "That organization isn't accessible with this API key." });
      return;
    }

    await prisma.teamSettings.update({
      where: { teamId },
      data: { appleAdsOrgId: match.orgId, appleAdsOrgName: match.orgName },
    });

    res.json({ ok: true, orgId: match.orgId, orgName: match.orgName });
  } catch (err: any) {
    logger.error("[apple-ads] org switch error", { err: String(err?.message ?? err) });
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
        appleAdsOrgId: null,
        appleAdsOrgName: null,
        appleAdsClientId: null,
        appleAdsTeamId: null,
        appleAdsKeyId: null,
        appleAdsPrivateKey: null,
        appleAdsConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
