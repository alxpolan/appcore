import jwt from "jsonwebtoken";
import axios from "./utils/http";

const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const API_BASE = "https://api.searchads.apple.com/api/v5";

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
