import axios from "./utils/http";
import { API_BASE, authedHeaders, fetchAppleAdsAccessToken, money, throwIfAppleError, toAppleAdsDateTime } from "./apple-ads-auth";
import { listAppleAdsKeywords } from "./apple-ads-reports";
import type {
  AppleAdsCredentials,
  AppleAdsNegativeKeyword,
  CreateAppleAdsAdGroupInput,
  CreateAppleAdsCampaignInput,
  CreateAppleAdsKeywordInput,
  CreateAppleAdsNegativeKeywordInput,
  CreatedAppleAdsCampaign,
  UpdateAppleAdsAdGroupInput,
  UpdateAppleAdsCampaignInput,
  UpdateAppleAdsKeywordInput,
} from "./apple-ads-types";

export async function createAppleAdsCampaign(
  creds: AppleAdsCredentials,
  input: CreateAppleAdsCampaignInput,
): Promise<{ id: string; name: string; status: string }> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const pricingModel = input.pricingModel ?? "CPC";
  const res = await axios.post<any>(
    `${API_BASE}/campaigns`,
    {
      name: input.name,
      adamId: input.adamId,
      countriesOrRegions: input.countriesOrRegions,
      dailyBudgetAmount: money(input.dailyBudgetAmount, input.currency),
      ...(input.budgetAmount != null ? { budgetAmount: money(input.budgetAmount, input.currency) } : {}),
      supplySources: input.supplySources,
      adChannelType: "SEARCH",
      billingEvent: pricingModel === "CPM" ? "IMPRESSIONS" : "TAPS",
      status: input.status ?? "PAUSED",
      ...(input.startTime ? { startTime: toAppleAdsDateTime(input.startTime) } : {}),
    },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "campaign creation");
  const created = res.data?.data;
  if (created?.id == null) throw new Error("Apple Search Ads campaign creation returned no campaign id");

  return { id: String(created.id), name: String(created.name ?? input.name), status: String(created.status ?? "") };
}

export async function createAppleAdsAdGroup(
  creds: AppleAdsCredentials,
  campaignId: string,
  currency: string,
  pricingModel: "CPC" | "CPM",
  startTime: string | undefined,
  input: CreateAppleAdsAdGroupInput,
): Promise<{ id: string; name: string }> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/campaigns/${campaignId}/adgroups`,
    {
      name: input.name,
      defaultBidAmount: money(input.defaultBidAmount, currency),
      ...(input.cpaGoal != null ? { cpaGoal: money(input.cpaGoal, currency) } : {}),
      pricingModel,
      status: input.status ?? "ENABLED",
      startTime: startTime ?? toAppleAdsDateTime(new Date().toISOString().slice(0, 10)),
    },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "ad group creation");
  const created = res.data?.data;
  if (created?.id == null) throw new Error("Apple Search Ads ad group creation returned no ad group id");

  return { id: String(created.id), name: String(created.name ?? input.name) };
}

export async function createAppleAdsKeywordsBulk(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  currency: string,
  keywords: CreateAppleAdsKeywordInput[],
): Promise<number> {
  if (keywords.length === 0) return 0;
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
    keywords.map((k) => ({
      text: k.text,
      matchType: k.matchType,
      status: "ACTIVE",
      ...(k.bidAmount != null ? { bidAmount: money(k.bidAmount, currency) } : {}),
    })),
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "keyword creation");
  const created = res.data?.data;

  return Array.isArray(created) ? created.length : keywords.length;
}

export async function updateAppleAdsCampaignStatus(
  creds: AppleAdsCredentials,
  campaignId: string,
  status: "ENABLED" | "PAUSED",
): Promise<{ id: string; status: string }> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.put<any>(
    `${API_BASE}/campaigns/${campaignId}`,
    { campaign: { status } },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "campaign update");
  const updated = res.data?.data;
  if (updated?.id == null) throw new Error("Apple Search Ads campaign update returned no campaign");

  return { id: String(updated.id), status: String(updated.status ?? "") };
}

export async function deleteAppleAdsCampaign(
  creds: AppleAdsCredentials,
  campaignId: string,
): Promise<{ id: string; deleted: boolean }> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.delete<any>(`${API_BASE}/campaigns/${campaignId}`, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "campaign deletion");

  return { id: String(res.data?.data?.id ?? campaignId), deleted: true };
}

export async function updateAppleAdsCampaign(
  creds: AppleAdsCredentials,
  campaignId: string,
  input: UpdateAppleAdsCampaignInput,
): Promise<{ id: string; name: string; status: string }> {
  const patch: Record<string, unknown> = {};

  if (input.name != null) {
    if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 100) {
      throw new Error("name must be 1–100 characters");
    }

    patch.name = input.name.trim();
  }

  if (input.status != null) {
    if (input.status !== "ENABLED" && input.status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');
    patch.status = input.status;
  }

  if (input.dailyBudgetAmount != null) {
    if (typeof input.dailyBudgetAmount !== "number" || !Number.isFinite(input.dailyBudgetAmount) || input.dailyBudgetAmount <= 0) {
      throw new Error("dailyBudgetAmount must be a number greater than 0");
    }

    const currency = input.currency?.toUpperCase();

    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error("currency (e.g. USD, EUR) is required when setting dailyBudgetAmount");
    }

    patch.dailyBudgetAmount = money(input.dailyBudgetAmount, currency);
  }

  if (input.countriesOrRegions != null) {
    const countries = [...new Set(input.countriesOrRegions.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    if (countries.length === 0) throw new Error("countriesOrRegions must contain at least one country");
    for (const c of countries) {
      if (!/^[A-Z]{2}$/.test(c)) throw new Error(`Invalid country code "${c}" — use two-letter codes like US, DE`);
    }

    patch.countriesOrRegions = countries;
  }

  if (Object.keys(patch).length === 0) throw new Error("Nothing to update: pass at least one field");

  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.put<any>(`${API_BASE}/campaigns/${campaignId}`, { campaign: patch }, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "campaign update");
  const updated = res.data?.data;
  if (updated?.id == null) throw new Error("Apple Search Ads campaign update returned no campaign");

  return { id: String(updated.id), name: String(updated.name ?? ""), status: String(updated.status ?? "") };
}

function asUpdateMoney(amount: number | undefined, currency: string | undefined, field: string): { amount: string; currency: string } | undefined {
  if (amount == null) return undefined;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${field} must be a number greater than 0`);
  }

  const code = currency?.toUpperCase();
  if (!code || !/^[A-Z]{3}$/.test(code)) throw new Error(`currency (e.g. USD, EUR) is required when setting ${field}`);

  return money(amount, code);
}

