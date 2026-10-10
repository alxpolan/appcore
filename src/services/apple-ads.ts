import jwt from "jsonwebtoken";
import axios from "./utils/http";

// Overridable for tests/stubs; production always uses Apple's endpoints.
const TOKEN_URL = process.env.APPLE_ADS_TOKEN_URL ?? "https://appleid.apple.com/auth/oauth2/token";
const API_BASE = process.env.APPLE_ADS_API_BASE ?? "https://api.searchads.apple.com/api/v5";

export interface AppleAdsCredentials {
  orgId: string;
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export interface AppleAdsOrgCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

interface AppleAdsOrg {
  orgId: number;
  orgName: string;
}

export interface AppleAdsOrgOption {
  orgId: string;
  orgName: string;
}

export interface AppleAdsStats {
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  ttr: number | null;
  avgCpt: number | null;
  avgCpa: number | null;
  conversionRate: number | null;
}

export interface AppleAdsCampaign extends AppleAdsStats {
  id: string;
  name: string;
  status: string;
  servingStatus: string;
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string | null;
  countriesOrRegions: string[];
  startTime: string | null;
  endTime: string | null;
}

export interface AppleAdsAdGroup extends AppleAdsStats {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  servingStatus: string;
  defaultBidAmount: number | null;
  cpaGoal: number | null;
  currency: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface AppleAdsKeyword extends AppleAdsStats {
  id: string;
  adGroupId: string;
  text: string;
  matchType: string;
  status: string;
  bidAmount: number | null;
  currency: string | null;
}

export interface AppleAdsAdGroupWithKeywords extends AppleAdsAdGroup {
  keywords: AppleAdsKeyword[];
}

export interface AppleAdsDailySpend {
  date: string;
  spend: number;
}

export interface AppleAdsReportRange {
  startDate: string;
  endDate: string;
}

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

/** Merges rows from several chunks that describe the same entity. Derived
 * ratios in `total` (avgCPT, …) are summed, not averaged — every consumer
 * recomputes them from the summed bases instead. */
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

function generateClientSecret({ clientId, teamId, keyId, privateKey }: AppleAdsOrgCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: clientId,
      iss: teamId,
      iat: now,
      exp: now + 60 * 60,
      aud: "https://appleid.apple.com",
    },
    privateKey,
    {
      algorithm: "ES256",
      header: { alg: "ES256", kid: keyId, typ: "JWT" },
    },
  );
}

export async function fetchAppleAdsAccessToken(creds: AppleAdsOrgCredentials): Promise<string> {
  const clientSecret = generateClientSecret(creds);

  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: clientSecret,
      scope: "searchadsorg",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  return (res.data as { access_token: string }).access_token;
}

/** Every org ("Campaign Group") this API key can see. A key can see more than
 * one when it belongs to an agency/parent account — the caller must pick which
 * one to use, there's no sane way to guess it server-side. */
export async function listAppleAdsOrgs(creds: AppleAdsOrgCredentials): Promise<AppleAdsOrgOption[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);

  const res = await axios.get<{ data: AppleAdsOrg[] }>(`${API_BASE}/acls`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const orgs = res.data.data ?? [];
  if (orgs.length === 0) {
    throw new Error("No Apple Search Ads organizations are visible to this API key");
  }

  return orgs.map((o) => ({ orgId: String(o.orgId), orgName: o.orgName }));
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

/** Pulls the row's metrics regardless of whether the response used
 * grouping/granularity (metrics live in `granularity[]`) or not (`total`). */
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

    // Apple can return HTTP 200 with a body-level error (data: null, error: {...})
    // for a malformed request instead of a 4xx — don't let that look like "no campaigns".
    if (reportRes.data?.error) {
      throw new Error(`Apple Search Ads reports error: ${JSON.stringify(reportRes.data.error)}`);
    }
    return reportRes.data?.data?.reportingDataResponse?.row ?? reportRes.data?.data?.row ?? reportRes.data?.row ?? [];
  };

  const chunks = await Promise.all(splitReportSpan(range).map((chunk) => fetchChunk(chunk.startDate, chunk.endDate)));
  const rows = mergeReportRows(chunks.flat(), (row) =>
    row.metadata?.campaignId != null ? String(row.metadata.campaignId) : undefined,
  );

  return rows
    .filter((row) => !row.metadata?.deleted)
    .map((row) => {
      const meta = row.metadata ?? {};
      return {
        id: String(meta.campaignId),
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

function authedHeaders(accessToken: string, orgId: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-AP-Context": `orgId=${orgId}`,
    "Content-Type": "application/json",
  };
}

function rowsFromReport(data: any): any[] {
  if (data?.error) throw new Error(`Apple Search Ads reports error: ${JSON.stringify(data.error)}`);
  return data?.data?.reportingDataResponse?.row ?? data?.data?.row ?? data?.row ?? [];
}

export async function getAppleAdsCampaignDailySpend(
  creds: AppleAdsCredentials,
  campaignId: string,
  range: AppleAdsReportRange = resolveAppleAdsRange({}),
): Promise<AppleAdsDailySpend[]> {
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

  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (String(row.metadata?.campaignId) !== campaignId) continue;
    for (const day of row.granularity ?? []) {
      const date = String(day.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + Number(day.localSpend?.amount ?? 0));
    }
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, spend]) => ({ date, spend }));
}

