import { prisma } from "../config";
import { appleAdsCampaignAttribution } from "./revenuecat-attribution";
import { buildTrialPriceMap, findCohortStart, isTrialConverted, trialPotentialFor } from "./trial-pricing";
import type { AppleAdsCountryStats, AppleAdsReportRange } from "./apple-ads";

export interface AppleAdsRevenueApp {
  bundleId: string;
  displayName: string | null;
  name: string;
}

export interface AppleAdsRevenueTransaction {
  id: string;
  date: string;
  cohortDate: string | null;
  app: string;
  product: string;
  eventType: string;
  isTrial: boolean;
  isConvertedTrial: boolean;
  country: string | null;
  proceedsUsd: number;
  potentialProceedsUsd: number;
}

export interface AppleAdsCountryRevenue {
  trials: number;
  proceedsUsd: number;
}

export interface AppleAdsRevenueBucket {
  proceedsUsd: number;
  transactions: AppleAdsRevenueTransaction[];
  byCountry: Record<string, AppleAdsCountryRevenue>;
}

/** Country stats enriched with attributed trials and payments, for the
 * country breakdown endpoints (Apple metrics + RevenueCat revenue merged). */
export interface AppleAdsCountryStatsWithRevenue extends AppleAdsCountryStats {
  trials: number;
  proceedsUsd: number;
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code === "" ? null : code;
}

/** Merge Apple country stats with attributed revenue buckets. Union of
 * countries: revenue-only countries (e.g. renewals without spend in range)
 * appear with zeroed Apple metrics; unattributed-country revenue lands on
 * an "unknown" row so no money silently disappears. */
export function mergeCountryRevenue(
  apple: AppleAdsCountryStats[],
  revenueByCountry: Record<string, AppleAdsCountryRevenue> | undefined,
): AppleAdsCountryStatsWithRevenue[] {
  const byCode = new Map<string, AppleAdsCountryStatsWithRevenue>();
  for (const row of apple) {
    const revenue = revenueByCountry?.[row.countryOrRegion] ?? { trials: 0, proceedsUsd: 0 };
    byCode.set(row.countryOrRegion, { ...row, trials: revenue.trials, proceedsUsd: revenue.proceedsUsd });
  }
  for (const [code, revenue] of Object.entries(revenueByCountry ?? {})) {
    if (byCode.has(code)) continue;
    if (revenue.trials === 0 && revenue.proceedsUsd === 0) continue;
    byCode.set(code, {
      countryOrRegion: code,
      spend: 0,
      impressions: 0,
      taps: 0,
      installs: 0,
      ttr: null,
      avgCpt: null,
      avgCpa: null,
      conversionRate: null,
      trials: revenue.trials,
      proceedsUsd: revenue.proceedsUsd,
    });
  }
  return [...byCode.values()].sort((a, b) => b.spend - a.spend);
}

export type AppleAdsCampaignRevenueMap = Record<
  string,
  AppleAdsRevenueBucket & { byKeyword: Record<string, AppleAdsRevenueBucket> }
>;

/** RevenueCat transactions attributed to Apple Search Ads campaigns via the
 * customer's Apple attribution. Shared by the HTTP API and the MCP tools. */
export async function getAppleAdsCampaignRevenue(
  accessibleApps: AppleAdsRevenueApp[],
  orgId: string,
  range: AppleAdsReportRange,
): Promise<{ byCampaign: AppleAdsCampaignRevenueMap }> {
  const bundleIds = accessibleApps.map((app) => app.bundleId);
  if (bundleIds.length === 0) {
    return { byCampaign: {} };
  }

  // Evaluation window follows the selected range; pricing and cohort
  // lookbacks stay fixed since they need history beyond the window.
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
      select: { bundleId: true, customerId: true, appleAttribution: true, attributes: true, country: true },
    }),
    prisma.revenueCatTransaction.findMany({
      where: { bundleId: { in: bundleIds }, occurredAt: { gte: start, lt: until }, environment: "production" },
      select: { rcId: true, bundleId: true, customerId: true, productId: true, eventType: true, periodType: true, isTrialConversion: true, occurredAt: true, proceedsUsd: true, country: true },
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
  const countryByCustomer = new Map(customers.map((customer) => [
    `${customer.bundleId}\0${customer.customerId}`,
    normalizeCountry(customer.country),
  ]));

  function addCountry(bucket: AppleAdsRevenueBucket, country: string | null, isTrial: boolean, proceedsUsd: number) {
    const code = country ?? "unknown";
    const entry = bucket.byCountry[code] ??= { trials: 0, proceedsUsd: 0 };
    if (isTrial) entry.trials += 1;
    entry.proceedsUsd += proceedsUsd;
  }
  const appNameByBundle = new Map(accessibleApps.map((app) => [app.bundleId, app.displayName || app.name]));
  const byCampaign: AppleAdsCampaignRevenueMap = {};

  for (const transaction of transactions) {
    const customerKey = `${transaction.bundleId}\0${transaction.customerId}`;
    const attribution = attributionByCustomer.get(customerKey);
    if (!attribution || (attribution.orgId && attribution.orgId !== orgId)) continue;

    const isTrial = transaction.periodType === "TRIAL" && transaction.eventType === "INITIAL_PURCHASE";
    const cohortEvent = { bundleId: transaction.bundleId, customerId: transaction.customerId, productId: transaction.productId, occurredAt: transaction.occurredAt };
    const convertedTrial = isTrial && isTrialConverted(trialConversions, cohortEvent);
    const cohortStart = transaction.isTrialConversion ? findCohortStart(trialStarts, cohortEvent) : null;
    const country = normalizeCountry(transaction.country) ?? countryByCustomer.get(customerKey) ?? null;
    const entry: AppleAdsRevenueTransaction = {
      id: transaction.rcId,
      date: transaction.occurredAt.toISOString(),
      cohortDate: cohortStart ? cohortStart.toISOString() : null,
      app: appNameByBundle.get(transaction.bundleId) ?? transaction.bundleId,
      product: transaction.productId,
      eventType: transaction.eventType,
      isTrial,
      isConvertedTrial: convertedTrial,
      country,
      proceedsUsd: transaction.proceedsUsd,
      potentialProceedsUsd: convertedTrial ? 0 : trialPotentialFor(trialPrices, transaction.bundleId, transaction.productId, isTrial),
    };

    const campaign = byCampaign[attribution.campaignId] ??= { proceedsUsd: 0, transactions: [], byKeyword: {}, byCountry: {} };
    campaign.proceedsUsd += transaction.proceedsUsd;
    campaign.transactions.push(entry);
    addCountry(campaign, country, isTrial, transaction.proceedsUsd);

    // Not every click carries a keyword (e.g. Search Match, or non-keyword
    // placements) — those still count toward the campaign total above, but
    // can't be attributed to one specific keyword below.
    if (attribution.keywordId) {
      const keyword = campaign.byKeyword[attribution.keywordId] ??= { proceedsUsd: 0, transactions: [], byCountry: {} };
      keyword.proceedsUsd += transaction.proceedsUsd;
      keyword.transactions.push(entry);
      addCountry(keyword, country, isTrial, transaction.proceedsUsd);
    }
  }

  return { byCampaign };
}