export async function updateAppleAdsAdGroup(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  input: UpdateAppleAdsAdGroupInput,
): Promise<{ id: string; name: string; status: string }> {
  const patch: Record<string, unknown> = {};

  if (input.name != null) {
    if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > 100) {
      throw new Error("name must be 1–100 characters");
    }

    patch.name = input.name.trim();
  }

  if (input.status != null) {
    if (input.status !== "ENABLED" && input.status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');
    patch.status = input.status;
  }

  const defaultBid = asUpdateMoney(input.defaultBidAmount, input.currency, "defaultBidAmount");
  if (defaultBid) patch.defaultBidAmount = defaultBid;

  const cpaGoal = asUpdateMoney(input.cpaGoal, input.currency, "cpaGoal");
  if (cpaGoal) patch.cpaGoal = cpaGoal;

  if (Object.keys(patch).length === 0) throw new Error("Nothing to update: pass at least one field");

  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.put<any>(`${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}`, patch, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "ad group update");
  const updated = res.data?.data;
  if (updated?.id == null) throw new Error("Apple Search Ads ad group update returned no ad group");

  return { id: String(updated.id), name: String(updated.name ?? ""), status: String(updated.status ?? "") };
}

export async function deleteAppleAdsAdGroup(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
): Promise<{ id: string; deleted: boolean }> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.delete<any>(`${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}`, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "ad group deletion");

  return { id: String(res.data?.data?.id ?? adGroupId), deleted: true };
}

export async function updateAppleAdsKeywords(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  currency: string | undefined,
  updates: UpdateAppleAdsKeywordInput[],
): Promise<
  {
    id: string;
    text: string;
    bidAmount: number | null;
    status: string | null;
    previousBidAmount: number | null;
    previousStatus: string | null;
  }[]
