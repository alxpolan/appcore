import axios from "./utils/http";
import { API_BASE, authedHeaders, fetchAppleAdsAccessToken } from "./apple-ads-auth";
import {
  mergeReportRows,
  resolveAppleAdsRange,
  rowsFromReport,
  splitReportSpan,
  statsFromTotal,
  totalsFromRow,
} from "./apple-ads-reports";
import type {
  AppleAdsCountryStats,
  AppleAdsCredentials,
  AppleAdsDeviceStats,
  AppleAdsReportRange,
} from "./apple-ads-types";

export function countryStatsFromRows(rows: any[]): AppleAdsCountryStats[] {
  return rows
    .map((row) => {
      const meta = row.metadata ?? {};

      return {
        countryOrRegion: String(meta.countryOrRegion ?? ""),
        ...statsFromTotal(totalsFromRow(row)),
      };
    })
    .filter((r) => r.countryOrRegion !== "")
    .sort((a, b) => b.spend - a.spend);
}

export function deviceStatsFromRows(rows: any[]): AppleAdsDeviceStats[] {
  return rows
    .map((row) => {
      const meta = row.metadata ?? {};

      return {
        deviceClass: String(meta.deviceClass ?? ""),
        ...statsFromTotal(totalsFromRow(row)),
      };
    })
    .filter((r) => r.deviceClass !== "")
    .sort((a, b) => b.spend - a.spend);
}

export async function getAppleAdsCampaignCountryBreakdown(
  creds: AppleAdsCredentials,
  campaignId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsCountryStats[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);

  const fetchChunk = async (startTime: string, endTime: string): Promise<any[]> => {
    const reportRes = await axios.post<any>(
      `${API_BASE}/reports/campaigns`,
      {
        startTime,
        endTime,
        selector: {
          orderBy: [{ field: "campaignId", sortOrder: "ASCENDING" }],
          conditions: [{ field: "campaignId", operator: "EQUALS", values: [campaignId] }],
          pagination: { offset: 0, limit: 1000 },
        },
        groupBy: ["countryOrRegion"],
        timeZone: "UTC",
        returnRecordsWithNoMetrics: true,
        returnRowTotals: true,
        returnGrandTotals: false,
      },
      { headers },
    );

    return rowsFromReport(reportRes.data);
  };

  const chunks = await Promise.all(splitReportSpan(range).map((chunk) => fetchChunk(chunk.startDate, chunk.endDate)));
  const rows = mergeReportRows(chunks.flat(), (row) =>
    row.metadata?.countryOrRegion != null ? String(row.metadata.countryOrRegion) : undefined,
  );

  return countryStatsFromRows(rows);
}

async function fetchKeywordGroupedRows(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
  range: AppleAdsReportRange,
  dimension: "countryOrRegion" | "deviceClass",
): Promise<any[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);

  const fetchChunk = async (startTime: string, endTime: string): Promise<any[]> => {
    const reportRes = await axios.post<any>(
      `${API_BASE}/reports/campaigns/${campaignId}/adgroups/${adGroupId}/keywords`,
      {
        startTime,
        endTime,
        selector: {
          orderBy: [{ field: "keywordId", sortOrder: "ASCENDING" }],
          conditions: [{ field: "keywordId", operator: "EQUALS", values: [keywordId] }],
          pagination: { offset: 0, limit: 1000 },
        },
        groupBy: [dimension],
        timeZone: "UTC",
        returnRecordsWithNoMetrics: true,
        returnRowTotals: true,
        returnGrandTotals: false,
      },
      { headers },
    );

    return rowsFromReport(reportRes.data);
  };

  const chunks = await Promise.all(splitReportSpan(range).map((chunk) => fetchChunk(chunk.startDate, chunk.endDate)));
  const rows = mergeReportRows(chunks.flat(), (row) =>
    row.metadata?.[dimension] != null ? String(row.metadata[dimension]) : undefined,
  );

  return rows;
}

export async function getAppleAdsKeywordCountryBreakdown(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsCountryStats[]> {
  const rows = await fetchKeywordGroupedRows(creds, campaignId, adGroupId, keywordId, range, "countryOrRegion");

  return countryStatsFromRows(rows);
}

export async function getAppleAdsKeywordDeviceBreakdown(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsDeviceStats[]> {
  const rows = await fetchKeywordGroupedRows(creds, campaignId, adGroupId, keywordId, range, "deviceClass");

  return deviceStatsFromRows(rows);
}
