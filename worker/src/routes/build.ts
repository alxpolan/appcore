import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { findFastlane } from "../fastlane-utils";
import { execAsync, buildWithGym, resolveRepoWorkDir, findConfigFile } from "./shared";
import { prepareNativeDeps } from "../native";

export const buildRouter = Router();

interface BuildRequest {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  bundleId: string;
  iosDir?: string;
  framework?: string;
  gymScheme?: string;
  exportMethod?: string;
  signingCertP12?: string;
  signingCertPassword?: string;
  signingProvisioningProfile?: string;
  /** One profile per bundle ID; takes precedence over the singular field above. */
  signingProvisioningProfiles?: string[];
  signingTeamId?: string;
  versionString?: string;
}

buildRouter.post("/build", async (req: Request, res: Response) => {
  const body = req.body as BuildRequest;
  const {
    repoUrl,
    accessToken,
    branch,
    appName,
    bundleId,
    iosDir,
    framework,
    gymScheme,
    exportMethod = "app-store",
    signingCertP12,
    signingCertPassword,
    signingProvisioningProfile,
    signingProvisioningProfiles,
    signingTeamId,
    versionString,
  } = body;

  const profiles = signingProvisioningProfiles?.length
    ? signingProvisioningProfiles
    : signingProvisioningProfile
      ? [signingProvisioningProfile]
      : [];

  const signingCreds =
    signingCertP12 && signingCertPassword && profiles.length > 0
      ? {
          p12Base64: signingCertP12,
          p12Password: signingCertPassword,
          profilesBase64: profiles,
          teamId: signingTeamId,
        }
      : undefined;

  if (!repoUrl || !accessToken || !bundleId) {
    res.status(400).json({
      error: "Missing required fields: repoUrl, accessToken, bundleId",
    });
    return;
  }

  if (branch && !/^[a-zA-Z0-9/_.-]+$/.test(branch)) {
    res.status(400).json({ error: "Invalid branch name" });
    return;
  }

  const tmpDir = path.join(os.tmpdir(), `worker-build-${Date.now()}`);
  const logs: string[] = [];
  const errors: string[] = [];

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const cloneUrl = repoUrl.replace("https://", `https://x-access-token:${accessToken}@`);

    logs.push(`[repo] Cloning repo${branch ? ` @${branch}` : ""} ...`);
    await execAsync(`git clone --depth 1 ${branch ? `--branch ${branch}` : ""} "${cloneUrl}" "${tmpDir}"`, {
      timeout: 120_000,
    });
    logs.push("[repo] Clone complete");

    const workDir = resolveRepoWorkDir(tmpDir, iosDir, logs);

    await prepareNativeDeps(tmpDir, workDir, (line) => logs.push(line), framework);

    let resolvedScheme = gymScheme;
    const configFile = findConfigFile(workDir);
    if (configFile) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"))?._config ?? {};
        if (cfg.scheme) {
          resolvedScheme = cfg.scheme;
          logs.push(`[config] Using scheme from config.json: ${resolvedScheme}`);
        }
      } catch {
        logs.push("[config] Warning: could not parse config.json");
      }
    }

    const fastlanePath = await findFastlane();
    const ipaResult = await buildWithGym(
      workDir,
      appName,
      bundleId,
      resolvedScheme,
      exportMethod,
      fastlanePath,
      logs,
      signingCreds,
      versionString,
    );

    res.json({
      ok: true,
      logs,
      errors,
      ipaBuilt: true,
      ipaBase64: ipaResult.ipaBase64,
      originalFilename: ipaResult.originalFilename,
      sizeBytes: ipaResult.sizeBytes,
      appStoreInfoBase64: ipaResult.appStoreInfoBase64,
      buildNumber: ipaResult.buildNumber,
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    res.json({ ok: false, logs, errors, ipaBuilt: false });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
