import axios from "./utils/http";
import { aggregateDailyStats, type AppleAdsDailyStats } from "./utils/apple-ads-daily";
import { API_BASE, authedHeaders, fetchAppleAdsAccessToken, throwIfAppleError } from "./apple-ads-auth";
import type {
  AppleAdsAdGroup,
  AppleAdsAdGroupWithKeywords,
  AppleAdsCampaign,
  AppleAdsCountryStats,
  AppleAdsCredentials,
  AppleAdsKeyword,
  AppleAdsReportRange,
  AppleAdsSearchTerm,
  AppleAdsStats,
  AppleAdsStoreApp,
} from "./apple-ads-types";

const MAX_RANGE_DAYS = 730;
const MAX_CHUNK_DAYS = 90;

const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

function isDayString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  );
}

export function resolveAppleAdsRange(query: Record<string, any>): AppleAdsReportRange {
  const today = new Date();

  today.setUTCHours(0, 0, 0, 0);
  const endDefault = fmtDay(today);
  const back = (n: number) => {
    const d = new Date(today);

    d.setUTCDate(d.getUTCDate() - n);

    return fmtDay(d);
  };

  let startDate = back(29);
  let endDate = endDefault;

  if (query.period === "all") {
    startDate = back(364);
  } else if (query.period === "ytd") {
    startDate = `${today.getUTCFullYear()}-01-01`;
  } else if (query.days != null) {
    const n = parseInt(String(query.days), 10);
    if (Number.isFinite(n) && n >= 1) startDate = back(Math.min(n, MAX_RANGE_DAYS) - 1);
  }

  if (isDayString(query.startDate)) startDate = query.startDate;
  if (isDayString(query.endDate)) endDate = query.endDate;

  if (endDate > endDefault) endDate = endDefault;
  if (startDate > endDate) startDate = endDate;
  const earliest = back(MAX_RANGE_DAYS - 1);
  if (startDate < earliest) startDate = earliest;

  return { startDate, endDate };
}

