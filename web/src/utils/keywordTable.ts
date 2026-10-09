import type { AppleAdsKeyword, AppleAdsRevenueBucket } from "../types";

export type KeywordSortCol =
  | "keyword"
  | "matchType"
  | "status"
  | "bid"
  | "spend"
  | "impressions"
  | "taps"
  | "ttr"
  | "installs"
  | "avgCpt"
  | "avgCpa"
  | "convRate"
  | "rcTxns"
  | "rcProceeds";

export type SortDir = "asc" | "desc";

export type RevenueByKeyword = Record<string, AppleAdsRevenueBucket>;

export interface KeywordFilters {
  text: string;
  matchType: string;
  status: string;
  bid: string;
  spend: string;
  impressions: string;
  taps: string;
  ttr: string;
  installs: string;
  avgCpt: string;
  avgCpa: string;
  convRate: string;
  rcTxns: string;
  rcProceeds: string;
}

export const EMPTY_KEYWORD_FILTERS: KeywordFilters = {
  text: "",
  matchType: "",
  status: "",
  bid: "",
  spend: "",
  impressions: "",
  taps: "",
  ttr: "",
  installs: "",
  avgCpt: "",
  avgCpa: "",
  convRate: "",
  rcTxns: "",
  rcProceeds: "",
};

export function isFilterActive(filters: KeywordFilters): boolean {
  return Object.values(filters).some((value) => value !== "");
}

export function keywordSortValue(
  keyword: AppleAdsKeyword,
  col: KeywordSortCol,
  revenue?: RevenueByKeyword,
): string | number | null {
  switch (col) {
    case "keyword":
      return keyword.text;
    case "matchType":
      return keyword.matchType;
    case "status":
      return keyword.status;
    case "bid":
      return keyword.bidAmount;
    case "spend":
      return keyword.spend;
    case "impressions":
      return keyword.impressions;
    case "taps":
      return keyword.taps;
    case "ttr":
      return keyword.ttr;
    case "installs":
      return keyword.installs;
    case "avgCpt":
      return keyword.avgCpt;
    case "avgCpa":
      return keyword.avgCpa;
    case "convRate":
      return keyword.conversionRate;
    case "rcTxns":
      return revenue?.[keyword.id]?.transactions.length ?? 0;
    case "rcProceeds":
      return revenue?.[keyword.id]?.proceedsUsd ?? 0;
  }
}

export function compareKeywords(
  a: AppleAdsKeyword,
  b: AppleAdsKeyword,
  col: KeywordSortCol,
  dir: SortDir,
  revenue?: RevenueByKeyword,
): number {
  const av = keywordSortValue(a, col, revenue);
  const bv = keywordSortValue(b, col, revenue);
  // Missing values always sink, in both directions.
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") {
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  }
  return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
}

export function sortKeywordRows(
  rows: AppleAdsKeyword[],
  col: KeywordSortCol,
  dir: SortDir,
  revenue?: RevenueByKeyword,
): AppleAdsKeyword[] {
  return [...rows].sort((a, b) => compareKeywords(a, b, col, dir, revenue));
}

function parseMin(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Every numeric filter is a minimum; ratios (TTR, conv. rate) are entered as percent, like displayed. */
function meetsMin(value: number | null, raw: string, isPercent = false): boolean {
  const min = parseMin(raw);
  if (min == null) return true;
  if (value == null) return false;
  return (isPercent ? value * 100 : value) >= min;
}

export function matchKeywordRow(
  keyword: AppleAdsKeyword,
  filters: KeywordFilters,
  revenue?: RevenueByKeyword,
): boolean {
  if (filters.text !== "" && !keyword.text.toLowerCase().includes(filters.text.toLowerCase())) return false;
  if (filters.matchType !== "" && keyword.matchType !== filters.matchType) return false;
  if (filters.status !== "" && keyword.status !== filters.status) return false;
  if (!meetsMin(keyword.bidAmount, filters.bid)) return false;
  if (!meetsMin(keyword.spend, filters.spend)) return false;
  if (!meetsMin(keyword.impressions, filters.impressions)) return false;
  if (!meetsMin(keyword.taps, filters.taps)) return false;
  if (!meetsMin(keyword.ttr, filters.ttr, true)) return false;
  if (!meetsMin(keyword.installs, filters.installs)) return false;
  if (!meetsMin(keyword.avgCpt, filters.avgCpt)) return false;
  if (!meetsMin(keyword.avgCpa, filters.avgCpa)) return false;
  if (!meetsMin(keyword.conversionRate, filters.convRate, true)) return false;
  const bucket = revenue?.[keyword.id];
  if (!meetsMin(bucket ? bucket.transactions.length : 0, filters.rcTxns)) return false;
  if (!meetsMin(bucket ? bucket.proceedsUsd : 0, filters.rcProceeds)) return false;
  return true;
}

export function filterKeywordRows(
  rows: AppleAdsKeyword[],
  filters: KeywordFilters,
  revenue?: RevenueByKeyword,
): AppleAdsKeyword[] {
  if (!isFilterActive(filters)) return rows;
  return rows.filter((keyword) => matchKeywordRow(keyword, filters, revenue));
}
