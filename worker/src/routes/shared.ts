import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

export const execAsync = promisify(exec);

export function findConfigFile(dir: string, maxDepth = 4): string | null {
  if (maxDepth <= 0) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "fastlane" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findConfigFile(full, maxDepth - 1);
      if (found) return found;
    } else if (entry.name === "config.json") return full;
  }
  return null;
}

export interface SigningCreds {
  p12Base64: string;
  p12Password: string;
  /** Legacy single-profile form, still accepted. */
  profileBase64?: string;
  /** One entry per bundle ID. Apps with extensions need several. */
  profilesBase64?: string[];
  teamId?: string;
}

export interface InstalledProfile {
  uuid: string;
  /** Bundle ID the profile is valid for, team prefix stripped. May end in "*". */
  appId: string;
  name: string;
}

/** Matches a bundle ID against a profile App ID, honouring wildcard profiles. */
export function profileMatchesBundleId(appId: string, bundleId: string): boolean {
  if (appId === bundleId) return true;
  if (!appId.endsWith("*")) return false;
  return bundleId.startsWith(appId.slice(0, -1));
}

/**
 * Picks the most specific profile for a bundle ID: an exact match always wins over a
 * wildcard, and among wildcards the longest prefix wins.
 */
export function pickProfileFor(profiles: InstalledProfile[], bundleId: string): InstalledProfile | undefined {
  return profiles
    .filter((p) => profileMatchesBundleId(p.appId, bundleId))
    .sort((a, b) => {
      if (a.appId === bundleId) return -1;
      if (b.appId === bundleId) return 1;
      return b.appId.length - a.appId.length;
    })[0];
}

