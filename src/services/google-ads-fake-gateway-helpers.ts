import { enums } from "google-ads-api";
import type { GoogleAdsMutationOperation } from "./google-ads-types";
import type { FakeCampaign } from "./google-ads-fake-store";

const E: any = enums;

function perDay(total: number, days: number): string {
  return String(Math.round(total / days));
}

function resourceId(resourceName: string): string {
  return String(resourceName).split("/").pop() ?? "";
}

function tempKey(resourceName: string): string {
  return String(resourceName).split("/").pop() ?? "";
}

function enumName(map: Record<string, unknown>, value: unknown): string {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const name = map[String(Number(value))];
    if (typeof name === "string") return name;
  }

  return String(value ?? "");
}

const campaignStatusName = (v: unknown) => enumName(E.CampaignStatus as Record<string, unknown>, v);

const biddingStrategyName = (r: any): string => {
  if (r.target_roas != null) return "TARGET_ROAS";
  if (r.target_cpa != null) return "TARGET_CPA";
  if (r.maximize_conversions != null) return "MAXIMIZE_CONVERSIONS";
  if (r.target_spend != null || r.maximize_clicks != null) return "MAXIMIZE_CLICKS";

  return "MANUAL_CPC";
};

const hasBiddingResource = (r: any): boolean =>
  r.manual_cpc != null ||
  r.target_spend != null ||
  r.maximize_clicks != null ||
  r.maximize_conversions != null ||
  r.target_cpa != null ||
  r.target_roas != null;

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;

  const n = Number(v);

  return Number.isFinite(n) ? n : null;
};

const biddingNumbersOf = (
  r: any,
): Pick<FakeCampaign, "biddingCeilingMicros" | "biddingTargetCpaMicros" | "biddingTargetRoas"> => ({
  biddingCeilingMicros:
    numOrNull(r.target_spend?.cpc_bid_ceiling_micros) ??
    numOrNull(r.maximize_clicks?.cpc_bid_ceiling_micros) ??
    numOrNull(r.maximize_conversions?.cpc_bid_ceiling_micros) ??
    numOrNull(r.target_cpa?.cpc_bid_ceiling_micros) ??
    numOrNull(r.target_roas?.cpc_bid_ceiling_micros),
  biddingTargetCpaMicros:
    numOrNull(r.maximize_conversions?.target_cpa_micros) ?? numOrNull(r.target_cpa?.target_cpa_micros),
  biddingTargetRoas: numOrNull(r.target_roas?.target_roas),
});

const adGroupStatusName = (v: unknown) => enumName(E.AdGroupStatus as Record<string, unknown>, v);
const criterionStatusName = (v: unknown) => enumName(E.AdGroupCriterionStatus as Record<string, unknown>, v);
const matchTypeName = (v: unknown) => enumName(E.KeywordMatchType as Record<string, unknown>, v);

function opBudgetAmount(operations: GoogleAdsMutationOperation[], budgetName: string): number | null {
  const key = tempKey(String(budgetName ?? ""));
  const op = operations.find(
    (o) =>
      o.entity === "campaign_budget" &&
      o.operation === "create" &&
      typeof o.resource === "object" &&
      tempKey(String(o.resource.resource_name)) === key,
  );

  const res = op?.resource;

  return typeof res === "object" && res?.amount_micros != null ? Number(res.amount_micros) : null;
}

function eachDayGaql(from: string, to: string): string[] {
  const days: string[] = [];
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(4, 6)) - 1, Number(to.slice(6, 8)));
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));

  return days;
}

function dayCountGaql(from: string, to: string): number {
  return Math.max(1, eachDayGaql(from, to).length);
}

const GEO_IDS: Record<string, number> = { US: 2840, CA: 2124, GB: 2826, AU: 2036, DE: 2276, AT: 2040, FR: 2250 };

function geoIdForCountry(code: string): number {
  return GEO_IDS[code] ?? 9999;
}

export {
  perDay,
  resourceId,
  tempKey,
  campaignStatusName,
  biddingStrategyName,
  hasBiddingResource,
  biddingNumbersOf,
  adGroupStatusName,
  criterionStatusName,
  matchTypeName,
  opBudgetAmount,
  eachDayGaql,
  dayCountGaql,
  geoIdForCountry,
};
