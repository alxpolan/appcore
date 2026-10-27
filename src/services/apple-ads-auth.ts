import jwt from "jsonwebtoken";
import axios from "./utils/http";
import { prisma } from "../config";
import {
  AppleAdsCampaignNotFoundError,
  type AppleAdsCampaignObject,
  type AppleAdsCredentials,
  type AppleAdsOrgCredentials,
  type AppleAdsOrgOption,
} from "./apple-ads-types";

export const TOKEN_URL = process.env.APPLE_ADS_TOKEN_URL ?? "https://appleid.apple.com/auth/oauth2/token";
export const API_BASE = process.env.APPLE_ADS_API_BASE ?? "https://api.searchads.apple.com/api/v5";

interface AppleAdsOrg {
  orgId: number;
  orgName: string;
}

export function generateClientSecret({ clientId, teamId, keyId, privateKey }: AppleAdsOrgCredentials): string {
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

export function authedHeaders(accessToken: string, orgId: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-AP-Context": `orgId=${orgId}`,
    "Content-Type": "application/json",
  };
}

export function throwIfAppleError(data: any, context: string): void {
  if (data?.error) {
    const details = Array.isArray(data.error.errors)
      ? data.error.errors.map((e: any) => e.messageCode ?? e.message ?? JSON.stringify(e)).join("; ")
      : (data.error.message ?? JSON.stringify(data.error));

    throw new Error(`Apple Search Ads ${context} error: ${details}`);
  }
}

export function money(amount: number, currency: string) {
  return { amount: String(amount), currency };
}

export function toAppleAdsDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000`;

  return value;
}

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

export async function listTeamAppleAdsOrgs(teamId: string): Promise<AppleAdsOrgOption[]> {
  const apps = await prisma.app.findMany({
    where: { teamId, isOwnApp: true, appleAdsOrgId: { not: null } },
    select: { appleAdsOrgId: true, appleAdsOrgName: true },
  });

  const byId = new Map<string, string>();
  for (const app of apps) {
    if (app.appleAdsOrgId && !byId.has(app.appleAdsOrgId)) {
      byId.set(app.appleAdsOrgId, app.appleAdsOrgName ?? app.appleAdsOrgId);
    }
  }

  return [...byId]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([orgId, orgName]) => ({ orgId, orgName }));
}

export async function resolveAppOrgByAdamId(
  teamId: string,
  adamId: number | string,
): Promise<AppleAdsOrgOption | null> {
  let trackId: bigint;

  try {
    trackId = BigInt(adamId);
  } catch {
    return null;
  }

  const app = await prisma.app.findFirst({ where: { teamId, trackId } });
  if (!app?.appleAdsOrgId) return null;

  return { orgId: app.appleAdsOrgId, orgName: app.appleAdsOrgName ?? app.appleAdsOrgId };
}

export async function getAppleAdsCampaign(
  creds: AppleAdsCredentials,
  campaignId: string,
): Promise<AppleAdsCampaignObject> {
  const accessToken = await fetchAppleAdsAccessToken(creds);
  const res = await axios.get<any>(`${API_BASE}/campaigns/${campaignId}`, {
    headers: authedHeaders(accessToken, creds.orgId),
  });

  throwIfAppleError(res.data, "campaign fetch");
  const data = res.data?.data;
  if (data?.id == null) throw new Error("Apple Search Ads campaign fetch returned no campaign");

  return {
    id: String(data.id),
    name: String(data.name ?? ""),
    status: String(data.status ?? ""),
    adamId: data.adamId != null ? Number(data.adamId) : null,
  };
}

export async function resolveCampaignOrgId(
  keyCreds: AppleAdsOrgCredentials,
  orgIds: string[],
  campaignId: string,
): Promise<string> {
  for (const orgId of orgIds) {
    try {
      await getAppleAdsCampaign({ ...keyCreds, orgId }, campaignId);

      return orgId;
    } catch (err: any) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }

  throw new AppleAdsCampaignNotFoundError(campaignId);
}