export function resolveRepoWorkDir(repoDir: string, iosDir: string | undefined, logs: string[]): string {
  const raw = iosDir?.trim();
  if (!raw) return repoDir;

  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return repoDir;

  const workDir = path.resolve(repoDir, normalized);
  const relative = path.relative(repoDir, workDir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid iosDir path: ${iosDir}`);
  }

  if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
    throw new Error(`Configured iosDir not found in repo: ${normalized}`);
  }

  logs.push(`[repo] Using iOS subdirectory: ${normalized}`);
  return workDir;
}

export async function installSigningCreds(
  creds: SigningCreds,
  logs: string[],
): Promise<{ cleanup: () => Promise<void>; profiles: InstalledProfile[] }> {
  const tmpSignDir = path.join(os.tmpdir(), `signing-${Date.now()}`);
  fs.mkdirSync(tmpSignDir, { recursive: true });

  const p12Path = path.join(tmpSignDir, "cert.p12");
  const keychainName = `appcore-build-${Date.now()}.keychain`;
  const keychainPassword = `kc-${Date.now()}`;
  const profilesDir = path.join(os.homedir(), "Library", "MobileDevice", "Provisioning Profiles");

  fs.writeFileSync(p12Path, Buffer.from(creds.p12Base64, "base64"));

  const rawProfiles = creds.profilesBase64?.length
    ? creds.profilesBase64
    : creds.profileBase64
      ? [creds.profileBase64]
      : [];
  if (rawProfiles.length === 0) throw new Error("No provisioning profile supplied");

  fs.mkdirSync(profilesDir, { recursive: true });

  const profiles: InstalledProfile[] = [];
  const destProfiles: string[] = [];

  for (const [index, base64] of rawProfiles.entries()) {
    const profilePath = path.join(tmpSignDir, `profile-${index}.mobileprovision`);
    fs.writeFileSync(profilePath, Buffer.from(base64, "base64"));

    // `security cms -D` unwraps the CMS signature around the plist; every field below
    // comes from that decoded plist.
    const read = async (expr: string): Promise<string> => {
      const { stdout } = await execAsync(`security cms -D -i "${profilePath}" 2>/dev/null | plutil ${expr} -`);
      return stdout.trim();
    };

    let uuid: string;
    try {
      uuid = await read("-extract UUID raw");
    } catch {
      uuid = `appcore-${Date.now()}-${index}`;
    }

    // application-identifier is "TEAMID.com.example.app"; the team prefix has to go so
    // it can be compared against a target's PRODUCT_BUNDLE_IDENTIFIER.
    let appId = "";
    try {
      const raw = await read("-extract Entitlements.application-identifier raw");
      appId = raw.includes(".") ? raw.slice(raw.indexOf(".") + 1) : raw;
    } catch {
      appId = "";
    }

    let name = "";
    try {
      name = await read("-extract Name raw");
    } catch {
      name = uuid;
    }

    const destProfile = path.join(profilesDir, `${uuid}.mobileprovision`);
    fs.copyFileSync(profilePath, destProfile);
    destProfiles.push(destProfile);

    profiles.push({ uuid, appId, name });
    logs.push(`[signing] Profile "${name}" → ${appId || "unknown app ID"} (${uuid})`);
  }

  await execAsync(`security create-keychain -p "${keychainPassword}" "${keychainName}"`);
  await execAsync(`security set-keychain-settings -lut 21600 "${keychainName}"`);
  await execAsync(`security unlock-keychain -p "${keychainPassword}" "${keychainName}"`);

  const { stdout: currentList } = await execAsync("security list-keychains -d user");

  const existing = currentList
    .trim()
    .split("\n")
    .map((k) => k.trim().replace(/"/g, ""));

  await execAsync(`security list-keychains -d user -s "${keychainName}" ${existing.map((k) => `"${k}"`).join(" ")}`);

  await execAsync(
    `security import "${p12Path}" -k "${keychainName}" -P "${creds.p12Password}" -T /usr/bin/codesign -T /usr/bin/security -f pkcs12`,
  );
  await execAsync(
    `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${keychainPassword}" "${keychainName}"`,
  );

  const cleanup = async () => {
    try {
      await execAsync(`security delete-keychain "${keychainName}"`);
      logs.push("[signing] Temporary keychain deleted");
    } catch {
      /* ignore */
    }
    try {
      for (const p of destProfiles) fs.rmSync(p, { force: true });
      logs.push("[signing] Signing credentials removed");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(tmpSignDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      await execAsync(`security list-keychains -d user -s ${existing.map((k) => `"${k}"`).join(" ")}`);
    } catch {
      /* ignore */
    }
  };

  return { cleanup, profiles };
}

interface TargetInfo {
  target: string;
  bundleId: string;
}

/** xcodebuild can prefix its JSON with warnings, so the array is located explicitly. */
function parseBuildSettingsJson(stdout: string): Array<{ target?: string; buildSettings?: Record<string, string> }> {
  const start = stdout.indexOf("[");
  if (start < 0) return [];
  return JSON.parse(stdout.slice(start));
}

/**
 * Reads every target in the project along with its bundle ID, so each one can be pointed
 * at the profile that actually covers it.
 */
async function listBuildTargets(repoDir: string, scheme: string, logs: string[]): Promise<TargetInfo[]> {
  const projectFile = fs.readdirSync(repoDir).find((e) => e.endsWith(".xcodeproj"));

  // `-alltargets` is what makes extensions visible. Querying by `-scheme` only reports
  // targets listed in the scheme, and a widget is usually built as an implicit
  // dependency instead, so it never shows up and silently stays unsigned.
  const attempts: string[] = [];
  if (projectFile) attempts.push(`-showBuildSettings -json -project "${projectFile}" -alltargets`);
  attempts.push(`-showBuildSettings -json -scheme "${scheme}"`);

  for (const args of attempts) {
    try {
      const { stdout } = await execAsync(`xcodebuild ${args}`, {
        cwd: repoDir,
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      const targets: TargetInfo[] = [];
      for (const entry of parseBuildSettingsJson(stdout)) {
        const bundleId = entry.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER;
        if (entry.target && bundleId && !targets.some((t) => t.target === entry.target)) {
          targets.push({ target: entry.target, bundleId });
        }
      }
      if (targets.length > 0) {
        logs.push(`[signing] Targets found: ${targets.map((t) => `${t.target} (${t.bundleId})`).join(", ")}`);
        return targets;
      }
    } catch (err) {
      logs.push(`[signing] Target enumeration attempt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logs.push("[signing] WARNING: could not enumerate targets - only the main bundle ID will be signed");
  return [];
}

export async function buildWithGym(
  repoDir: string,
  appName: string,
  bundleId: string,
  gymScheme: string | undefined,
  exportMethod: string,
  fastlanePath: string,
  logs: string[],
  signingCreds?: SigningCreds,
  versionString?: string,
): Promise<{
  ipaBase64: string;
  originalFilename: string;
  sizeBytes: number;
  appStoreInfoBase64?: string;
  buildNumber: string;
}> {
  logs.push("[build] Starting build");

  let signingCleanup: (() => Promise<void>) | undefined;
  let installedProfiles: InstalledProfile[] = [];
  if (signingCreds) {
    logs.push("[build] Installing signing credentials ...");
    const { cleanup, profiles } = await installSigningCreds(signingCreds, logs);
    signingCleanup = cleanup;
    installedProfiles = profiles;
    logs.push(`[build] ${profiles.length} provisioning profile(s) installed successfully`);
  } else {
    logs.push("[build] No signing credentials provided — build may fail at code-signing step");
  }

  const fastlaneDir = path.join(repoDir, "fastlane");
  fs.mkdirSync(fastlaneDir, { recursive: true });

  const buildNumber = String(Math.floor(Date.now() / 1000));
  const xcargsList: string[] = [];
  if (versionString) xcargsList.push(`MARKETING_VERSION=${versionString}`);
  xcargsList.push(`CURRENT_PROJECT_VERSION=${buildNumber}`);

  const gymfile = [
    `scheme("${gymScheme ?? appName}")`,
    `export_method("${exportMethod}")`,
    `clean(false)`,
    `output_directory("./build")`,
    `output_name("${bundleId}")`,
  ];

  const scheme = gymScheme ?? appName;

  // Every embedded target needs its own entry under manual signing, so the mapping is
  // derived from the project's targets rather than assuming a single bundle ID.
  const schemeTargets = installedProfiles.length > 0 ? await listBuildTargets(repoDir, scheme, logs) : [];
  const signedTargets: Array<{ target: string; bundleId: string; profile: InstalledProfile }> = [];
  for (const t of schemeTargets) {
    const profile = pickProfileFor(installedProfiles, t.bundleId);
    if (profile) {
      signedTargets.push({ target: t.target, bundleId: t.bundleId, profile });
    } else {
      logs.push(`[signing] WARNING: no provisioning profile matches target "${t.target}" (${t.bundleId})`);
    }
  }

  // Fallback for when target enumeration fails: at least sign the main bundle ID.
  if (signedTargets.length === 0 && installedProfiles.length > 0) {
    const profile = pickProfileFor(installedProfiles, bundleId) ?? installedProfiles[0];
    signedTargets.push({ target: scheme, bundleId, profile });
  }

  // An uploaded profile that never gets used almost always means its target was missed,
  // which previously only surfaced as an archive failure much later.
  for (const profile of installedProfiles) {
    if (!signedTargets.some((t) => t.profile.uuid === profile.uuid)) {
      logs.push(`[signing] WARNING: profile "${profile.name}" (${profile.appId}) matched no target and is unused`);
    }
  }

  if (installedProfiles.length > 0) {
    if (signingCreds?.teamId) xcargsList.push(`DEVELOPMENT_TEAM=${signingCreds.teamId}`);
  }
  gymfile.push(`xcargs("${xcargsList.join(" ")}")`);

  if (installedProfiles.length > 0) {
    const mapping = new Map(signedTargets.map((t) => [t.bundleId, t.profile.uuid]));
    gymfile.push(
      `export_options({`,
      `  method: "${exportMethod}",`,
      `  signingStyle: "manual",`,
      `  generateAppStoreInformation: true,`,
      `  provisioningProfiles: {`,
      [...mapping.entries()].map(([bid, uuid]) => `    "${bid}" => "${uuid}"`).join(",\n"),
      `  }`,
      `})`,
    );
  } else {
    gymfile.push(
      `export_options({`,
      `  method: "${exportMethod}",`,
      `  signingStyle: "automatic",`,
      `  generateAppStoreInformation: true`,
      `})`,
    );
  }
  fs.writeFileSync(path.join(fastlaneDir, "Gymfile"), gymfile.join("\n"));

  const buildDir = path.join(repoDir, "build");
  fs.mkdirSync(buildDir, { recursive: true });

  if (versionString) {
    logs.push(`[build] Version set to ${versionString} (via xcargs)`);
  }
  logs.push(`[build] Build number set to ${buildNumber}`);

  logs.push(`[build] Building ...`);
  const gymStart = Date.now();
  try {
    // One call per target. Without `targets:` the action writes the same profile into
    // every target, which is what made extensions fail: a profile is bound to exactly
    // one App ID and can never cover both the app and its widget.
    for (const { target, bundleId: targetBundleId, profile } of signedTargets) {
      const updateSigningArgs = [
        `run`,
        `update_code_signing_settings`,
        `use_automatic_signing:false`,
        `'code_sign_identity:iPhone Distribution'`,
        `targets:"${target}"`,
        `profile_uuid:${profile.uuid}`,
        signingCreds?.teamId ? `team_id:${signingCreds.teamId}` : ``,
      ]
        .filter(Boolean)
        .join(` `);
      await execAsync(`${fastlanePath} ${updateSigningArgs} 2>&1`, {
        cwd: repoDir,
        timeout: 60_000,
        env: {
          ...process.env,
          FASTLANE_DISABLE_COLORS: "1",
          LANG: "en_US.UTF-8",
          LANGUAGE: "en_US.UTF-8",
          LC_ALL: "en_US.UTF-8",
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      logs.push(`[signing] ${target} (${targetBundleId}) → "${profile.name}"`);
    }

    await execAsync(`${fastlanePath} gym 2>&1`, {
      cwd: repoDir,
      timeout: 900_000,
      env: {
        ...process.env,
        FASTLANE_DISABLE_COLORS: "1",
        LANG: "en_US.UTF-8",
        LANGUAGE: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    logs.push(`[build] Build finished in ${Math.round((Date.now() - gymStart) / 1000)}s`);
  } catch (gymErr) {
    const e = gymErr as { stdout?: string; stderr?: string; code?: number };
    if (e.stdout) logs.push(...e.stdout.split("\n").filter(Boolean));
    if (e.stderr)
      logs.push(
        ...e.stderr
          .split("\n")
          .filter(Boolean)
          .map((l: string) => `[stderr] ${l}`),
      );
    logs.push(
      `[build] FAILED after ${Math.round((Date.now() - gymStart) / 1000)}s — exit code: ${e.code ?? "unknown"}`,
    );
    await signingCleanup?.();
    throw new Error(`build exited with code ${e.code ?? "unknown"}.`);
  }

  const findIpa = (dir: string): string | undefined => {
    if (!fs.existsSync(dir)) return undefined;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".ipa")) return full;
      if (entry.isDirectory()) {
        const nested = findIpa(full);
        if (nested) return nested;
      }
    }
    return undefined;
  };

  const ipa = findIpa(buildDir) ?? findIpa(repoDir);
  if (!ipa) {
    await signingCleanup?.();
    throw new Error("gym completed but no .ipa file was found");
  }

  const ipaBuffer = fs.readFileSync(ipa);
  const ipaBase64 = ipaBuffer.toString("base64");
  const ipaSize = ipaBuffer.length;

  const appStoreInfoPath = path.join(path.dirname(ipa), "AppStoreInfo.plist");
  const appStoreInfoBase64 = fs.existsSync(appStoreInfoPath)
    ? fs.readFileSync(appStoreInfoPath).toString("base64")
    : undefined;

  logs.push(
    `[build] Binary ready (${(ipaSize / 1024 / 1024).toFixed(1)} MB)${appStoreInfoBase64 ? " + AppStoreInfo.plist" : ""}`,
  );
  await signingCleanup?.();
  return {
    ipaBase64,
    originalFilename: path.basename(ipa),
    sizeBytes: ipaSize,
    appStoreInfoBase64,
    buildNumber,
  };
}
