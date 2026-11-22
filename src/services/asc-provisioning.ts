import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { logger, prisma } from "../config";
import { ascClientForTeam } from "./asc-client";
import { parseProvisioningProfiles, resolveSigningCredentials } from "./utils/provisioning-profiles";
import type { ASCProfile } from "./appstore-connect-types";

const RENEW_BEFORE_DAYS = 30;

export function normalizeSerial(serial: string): string {
  return serial.replace(/^serial=/i, "").replace(/[^0-9a-f]/gi, "").toUpperCase().replace(/^0+/, "");
}

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "asc-prov-"));

  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runOpenssl(args: string[], input?: Buffer): Buffer {
  try {
    return execFileSync("openssl", args, input ? { input } : {});
  } catch (err) {
    if (!args.includes("legacy")) {
      return execFileSync("openssl", [...args, "-provider", "legacy", "-provider", "default"], input ? { input } : {});
    }

    throw err;
  }
}

export function certificateSerial(p12Base64: string, password: string): string | null {
  try {
    return withTempDir((dir) => {
      const p12Path = join(dir, "cert.p12");
      const pemPath = join(dir, "cert.pem");

      writeFileSync(p12Path, Buffer.from(p12Base64, "base64"), { mode: 0o600 });
      runOpenssl(["pkcs12", "-nokeys", "-clcerts", "-in", p12Path, "-passin", `pass:${password}`, "-out", pemPath]);

      const out = runOpenssl(["x509", "-noout", "-serial", "-in", pemPath]).toString().trim();
      const normalized = normalizeSerial(out);

      return normalized.length > 0 ? normalized : null;
    });
  } catch {
    return null;
  }
}

export interface ParsedProvision {
  bundleId: string;
  expiresAt: string | null;
}

export function parseMobileProvision(profileBase64: string): ParsedProvision | null {
  try {
    return withTempDir((dir) => {
      const profilePath = join(dir, "profile.mobileprovision");
      const plistPath = join(dir, "payload.plist");

      writeFileSync(profilePath, Buffer.from(profileBase64, "base64"), { mode: 0o600 });
      runOpenssl(["cms", "-verify", "-inform", "DER", "-in", profilePath, "-noverify", "-out", plistPath]);

      const plist = readFileSync(plistPath, "utf8");
      const match = plist.match(/<key>application-identifier<\/key>\s*<string>([^<]+)<\/string>/);

      if (!match) return null;

      const parts = match[1].split(".");

      if (parts.length < 2) return null;

      const expiry = plist.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/);

      return { bundleId: parts.slice(1).join("."), expiresAt: expiry ? expiry[1] : null };
    });
  } catch {
    return null;
  }
}

export function mobileProvisionBundleId(profileBase64: string): string | null {
  return parseMobileProvision(profileBase64)?.bundleId ?? null;
}

export function collectTargetBundles(
  mainBundleId: string,
  stored: string[],
  bundleIdOf: (raw: string) => string | null = mobileProvisionBundleId,
): string[] {
  const targets = [mainBundleId];

  for (const raw of stored) {
    const bundleId = bundleIdOf(raw);

    if (bundleId && !targets.includes(bundleId)) targets.push(bundleId);
  }

  return targets;
}

export function upsertStoredProfile(
  existing: string[],
  bundleId: string,
  profileBase64: string,
  bundleIdOf: (raw: string) => string | null = mobileProvisionBundleId,
): string[] {
  const next: string[] = [];
  let replaced = false;

  for (const raw of existing) {
    if (!replaced && bundleIdOf(raw) === bundleId) {
      next.push(profileBase64);
      replaced = true;
    } else {
      next.push(raw);
    }
  }

  if (!replaced) next.push(profileBase64);

  return next;
}

export function profileUsable(expiresAt: string | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;

  const expires = new Date(expiresAt);

  if (Number.isNaN(expires.getTime())) return false;

  return expires.getTime() - now.getTime() > RENEW_BEFORE_DAYS * 24 * 60 * 60 * 1000;
}