export interface AppleAdsCountryStats extends AppleAdsStats {
  countryOrRegion: string;
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

/** Per-country metrics for one campaign: spend, TTR, installs, … per
 * countryOrRegion, via a grouped campaign report. */
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

/** Per-country metrics for one keyword, via a grouped keyword report.
 * Whether Apple supports groupBy on the keyword report is unverified
 * against the live API — callers should surface Apple's error message. */
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
      return {
        id: String(meta.adGroupId),
        campaignId: String(meta.campaignId ?? campaignId),
        name: meta.adGroupName,
        status: meta.status ?? meta.adGroupStatus,
        servingStatus: meta.servingStatus,
        defaultBidAmount: meta.defaultBidAmount?.amount != null ? Number(meta.defaultBidAmount.amount) : null,
        cpaGoal: meta.cpaGoal?.amount != null ? Number(meta.cpaGoal.amount) : null,
        currency: meta.defaultBidAmount?.currency ?? meta.cpaGoal?.currency ?? null,
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
        status: meta.status ?? meta.keywordStatus,
        bidAmount: meta.bidAmount?.amount != null ? Number(meta.bidAmount.amount) : null,
        currency: meta.bidAmount?.currency ?? null,
        ...statsFromTotal(totalsFromRow(row)),
      };
    });
}

export interface AppleAdsStoreApp {
  adamId: string;
  name: string;
}

export interface CreateAppleAdsKeywordInput {
  text: string;
  matchType: "EXACT" | "BROAD";
  bidAmount?: number;
}

export interface CreateAppleAdsNegativeKeywordInput {
  text: string;
  matchType: "EXACT" | "BROAD";
}

export interface AppleAdsNegativeKeyword {
  id: string;
  text: string;
  matchType: string;
  status: string | null;
}

export interface CreateAppleAdsAdGroupInput {
  name: string;
  defaultBidAmount: number;
  cpaGoal?: number;
  status?: "ENABLED" | "PAUSED";
  keywords?: CreateAppleAdsKeywordInput[];
  negativeKeywords?: CreateAppleAdsNegativeKeywordInput[];
}

export interface CreateAppleAdsCampaignInput {
  name: string;
  adamId: number;
  countriesOrRegions: string[];
  dailyBudgetAmount: number;
  budgetAmount?: number;
  currency: string;
  supplySources: string[];
  status?: "ENABLED" | "PAUSED";
  startTime?: string;
  /** CPC for Search Results, CPM for Search Tab / Today Tab placements. */
  pricingModel?: "CPC" | "CPM";
  adGroups: CreateAppleAdsAdGroupInput[];
  negativeKeywords?: CreateAppleAdsNegativeKeywordInput[];
}

export interface CreatedAppleAdsCampaign {
  id: string;
  name: string;
  status: string;
  negativeKeywordCount: number;
  adGroups: { id: string; name: string; keywordCount: number; negativeKeywordCount: number }[];
}

function throwIfAppleError(data: any, context: string): void {
  if (data?.error) {
    const details = Array.isArray(data.error.errors)
      ? data.error.errors.map((e: any) => e.messageCode ?? e.message ?? JSON.stringify(e)).join("; ")
      : (data.error.message ?? JSON.stringify(data.error));
    throw new Error(`Apple Search Ads ${context} error: ${details}`);
  }
}

/** Apps the org can advertise, for the campaign-creation form. Best effort:
 * callers should fall back to another app source when this throws. */
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
  const rows = res.data?.data ?? [];
  return (Array.isArray(rows) ? rows : [])
    .filter((a: any) => a?.adamId != null)
    .map((a: any) => ({ adamId: String(a.adamId), name: String(a.appName ?? a.name ?? a.adamId) }));
}

function money(amount: number, currency: string) {
  return { amount: String(amount), currency };
}

/** Apple wants `yyyy-MM-dd'T'HH:mm:ss.SSS` without a zone; a plain `YYYY-MM-DD`
 * date is interpreted as midnight. Anything else passes through untouched. */
export function toAppleAdsDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000`;
  return value;
}

const SUPPLY_SOURCES = [
  "APPSTORE_SEARCH_RESULTS",
  "APPSTORE_SEARCH_TAB",
  "APPSTORE_TODAY_TAB",
  "APPSTORE_PRODUCT_PAGE",
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function asNonEmptyString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} is required`);
  const trimmed = (value as string).trim();
  if (trimmed.length > maxLen) fail(`${field} must be at most ${maxLen} characters`);
  return trimmed;
}

function asPositiveNumber(value: unknown, field: string): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) fail(`${field} must be a number greater than 0`);
  return n;
}

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

/** Validates untrusted campaign-creation input (REST body or MCP params) and
 * normalizes it into service input. Throws on invalid. */
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

export interface UpdateAppleAdsCampaignInput {
  name?: string;
  status?: "ENABLED" | "PAUSED";
  dailyBudgetAmount?: number;
  /** Required when dailyBudgetAmount is set — never guess the currency on money. */
  currency?: string;
  countriesOrRegions?: string[];
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

export interface UpdateAppleAdsAdGroupInput {
  name?: string;
  status?: "ENABLED" | "PAUSED";
  defaultBidAmount?: number;
  cpaGoal?: number;
  /** Required when defaultBidAmount or cpaGoal is set. */
  currency?: string;
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

export interface UpdateAppleAdsKeywordInput {
  keywordId: string;
  bidAmount?: number;
  status?: "ACTIVE" | "PAUSED";
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

  // Apple's update call requires text+matchType alongside the id, so resolve them first.
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
  // The resolve step above guarantees every id exists in byId.
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

/** Creates a campaign together with its ad groups, their keywords and all
 * negative keywords. Steps run sequentially so a failure stops before
 * creating more orphaned objects; already-created objects are returned on
 * the error for cleanup/debugging. */
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

/** Ad groups for a campaign, each with its own keywords (including bid
 * amount) and the same stat set Apple's own UI shows. Keywords live under an
 * ad group in Apple's API, so getting all of a campaign's keywords means one
 * extra call per ad group — fine in practice since campaigns rarely have more
 * than a handful. */
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
