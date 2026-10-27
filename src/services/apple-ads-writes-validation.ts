import { fail, asNonEmptyString, asPositiveNumber } from "./utils/ads-validation";
import type {
  CreateAppleAdsCampaignInput,
  CreateAppleAdsNegativeKeywordInput,
} from "./apple-ads-types";

const SUPPLY_SOURCES = [
  "APPSTORE_SEARCH_RESULTS",
  "APPSTORE_SEARCH_TAB",
  "APPSTORE_TODAY_TAB",
  "APPSTORE_PRODUCT_PAGE",
] as const;

function asOptionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value == null || value === "") return undefined;

  return asPositiveNumber(value, field);
}

function asNegativeKeywordList(value: unknown, field: string): CreateAppleAdsNegativeKeywordInput[] {
  const raw = value ?? [];
  if (!Array.isArray(raw)) fail(`${field} must be an array`);
  if (raw.length > 500) fail(`${field} may contain at most 500 negative keywords`);

  return raw.map((k: any, j: number) => {
    const kLabel = `${field}[${j}]`;
    if (!k || typeof k !== "object") fail(`${kLabel} must be an object`);
    if (k.matchType !== "EXACT" && k.matchType !== "BROAD") fail(`${kLabel}.matchType must be "EXACT" or "BROAD"`);

    return { text: asNonEmptyString(k.text, `${kLabel}.text`, 100), matchType: k.matchType };
  });
}

export function validateCreateCampaignInput(body: any): CreateAppleAdsCampaignInput {
  if (!body || typeof body !== "object") fail("Request body is required");
  const name = asNonEmptyString(body.name, "name", 100);

  const adamIdRaw = typeof body.adamId === "string" ? Number(body.adamId.trim()) : body.adamId;
  if (!Number.isInteger(adamIdRaw) || adamIdRaw <= 0) fail("adamId must be a positive integer (the App Store app ID)");

  const countriesRaw: unknown[] = Array.isArray(body.countriesOrRegions)
    ? body.countriesOrRegions
    : typeof body.countriesOrRegions === "string"
      ? body.countriesOrRegions.split(",")
      : [];

  const countriesOrRegions = [
    ...new Set(
      countriesRaw
        .map((c) =>
          String(c ?? "")
            .trim()
            .toUpperCase(),
        )
        .filter((c) => c.length > 0),
    ),
  ];

  if (countriesOrRegions.length === 0) fail("At least one country is required (e.g. US, DE)");
  for (const c of countriesOrRegions) {
    if (!/^[A-Z]{2}$/.test(c)) fail(`Invalid country code "${c}" — use two-letter codes like US, DE`);
  }

  const dailyBudgetAmount = asPositiveNumber(body.dailyBudgetAmount, "dailyBudgetAmount");
  const budgetAmount = asOptionalPositiveNumber(body.budgetAmount, "budgetAmount");

  const currency = asNonEmptyString(body.currency ?? "USD", "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail("currency must be a three-letter code like USD or EUR");

  const supplyRaw: unknown[] = Array.isArray(body.supplySources) ? body.supplySources : [];
  const supplySources = supplyRaw.map((s) => String(s));
  if (supplySources.length === 0) fail("At least one placement (supply source) is required");
  for (const s of supplySources) {
    if (!(SUPPLY_SOURCES as readonly string[]).includes(s)) fail(`Unknown placement "${s}"`);
  }

  const status = body.status ?? "PAUSED";
  if (status !== "ENABLED" && status !== "PAUSED") fail('status must be "ENABLED" or "PAUSED"');

  let startTime: string | undefined;

  if (body.startTime != null && body.startTime !== "") {
    if (typeof body.startTime !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.startTime)) {
      fail("startTime must be a date like 2026-02-01");
    }

    startTime = body.startTime;
  }

  const pricingModel = body.pricingModel ?? "CPC";
  if (pricingModel !== "CPC" && pricingModel !== "CPM") fail('pricingModel must be "CPC" or "CPM"');

  if (!Array.isArray(body.adGroups) || body.adGroups.length === 0) fail("At least one ad group is required");
  if (body.adGroups.length > 20) fail("At most 20 ad groups can be created at once");
  const adGroups: CreateAppleAdsCampaignInput["adGroups"] = body.adGroups.map((g: any, i: number) => {
    const label = `adGroups[${i}]`;
    if (!g || typeof g !== "object") fail(`${label} must be an object`);
    const keywordsRaw = g.keywords ?? [];
    if (!Array.isArray(keywordsRaw)) fail(`${label}.keywords must be an array`);
    if (keywordsRaw.length > 500) fail(`${label} may contain at most 500 keywords`);
    const gStatus = g.status ?? "ENABLED";
    if (gStatus !== "ENABLED" && gStatus !== "PAUSED") fail(`${label}.status must be "ENABLED" or "PAUSED"`);
    const cpaGoal = asOptionalPositiveNumber(g.cpaGoal, `${label}.cpaGoal`);

    return {
      name: asNonEmptyString(g.name, `${label}.name`, 100),
      defaultBidAmount: asPositiveNumber(g.defaultBidAmount, `${label}.defaultBidAmount`),
      ...(cpaGoal != null ? { cpaGoal } : {}),
      status: gStatus,
      keywords: keywordsRaw.map((k: any, j: number) => {
        const kLabel = `${label}.keywords[${j}]`;
        if (!k || typeof k !== "object") fail(`${kLabel} must be an object`);
        if (k.matchType !== "EXACT" && k.matchType !== "BROAD") fail(`${kLabel}.matchType must be "EXACT" or "BROAD"`);
        const bidAmount = asOptionalPositiveNumber(k.bidAmount, `${kLabel}.bidAmount`);

        return {
          text: asNonEmptyString(k.text, `${kLabel}.text`, 100),
          matchType: k.matchType,
          ...(bidAmount != null ? { bidAmount } : {}),
        };
      }),
      negativeKeywords: asNegativeKeywordList(g.negativeKeywords, `${label}.negativeKeywords`),
    };
  });

  return {
    name,
    adamId: adamIdRaw,
    countriesOrRegions,
    dailyBudgetAmount,
    ...(budgetAmount != null ? { budgetAmount } : {}),
    currency,
    supplySources,
    status,
    ...(startTime ? { startTime } : {}),
    pricingModel,
    adGroups,
    negativeKeywords: asNegativeKeywordList(body.negativeKeywords, "negativeKeywords"),
  };
}