export function splitReportSpan(range: AppleAdsReportRange): AppleAdsReportRange[] {
  const chunks: AppleAdsReportRange[] = [];
  const end = new Date(`${range.endDate}T00:00:00Z`);
  let cursor = new Date(`${range.startDate}T00:00:00Z`);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);

    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_CHUNK_DAYS - 1);
    chunks.push({ startDate: fmtDay(cursor), endDate: fmtDay(chunkEnd > end ? end : chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return chunks;
}

function mergeTotals(into: any, add: any): any {
  for (const [key, value] of Object.entries(add ?? {})) {
    if (typeof value === "number") into[key] = (into[key] ?? 0) + value;
    else if (key === "localSpend" && value && typeof value === "object") {
      const amount = Number((into.localSpend as any)?.amount ?? 0) + Number((value as any).amount ?? 0);

      into.localSpend = { ...(value as object), amount: String(amount) };
    } else if (into[key] == null) {
      into[key] = value;
    }
  }

  return into;
}

export function mergeReportRows(rows: any[], idOf: (row: any) => string | undefined): any[] {
  const merged = new Map<string, any>();
  for (const row of rows) {
    const id = idOf(row);
    if (id == null) continue;
    const existing = merged.get(id);

    if (!existing) {
      const copy: any = { ...row };
      if (row.total != null) copy.total = { ...row.total };
      if (Array.isArray(row.granularity)) copy.granularity = [...row.granularity];
      merged.set(id, copy);
    } else {
      if (row.total != null) existing.total = mergeTotals(existing.total ?? {}, row.total);

      if (Array.isArray(row.granularity)) {
        if (!Array.isArray(existing.granularity)) existing.granularity = [];
        existing.granularity.push(...row.granularity);
      }
    }
  }

  return [...merged.values()];
}

function statsFromTotal(total: any): AppleAdsStats {
  const spend = total.localSpend?.amount != null ? Number(total.localSpend.amount) : 0;
  const impressions = total.impressions != null ? Number(total.impressions) : 0;
  const taps = total.taps != null ? Number(total.taps) : 0;
  const installs = total.totalInstalls != null ? Number(total.totalInstalls) : 0;

  return {
    spend,
    impressions,
    taps,
    installs,
    ttr: impressions > 0 ? taps / impressions : null,
    avgCpt: taps > 0 ? spend / taps : null,
    avgCpa: installs > 0 ? spend / installs : null,
    conversionRate: taps > 0 ? installs / taps : null,
  };
}

function totalsFromRow(row: any): any {
  if (row.total) return row.total;

  if (Array.isArray(row.granularity)) {
    return row.granularity.reduce((acc: any, g: any) => {
      for (const [k, v] of Object.entries(g)) {
        if (typeof v === "number") acc[k] = (acc[k] ?? 0) + v;
        else if (k === "localSpend" && v && typeof v === "object") {
          const amt = Number((v as any).amount ?? 0);

          acc.localSpend = { amount: String((Number(acc.localSpend?.amount ?? 0) + amt).toString()) };
        }
      }

      return acc;
    }, {});
  }

  return {};
}

function rowsFromReport(data: any): any[] {
  if (data?.error) throw new Error(`Apple Search Ads reports error: ${JSON.stringify(data.error)}`);

  const envelope = data == null ? undefined : data.data;

  if (envelope == null || envelope.reportingDataResponse == null || !Array.isArray(envelope.reportingDataResponse.row)) {
    throw new Error("Apple Search Ads reports response returned no reportingDataResponse.row");
  }

  return envelope.reportingDataResponse.row;
}

export async function listAppleAdsCampaigns(
  creds: AppleAdsCredentials,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsCampaign[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-AP-Context": `orgId=${creds.orgId}`,
    "Content-Type": "application/json",
  };

  const fetchChunk = async (startTime: string, endTime: string): Promise<any[]> => {
    const reportRes = await axios.post<any>(
      `${API_BASE}/reports/campaigns`,
      {
        startTime,
        endTime,
        selector: {
          orderBy: [{ field: "campaignId", sortOrder: "ASCENDING" }],
          pagination: { offset: 0, limit: 1000 },
        },
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
    row.metadata?.campaignId != null ? String(row.metadata.campaignId) : undefined,
  );

  const orgId = creds.orgId;

  return rows
    .filter((row) => !row.metadata?.deleted)
    .map((row) => {
      const meta = row.metadata ?? {};

      return {
        id: String(meta.campaignId),
        orgId,
        name: meta.campaignName,
        status: meta.campaignStatus,
        servingStatus: meta.servingStatus,
        dailyBudget:
          meta.dailyBudget?.amount != null
            ? Number(meta.dailyBudget.amount)
            : meta.dailyBudgetAmount?.amount != null
              ? Number(meta.dailyBudgetAmount.amount)
              : null,
        totalBudget: meta.totalBudget?.amount != null ? Number(meta.totalBudget.amount) : null,
        currency: meta.dailyBudget?.currency ?? meta.dailyBudgetAmount?.currency ?? meta.totalBudget?.currency ?? null,
        countriesOrRegions: meta.countriesOrRegions ?? [],
        startTime: meta.startTime ?? null,
        endTime: meta.endTime ?? null,
        ...statsFromTotal(totalsFromRow(row)),
      };
    });
}

export async function getAppleAdsDailyStats(
  creds: AppleAdsCredentials,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
  campaignId?: string,
): Promise<AppleAdsDailyStats[]> {
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
          ...(campaignId != null
            ? { conditions: [{ field: "campaignId", operator: "EQUALS", values: [campaignId] }] }
            : {}),
          pagination: { offset: 0, limit: 1000 },
        },
        granularity: "DAILY",
        timeZone: "UTC",
        returnRecordsWithNoMetrics: true,
        returnRowTotals: false,
        returnGrandTotals: false,
      },
      { headers },
    );

    return rowsFromReport(reportRes.data);
  };

  const chunks = await Promise.all(splitReportSpan(range).map((chunk) => fetchChunk(chunk.startDate, chunk.endDate)));
  const rows = mergeReportRows(chunks.flat(), (row) =>
    row.metadata?.campaignId != null ? String(row.metadata.campaignId) : undefined,
  );

  return aggregateDailyStats(rows, campaignId);
}

