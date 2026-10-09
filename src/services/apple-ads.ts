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
  days = 30,
): Promise<AppleAdsCampaign[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-AP-Context": `orgId=${creds.orgId}`,
    "Content-Type": "application/json",
  };

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const reportRes = await axios.post<any>(
    `${API_BASE}/reports/campaigns`,
    {
      startTime: fmt(start),
      endTime: fmt(end),
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

  const rows: any[] =
    reportRes.data?.data?.reportingDataResponse?.row ?? reportRes.data?.data?.row ?? reportRes.data?.row ?? [];

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

function dateRange(days: number): { startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startTime: fmt(start), endTime: fmt(end) };
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

export async function listAppleAdsAdGroups(
  creds: AppleAdsCredentials,
  campaignId: string,
  days = 30,
): Promise<AppleAdsAdGroup[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);
  const { startTime, endTime } = dateRange(days);

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

  return rowsFromReport(reportRes.data)
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
  days = 30,
): Promise<AppleAdsKeyword[]> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const headers = authedHeaders(accessToken, creds.orgId);
  const { startTime, endTime } = dateRange(days);

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

  return rowsFromReport(reportRes.data)
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
  days = 30,
): Promise<AppleAdsAdGroupWithKeywords[]> {
  const adGroups = await listAppleAdsAdGroups(creds, campaignId, days);
  return Promise.all(
    adGroups.map(async (adGroup) => ({
      ...adGroup,
      keywords: await listAppleAdsKeywords(creds, campaignId, adGroup.id, days),
    })),
  );
}
