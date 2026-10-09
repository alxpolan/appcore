import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings, memberAllowedApp } from "../auth";
import { encrypt, decryptNullable } from "../../config/encryption";
import { listAppleAdsOrgs, listAppleAdsCampaigns, getAppleAdsCampaignDetail, getAppleAdsCampaignDailySpend, resolveAppleAdsRange } from "../../services/apple-ads";
import { appleAdsCampaignAttribution } from "../../services/revenuecat-attribution";
import { buildTrialPriceMap, findCohortStart, isTrialConverted, trialPotentialFor } from "../../services/trial-pricing";

export const appleAdsRouter = Router();
appleAdsRouter.use(requireAuth);

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
    const bundleIds = accessibleApps.map((app) => app.bundleId);
    if (bundleIds.length === 0) {
      res.json({ byCampaign: {} });
      return;
    }

    // Evaluation window follows the selected range; pricing and cohort
    // lookbacks stay fixed since they need history beyond the window.
    const range = resolveAppleAdsRange(req.query);
    const start = new Date(`${range.startDate}T00:00:00Z`);
    const until = new Date(`${range.endDate}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + 1);
    // Trial pricing looks further back so new trials still find a paid
    // reference for their product even without recent conversions.
    const priceStart = new Date();
    priceStart.setUTCDate(priceStart.getUTCDate() - 90);
    priceStart.setUTCHours(0, 0, 0, 0);
    const [customers, transactions, priceSamples] = await Promise.all([
      prisma.revenueCatCustomer.findMany({
        where: { bundleId: { in: bundleIds } },
        select: { bundleId: true, customerId: true, appleAttribution: true, attributes: true },
      }),
      prisma.revenueCatTransaction.findMany({
        where: { bundleId: { in: bundleIds }, occurredAt: { gte: start, lt: until }, environment: "production" },
        select: { rcId: true, bundleId: true, customerId: true, productId: true, eventType: true, periodType: true, isTrialConversion: true, occurredAt: true, proceedsUsd: true },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.revenueCatTransaction.groupBy({
        by: ["bundleId", "productId"],
        where: { bundleId: { in: bundleIds }, occurredAt: { gte: priceStart }, environment: "production", proceedsUsd: { gt: 0 } },
        _avg: { proceedsUsd: true },
      }),
    ]);
    const trialPrices = buildTrialPriceMap(
      priceSamples.map((sample) => ({
        bundleId: sample.bundleId,
        productId: sample.productId,
        avgProceedsUsd: sample._avg.proceedsUsd ?? 0,
      })),
    );

    // Cohort links: trial starts and conversions for the customers in the
    // window, so conversions attribute back to their trial-start day and
    // converted trials carry no open potential anymore.
    const cohortLookback = new Date();
    cohortLookback.setUTCDate(cohortLookback.getUTCDate() - 365);
    cohortLookback.setUTCHours(0, 0, 0, 0);
    const cohortCustomerIds = [...new Set(transactions.map((transaction) => transaction.customerId))];
    const cohortSelect = { bundleId: true, customerId: true, productId: true, occurredAt: true } as const;
    let trialStarts: { bundleId: string; customerId: string; productId: string; occurredAt: Date }[] = [];
    let trialConversions: { bundleId: string; customerId: string; productId: string; occurredAt: Date }[] = [];
    if (cohortCustomerIds.length > 0) {
      [trialStarts, trialConversions] = await Promise.all([
        prisma.revenueCatTransaction.findMany({
          where: { bundleId: { in: bundleIds }, customerId: { in: cohortCustomerIds }, eventType: "INITIAL_PURCHASE", periodType: "TRIAL", occurredAt: { gte: cohortLookback, lt: until } },
          select: cohortSelect,
        }),
        prisma.revenueCatTransaction.findMany({
          where: { bundleId: { in: bundleIds }, customerId: { in: cohortCustomerIds }, isTrialConversion: true, occurredAt: { gte: cohortLookback, lt: until } },
          select: cohortSelect,
        }),
      ]);
    }

    const attributionByCustomer = new Map(customers.map((customer) => [
      `${customer.bundleId}\0${customer.customerId}`,
      appleAdsCampaignAttribution(customer.appleAttribution, customer.attributes),
    ]));
    const appNameByBundle = new Map(accessibleApps.map((app) => [app.bundleId, app.displayName || app.name]));
    type RevenueTransaction = {
      id: string;
      date: string;
      cohortDate: string | null;
      app: string;
      product: string;
      eventType: string;
      isTrial: boolean;
      isConvertedTrial: boolean;
      proceedsUsd: number;
      potentialProceedsUsd: number;
    };
    type RevenueBucket = { proceedsUsd: number; transactions: RevenueTransaction[] };
    const byCampaign: Record<string, RevenueBucket & { byKeyword: Record<string, RevenueBucket> }> = {};

    for (const transaction of transactions) {
      const attribution = attributionByCustomer.get(`${transaction.bundleId}\0${transaction.customerId}`);
      if (!attribution || (attribution.orgId && attribution.orgId !== orgId)) continue;

      const isTrial = transaction.periodType === "TRIAL" && transaction.eventType === "INITIAL_PURCHASE";
      const cohortEvent = { bundleId: transaction.bundleId, customerId: transaction.customerId, productId: transaction.productId, occurredAt: transaction.occurredAt };
      const convertedTrial = isTrial && isTrialConverted(trialConversions, cohortEvent);
      const cohortStart = transaction.isTrialConversion ? findCohortStart(trialStarts, cohortEvent) : null;
      const entry: RevenueTransaction = {
        id: transaction.rcId,
        date: transaction.occurredAt.toISOString(),
        cohortDate: cohortStart ? cohortStart.toISOString() : null,
        app: appNameByBundle.get(transaction.bundleId) ?? transaction.bundleId,
        product: transaction.productId,
        eventType: transaction.eventType,
        isTrial,
        isConvertedTrial: convertedTrial,
        proceedsUsd: transaction.proceedsUsd,
        potentialProceedsUsd: convertedTrial ? 0 : trialPotentialFor(trialPrices, transaction.bundleId, transaction.productId, isTrial),
      };

      const campaign = byCampaign[attribution.campaignId] ??= { proceedsUsd: 0, transactions: [], byKeyword: {} };
      campaign.proceedsUsd += transaction.proceedsUsd;
      campaign.transactions.push(entry);

      // Not every click carries a keyword (e.g. Search Match, or non-keyword
      // placements) — those still count toward the campaign total above, but
      // can't be attributed to one specific keyword below.
      if (attribution.keywordId) {
        const keyword = campaign.byKeyword[attribution.keywordId] ??= { proceedsUsd: 0, transactions: [] };
        keyword.proceedsUsd += transaction.proceedsUsd;
        keyword.transactions.push(entry);
      }
    }

    res.json({ byCampaign });
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
