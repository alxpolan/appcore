import axios from "./utils/http";
import crypto from "crypto";
import { env } from "../config";
import { decrypt, encrypt } from "../config/encryption";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";

export const GOOGLE_ADS_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleAdsOAuthState {
  teamId: string;
  userId: string;
  customerId: string;
  ts: number;
}

export function googleAdsOAuthAvailable(): boolean {
  return Boolean(env.GOOGLE_ADS_OAUTH_CLIENT_ID && env.GOOGLE_ADS_OAUTH_CLIENT_SECRET);
}

export function googleAdsOAuthRedirectUri(): string {
  return `${env.APP_URL}/api/google-ads/oauth/callback`;
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
}

export function signGoogleAdsOAuthState(input: Omit<GoogleAdsOAuthState, "ts">): string {
  const data = Buffer.from(encrypt(JSON.stringify({ ...input, ts: Date.now() }))).toString("base64url");

  return `${data}.${hmac(data)}`;
}

export function verifyGoogleAdsOAuthState(state: string): GoogleAdsOAuthState | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;

  const data = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(data);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed = JSON.parse(decrypt(Buffer.from(data, "base64url").toString())) as GoogleAdsOAuthState;

    if (!parsed.teamId || !parsed.userId || !parsed.customerId || !parsed.ts) {
      return null;
    }

    if (Date.now() - parsed.ts > GOOGLE_ADS_OAUTH_STATE_TTL_MS) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function buildGoogleAdsAuthUrl(state: string): string {
  const clientId = env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("Google Ads OAuth is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleAdsOAuthRedirectUri(),
    response_type: "code",
    scope: GOOGLE_ADS_OAUTH_SCOPE,
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleAdsCode(code: string): Promise<{ refreshToken: string }> {
  const clientId = env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Ads OAuth is not configured");

  const tokenRes = await axios.post<{ refresh_token?: string; error?: string; error_description?: string }>(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleAdsOAuthRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  if (tokenRes.data.error) {
    throw new Error(tokenRes.data.error_description ?? tokenRes.data.error);
  }

  const refreshToken = tokenRes.data.refresh_token;
  if (!refreshToken) throw new Error("Google did not return a refresh token");

  return { refreshToken };
}