> {
  if (updates.length === 0) return [];
  if (updates.length > 500) throw new Error("At most 500 keywords can be updated at once");
  for (const u of updates) {
    if (u.bidAmount == null && u.status == null) throw new Error(`Keyword ${u.keywordId}: pass bidAmount and/or status`);

    if (u.bidAmount != null && (typeof u.bidAmount !== "number" || !Number.isFinite(u.bidAmount) || u.bidAmount <= 0)) {
      throw new Error(`Keyword ${u.keywordId}: bidAmount must be a number greater than 0`);
    }

    if (u.status != null && u.status !== "ACTIVE" && u.status !== "PAUSED") {
      throw new Error(`Keyword ${u.keywordId}: status must be "ACTIVE" or "PAUSED"`);
    }
  }

  if (updates.some((u) => u.bidAmount != null)) {
    const code = currency?.toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code)) throw new Error("currency (e.g. USD, EUR) is required when setting bids");
  }

  const existing = await listAppleAdsKeywords(creds, campaignId, adGroupId);
  const byId = new Map(existing.map((k) => [k.id, k]));
  const payload = updates.map((u) => {
    const known = byId.get(String(u.keywordId));
    if (!known) throw new Error(`Keyword ${u.keywordId} not found in ad group ${adGroupId}`);

    return {
      id: Number(u.keywordId),
      adGroupId: Number(adGroupId),
      text: known.text,
      matchType: known.matchType,
      ...(u.bidAmount != null ? { bidAmount: money(u.bidAmount, currency!.toUpperCase()) } : {}),
      ...(u.status != null ? { status: u.status } : {}),
    };
  });

  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.put<any>(
    `${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
    payload,
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "keyword update");

  return updates.map((u) => {
    const known = byId.get(String(u.keywordId))!;

    return {
      id: String(u.keywordId),
      text: known.text,
      bidAmount: u.bidAmount ?? null,
      status: u.status ?? null,
      previousBidAmount: known.bidAmount,
      previousStatus: known.status,
    };
  });
}

export async function deleteAppleAdsKeywordsBulk(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  ids: (string | number)[],
): Promise<number> {
  const numericIds = [...new Set(ids.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0))];
  if (numericIds.length === 0) return 0;
  if (numericIds.length > 500) throw new Error("At most 500 keywords can be deleted at once");
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/delete/bulk`,
    numericIds,
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "keyword deletion");

  return numericIds.length;
}

function negativeKeywordsBase(campaignId: string, adGroupId?: string | null): string {
  return adGroupId
    ? `${API_BASE}/campaigns/${campaignId}/adgroups/${adGroupId}/negativekeywords`
    : `${API_BASE}/campaigns/${campaignId}/negativekeywords`;
}

export async function listAppleAdsNegativeKeywords(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId?: string | null,
): Promise<AppleAdsNegativeKeyword[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.get<any>(negativeKeywordsBase(campaignId, adGroupId), {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "negative keyword listing");
  const rows = res.data?.data ?? [];

  return (Array.isArray(rows) ? rows : [])
    .filter((k: any) => k?.id != null && !k?.deleted)
    .map((k: any) => ({
      id: String(k.id),
      text: String(k.text ?? ""),
      matchType: String(k.matchType ?? ""),
      status: k.status != null ? String(k.status) : null,
    }));
}

export async function createAppleAdsNegativeKeywordsBulk(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  keywords: CreateAppleAdsNegativeKeywordInput[],
): Promise<AppleAdsNegativeKeyword[]> {
  if (keywords.length === 0) return [];
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${negativeKeywordsBase(campaignId, adGroupId)}/bulk`,
    keywords.map((k) => ({ text: k.text, matchType: k.matchType })),
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "negative keyword creation");
  const created = res.data?.data;
  if (!Array.isArray(created)) return [];

  return created
    .filter((k: any) => k?.id != null)
    .map((k: any) => ({
      id: String(k.id),
      text: String(k.text ?? ""),
      matchType: String(k.matchType ?? ""),
      status: k.status != null ? String(k.status) : null,
    }));
}

export async function deleteAppleAdsNegativeKeywordsBulk(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  ids: (string | number)[],
): Promise<number> {
  const numericIds = [...new Set(ids.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0))];
  if (numericIds.length === 0) return 0;
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(`${negativeKeywordsBase(campaignId, adGroupId)}/delete/bulk`, numericIds, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "negative keyword deletion");

  return numericIds.length;
}

export async function createAppleAdsCampaignFull(
  creds: AppleAdsCredentials,
  input: CreateAppleAdsCampaignInput,
): Promise<CreatedAppleAdsCampaign> {
  const createdAdGroups: CreatedAppleAdsCampaign["adGroups"] = [];
  const pricingModel = input.pricingModel ?? "CPC";
  const startTime = input.startTime ? toAppleAdsDateTime(input.startTime) : undefined;

  try {
    const campaign = await createAppleAdsCampaign(creds, input);
    for (const adGroup of input.adGroups) {
      const created = await createAppleAdsAdGroup(creds, campaign.id, input.currency, pricingModel, startTime, adGroup);
      const keywordCount = await createAppleAdsKeywordsBulk(
        creds,
        campaign.id,
        created.id,
        input.currency,
        adGroup.keywords ?? [],
      );

      const negatives = await createAppleAdsNegativeKeywordsBulk(
        creds,
        campaign.id,
        created.id,
        adGroup.negativeKeywords ?? [],
      );

      createdAdGroups.push({ ...created, keywordCount, negativeKeywordCount: negatives.length });
    }

    const campaignNegatives = await createAppleAdsNegativeKeywordsBulk(
      creds,
      campaign.id,
      null,
      input.negativeKeywords ?? [],
    );

    return { ...campaign, negativeKeywordCount: campaignNegatives.length, adGroups: createdAdGroups };
  } catch (err: any) {
    (err as any).partialResult = { adGroups: createdAdGroups };
    throw err;
  }
}
