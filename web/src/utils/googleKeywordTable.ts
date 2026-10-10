import type { GoogleAdsKeyword } from "../types";

export type GoogleKeywordSortCol =
  | "keyword"
  | "matchType"
  | "bid"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "conversions"
  | "avgCpc"
  | "costPerConversion"
  | "convRate";

export type GoogleSortDir = "asc" | "desc";

export interface GoogleKeywordFilters {
  text: string;
  matchType: string;
  bid: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  conversions: string;
  avgCpc: string;
  costPerConversion: string;
  convRate: string;
}

export const EMPTY_GOOGLE_KEYWORD_FILTERS: GoogleKeywordFilters = {
  text: "",
  matchType: "",
  bid: "",
  spend: "",
  impressions: "",
  clicks: "",
  ctr: "",
  conversions: "",
  avgCpc: "",
  costPerConversion: "",
  convRate: "",
};

export function isGoogleFilterActive(filters: GoogleKeywordFilters): boolean {
  return Object.values(filters).some((value) => value !== "");
}

export function googleKeywordSortValue(
  keyword: GoogleAdsKeyword,
  col: GoogleKeywordSortCol,
): string | number | null {
  switch (col) {
    case "keyword":
      return keyword.text;
    case "matchType":
      return keyword.matchType;
    case "bid":
      return keyword.cpcBid;
    case "spend":
      return keyword.spend;
    case "impressions":
      return keyword.impressions;
    case "clicks":
      return keyword.clicks;
    case "ctr":
      return keyword.ctr;
    case "conversions":
      return keyword.conversions;
    case "avgCpc":
      return keyword.avgCpc;
    case "costPerConversion":
      return keyword.costPerConversion;
    case "convRate":
      return keyword.conversionRate;
  }
}

export function compareGoogleKeywords(
  a: GoogleAdsKeyword,
  b: GoogleAdsKeyword,
  col: GoogleKeywordSortCol,
  dir: GoogleSortDir,
): number {
  const av = googleKeywordSortValue(a, col);
  const bv = googleKeywordSortValue(b, col);
  // Missing values always sink, in both directions.
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") {
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  }
  return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
}

export function sortGoogleKeywordRows(
  rows: GoogleAdsKeyword[],
  col: GoogleKeywordSortCol,
  dir: GoogleSortDir,
): GoogleAdsKeyword[] {
  return [...rows].sort((a, b) => compareGoogleKeywords(a, b, col, dir));
}

function parseMin(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Every numeric filter is a minimum; ratios (CTR, conv. rate) are entered as percent, like displayed. */
function meetsMin(value: number | null, raw: string, isPercent = false): boolean {
  const min = parseMin(raw);
  if (min == null) return true;
  if (value == null) return false;
  return (isPercent ? value * 100 : value) >= min;
}

export function matchGoogleKeywordRow(keyword: GoogleAdsKeyword, filters: GoogleKeywordFilters): boolean {
  if (filters.text !== "" && !keyword.text.toLowerCase().includes(filters.text.toLowerCase())) return false;
  if (filters.matchType !== "" && keyword.matchType !== filters.matchType) return false;
  if (!meetsMin(keyword.cpcBid, filters.bid)) return false;
  if (!meetsMin(keyword.spend, filters.spend)) return false;
  if (!meetsMin(keyword.impressions, filters.impressions)) return false;
  if (!meetsMin(keyword.clicks, filters.clicks)) return false;
  if (!meetsMin(keyword.ctr, filters.ctr, true)) return false;
  if (!meetsMin(keyword.conversions, filters.conversions)) return false;
  if (!meetsMin(keyword.avgCpc, filters.avgCpc)) return false;
  if (!meetsMin(keyword.costPerConversion, filters.costPerConversion)) return false;
  if (!meetsMin(keyword.conversionRate, filters.convRate, true)) return false;
  return true;
}

export function filterGoogleKeywordRows(rows: GoogleAdsKeyword[], filters: GoogleKeywordFilters): GoogleAdsKeyword[] {
  if (!isGoogleFilterActive(filters)) return rows;
  return rows.filter((keyword) => matchGoogleKeywordRow(keyword, filters));
}