function profileCertificateIds(profile: ASCProfile): string[] {
  const data = (profile as unknown as { relationships?: { certificates?: { data?: Array<{ id?: string }> } } })
    .relationships?.certificates?.data;

  if (!Array.isArray(data)) return [];

  return data.map((entry) => entry?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

export interface EnsuredProfile {
  bundleId: string;
  profileId: string;
  profileName: string;
  expiresAt: string;
  reused: boolean;
}

export async function ensureAppStoreProfiles(appId: string): Promise<EnsuredProfile[]> {
  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: {
      id: true,
      name: true,
      bundleId: true,
      teamId: true,
      signingCertificate: {
        select: { name: true, certP12: true, certPassword: true, appleTeamId: true },
      },
      signingCertP12: true,
      signingCertPassword: true,
      signingTeamId: true,
      signingProvisioningProfile: true,
      signingProvisioningProfiles: true,
    },
  });

  if (!app) throw new Error("App not found");
  if (!app.teamId) throw new Error("App must belong to a team to generate profiles via API");

  const signing = resolveSigningCredentials(app);

  if (!signing) throw new Error("No signing certificate linked — link a team certificate first");

  const serial = certificateSerial(signing.certP12, signing.certPassword);

  if (!serial) throw new Error("Could not read the linked certificate");

  const asc = await ascClientForTeam(app.teamId);

  if (!asc) throw new Error("No App Store Connect API key configured for this team");

  const certificates = await asc.listCertificates();
  const certificate = certificates.find(
    (entry) =>
      entry.attributes?.certificateType?.includes("DISTRIBUTION") &&
      normalizeSerial(entry.attributes?.serialNumber ?? "") === serial,
  );

  if (!certificate) throw new Error("Distribution certificate not found in App Store Connect");

  const stored = parseProvisioningProfiles(app);
  const targets = collectTargetBundles(app.bundleId, stored);
  const next = [...stored];
  const results: EnsuredProfile[] = [];

  for (const target of targets) {
    const bundle =
      (await asc.findBundleIdResource(target)) ?? (await asc.createBundleIdResource(target, `${app.name} ${target}`));

    const existing = await asc.listProfilesForBundleId(bundle.id);
    const reusable = existing.find((profile) => {
      if (profile.attributes?.profileType !== "IOS_APP_STORE") return false;
      if (!profileUsable(profile.attributes?.expirationDate)) return false;

      return profileCertificateIds(profile).includes(certificate.id);
    });

    let profileId: string;
    let profileName: string;
    let expiresAt: string;
    let profileContent: string;
    let reused: boolean;

    if (reusable) {
      const full = await asc.getProfile(reusable.id);

      if (!full.attributes?.profileContent || !full.attributes?.expirationDate) {
        throw new Error(`App Store Connect returned no profile content for ${target}`);
      }

      profileId = full.id;
      profileName = full.attributes?.name ?? "";
      expiresAt = full.attributes.expirationDate;
      profileContent = full.attributes.profileContent;
      reused = true;
    } else {
      const created = await asc.createAppStoreProfile(`${target} App Store`, bundle.id, [certificate.id]);

      if (!created.attributes?.profileContent || !created.attributes?.expirationDate) {
        throw new Error(`App Store Connect returned no profile content for ${target}`);
      }

      profileId = created.id;
      profileName = created.attributes?.name ?? "";
      expiresAt = created.attributes.expirationDate;
      profileContent = created.attributes.profileContent;
      reused = false;

      logger.info(`[asc-provisioning] Created App Store profile "${profileName}" for ${target}`);
    }

    const replaced = upsertStoredProfile(next, target, profileContent);

    next.length = 0;
    next.push(...replaced);
    results.push({ bundleId: target, profileId, profileName, expiresAt, reused });
  }

  await prisma.app.update({
    where: { id: app.id },
    data: {
      signingProvisioningProfiles: JSON.stringify(next),
      signingProvisioningProfile: null,
    },
  });

  return results;
}