function countryStatsFromRows(rows: any[]): AppleAdsCountryStats[] {
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

export async function getAppleAdsKeywordCountryBreakdown(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsCountryStats[]> {
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

export async function listAppleAdsAdGroups(
  creds: AppleAdsCredentials,
  campaignId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsAdGroup[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);

  const fetchChunk = async (startTime: string, endTime: string): Promise<any[]> => {
    const reportRes = await axios.post<any>(
      `${API_BASE}/reports/campaigns/${campaignId}/adgroups`,
      {
        startTime,
        endTime,
        selector: {
          orderBy: [{ field: "adGroupId", sortOrder: "ASCENDING" }],
          pagination: { offset: 0, limit: 1000 },
        },
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
    row.metadata?.adGroupId != null ? String(row.metadata.adGroupId) : undefined,
  );

  return rows
    .filter((row) => !row.metadata?.deleted)
    .map((row) => {
      const meta = row.metadata ?? {};
      const bid = meta.defaultCpcBid ?? meta.defaultBidAmount;

      return {
        id: String(meta.adGroupId),
        campaignId: String(meta.campaignId ?? campaignId),
        name: meta.adGroupName,
        status: meta.adGroupStatus ?? meta.status,
        servingStatus: meta.adGroupServingStatus ?? meta.servingStatus,
        defaultBidAmount: bid?.amount != null ? Number(bid.amount) : null,
        cpaGoal: meta.cpaGoal?.amount != null ? Number(meta.cpaGoal.amount) : null,
        currency: bid?.currency ?? meta.cpaGoal?.currency ?? null,
        startTime: meta.startTime ?? null,
        endTime: meta.endTime ?? null,
        ...statsFromTotal(totalsFromRow(row)),
      };
    });
}

export async function listAppleAdsKeywords(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsKeyword[]> {
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
          pagination: { offset: 0, limit: 1000 },
        },
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
    row.metadata?.keywordId != null ? String(row.metadata.keywordId) : undefined,
  );

  return rows
    .filter((row) => !row.metadata?.deleted)
    .map((row) => {
      const meta = row.metadata ?? {};

      return {
        id: String(meta.keywordId),
        adGroupId: String(meta.adGroupId ?? adGroupId),
        text: meta.keyword,
        matchType: meta.matchType,
        status: meta.keywordStatus ?? meta.status,
        bidAmount: meta.bidAmount?.amount != null ? Number(meta.bidAmount.amount) : null,
        currency: meta.bidAmount?.currency ?? null,
        ...statsFromTotal(totalsFromRow(row)),
      };
    });
}

export async function listAppleAdsSearchTerms(
  creds: AppleAdsCredentials,
  campaignId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsSearchTerm[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);

  const fetchChunk = async (startTime: string, endTime: string): Promise<any[]> => {
    const reportRes = await axios.post<any>(
      `${API_BASE}/reports/campaigns/${campaignId}/searchterms`,
      {
        startTime,
        endTime,
        selector: {
          conditions: [{ field: "impressions", operator: "GREATER_THAN", values: ["0"] }],
          orderBy: [{ field: "impressions", sortOrder: "DESCENDING" }],
          pagination: { offset: 0, limit: 1000 },
        },
        returnRowTotals: true,
        returnGrandTotals: false,
      },
      { headers },
    );

    return rowsFromReport(reportRes.data);
  };

  const chunks = await Promise.all(splitReportSpan(range).map((chunk) => fetchChunk(chunk.startDate, chunk.endDate)));
  const all = chunks.flat();
  const rows = mergeReportRows(
    all,
    (row) =>
      row?.other === false && row.metadata?.searchTermText
        ? `${row.metadata.adGroupId}::${row.metadata.keywordId}::${row.metadata.searchTermText}`
        : undefined,
  );

  const withTerms = new Set(
    rows.map((row) => `${row.metadata?.adGroupId}::${row.metadata?.keywordId}`),
  );

  const rollups = mergeReportRows(
    all,
    (row) =>
      row?.other === true && row.metadata?.keywordId != null
        ? `${row.metadata.adGroupId}::${row.metadata.keywordId}`
        : undefined,
  ).filter((row) => !withTerms.has(`${row.metadata?.adGroupId}::${row.metadata?.keywordId}`));

  const mapRow = (row: any, keywordTotal: boolean) => {
    const meta = row.metadata ?? {};

    return {
      searchTerm: String(meta.searchTermText ?? meta.keyword ?? ""),
      searchTermSource: meta.searchTermSource != null ? String(meta.searchTermSource) : null,
      adGroupId: String(meta.adGroupId ?? ""),
      adGroupName: meta.adGroupName != null ? String(meta.adGroupName) : null,
      keywordId: meta.keywordId != null ? String(meta.keywordId) : null,
      keyword: meta.keyword != null ? String(meta.keyword) : null,
      matchType: meta.matchType != null ? String(meta.matchType) : null,
      keywordTotal,
      ...statsFromTotal(totalsFromRow(row)),
    };
  };

  return [...rows.map((row) => mapRow(row, false)), ...rollups.map((row) => mapRow(row, true))].sort(
    (a, b) => b.spend - a.spend,
  );
}

export async function listAppleAdsApps(creds: AppleAdsCredentials): Promise<AppleAdsStoreApp[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.post<any>(
    `${API_BASE}/search/apps`,
    {
      selector: {
        orderBy: [{ field: "adamId", sortOrder: "ASCENDING" }],
        pagination: { offset: 0, limit: 100 },
      },
    },
    { headers: authedHeaders(accessToken, creds.orgId) },
  );

  throwIfAppleError(res.data, "app search");
  const body = res.data;

  if (body == null || !Array.isArray(body.data)) throw new Error("Apple Search Ads app search returned no app list");

  return body.data
    .filter((a: any) => a?.adamId != null)
    .map((a: any) => {
      if (a.appName == null) throw new Error("Apple Search Ads app search returned an app with no appName");

      return { adamId: String(a.adamId), name: String(a.appName) };
    });
}

export async function getAppleAdsCampaignDetail(
  creds: AppleAdsCredentials,
  campaignId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsAdGroupWithKeywords[]> {
  const adGroups = await listAppleAdsAdGroups(creds, campaignId, range);

  return Promise.all(
    adGroups.map(async (adGroup) => ({
      ...adGroup,
      keywords: await listAppleAdsKeywords(creds, campaignId, adGroup.id, range),
    })),
  );
}
