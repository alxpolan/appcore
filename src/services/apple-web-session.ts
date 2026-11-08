import fs from "node:fs";
import path from "node:path";
import { listDataUsagePurposes } from "./asc-privacy";

export interface AppleSessionStatus {
  configured: boolean;
  valid: boolean;
  checkedAt: string | null;
  reason: string | null;
}

let cookieOverride: string | null = null;
let cachedStatus: AppleSessionStatus | null = null;
let cachedStatusAt = 0;

const STATUS_TTL_MS = 5 * 60 * 1000;

function envPath(): string {
  return path.join(process.cwd(), ".env");
}

export function getAppleSessionCookies(): string {
  return (cookieOverride ?? process.env.ASC_ANALYTICS_COOKIES ?? "").trim();
}

export function getIrisTeam(): { teamId: string; teamType: string } {
  return {
    teamId: process.env.ASC_IRIS_TEAM_ID?.trim() ?? "",
    teamType: process.env.ASC_IRIS_TEAM_TYPE?.trim() ?? "",
  };
}

export function updateEnvText(text: string, cookies: string): string {
  const lines = text.split("\n");
  let seen = false;
  const updated = lines.map((line) => {
    if (line.startsWith("ASC_ANALYTICS_COOKIES=")) {
      seen = true;

      return `ASC_ANALYTICS_COOKIES=${cookies}`;
    }

    return line;
  });

  if (!seen) updated.push(`ASC_ANALYTICS_COOKIES=${cookies}`);

  return updated.join("\n");
}

export function setAppleSessionCookies(cookies: string): void {
  const trimmed = cookies.trim();

  if (!trimmed) {
    throw new Error("Cannot store an empty Apple session");
  }

  cookieOverride = trimmed;
  process.env.ASC_ANALYTICS_COOKIES = trimmed;
  cachedStatus = null;

  try {
    const file = envPath();

    if (!fs.existsSync(file)) return;

    fs.writeFileSync(file, updateEnvText(fs.readFileSync(file, "utf8"), trimmed));
  } catch {
    return;
  }
}

export function __testResetSession(): void {
  cookieOverride = null;
  cachedStatus = null;
}

export function clearSessionCache(): void {
  cachedStatus = null;
}

export async function checkAppleSession(): Promise<AppleSessionStatus> {
  const now = Date.now();

  if (cachedStatus && now - cachedStatusAt < STATUS_TTL_MS) return cachedStatus;

  const cookies = getAppleSessionCookies();

  if (!cookies) {
    cachedStatus = { configured: false, valid: false, checkedAt: null, reason: "not configured" };
    cachedStatusAt = now;

    return cachedStatus;
  }

  const { teamId, teamType } = getIrisTeam();

  try {
    await listDataUsagePurposes({ cookies, teamId, teamType }, "0");

    cachedStatus = { configured: true, valid: true, checkedAt: new Date(now).toISOString(), reason: null };
  } catch (err: any) {
    const expired = err?.name === "WebSessionExpiredError";

    cachedStatus = {
      configured: true,
      valid: false,
      checkedAt: new Date(now).toISOString(),
      reason: expired ? "expired" : (err?.message ?? "check failed"),
    };
  }

  cachedStatusAt = now;

  return cachedStatus;
}
