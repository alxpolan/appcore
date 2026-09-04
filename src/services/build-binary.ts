import fs from "fs";
import path from "path";
import os from "os";
import { logger, prisma } from "../config";
import { workerClient } from "./worker-client";
import { postCommitStatus } from "./github";
import { parseProvisioningProfiles } from "./utils/provisioning-profiles";

const BUILDS_BASE_DIR = path.join(os.homedir(), "appcore", "builds");

export async function runBuildJob(
  appId: string,
  params: {
    repoUrl: string;
    accessToken: string;
    branch?: string;
    appName: string;
    bundleId: string;
    iosDir?: string;
    framework?: string;
    gymScheme?: string;
    exportMethod?: string;
    commitSha?: string;
  },
): Promise<void> {
  logger.info(`[build:${appId}] Starting binary build for ${params.bundleId}@${params.branch ?? "default"}`);

  const buildJob = await prisma.buildJob.create({
    data: {
      appId,
      branch: params.branch ?? null,
      commitSha: params.commitSha ?? null,
      status: "PENDING",
    },
  });

  const app = await prisma.app.findUnique({
    where: { id: appId },
    select: {
      signingCertP12: true,
      signingCertPassword: true,
      signingProvisioningProfile: true,
      signingProvisioningProfiles: true,
      signingTeamId: true,
      githubIosDir: true,
      githubFramework: true,
      githubRepoFullName: true,
      teamId: true,
    },
  });

  let versionString: string | undefined;
  if (app?.teamId) {
    try {
      const { ascClientForTeam } = await import("./asc-client");
      const asc = await ascClientForTeam(app.teamId);

      if (asc) {
        const ascApp = await asc.getApp(params.bundleId).catch(() => null);
        if (ascApp) {
          const editable = await asc.getEditableVersion(ascApp.id).catch(() => null);
          versionString = editable?.attributes.versionString ?? undefined;
          if (versionString) {
            logger.info(`[build:${appId}] Will set version to ${versionString} (from ASC editable version)`);
          }
        }
      }
    } catch (err) {
      logger.warn(`[build:${appId}] Could not fetch ASC version — version unchanged:`, err);
    }
  }

  const signingProfiles = parseProvisioningProfiles(app);
  const hasSigning = !!(app?.signingCertP12 && app?.signingCertPassword && signingProfiles.length > 0);
  if (!hasSigning) {
    logger.warn(
      `[build:${appId}] No signing credentials configured — binary build will likely fail at code-signing step`,
    );
  } else {
    logger.info(`[build:${appId}] Signing credentials found (teamId: ${app?.signingTeamId ?? "not set"})`);
  }

  await prisma.buildJob.update({
    where: { id: buildJob.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const repoFullName = app?.githubRepoFullName ?? null;
  if (params.commitSha && repoFullName) {
    await postCommitStatus(
      params.accessToken,
      repoFullName,
      params.commitSha,
      "pending",
      "marteso/build",
      "Binary build in progress…",
    );
  }

  try {
    const result = await workerClient.build({
      ...params,
      iosDir: params.iosDir ?? app?.githubIosDir ?? undefined,
      framework: params.framework ?? app?.githubFramework ?? undefined,
      versionString,
      ...(hasSigning &&
        app && {
          signingCertP12: app.signingCertP12 as string,
          signingCertPassword: app.signingCertPassword as string,
          signingProvisioningProfiles: signingProfiles,
          signingTeamId: app.signingTeamId ?? undefined,
        }),
    });

    for (const line of result.logs ?? []) {
      logger.info(`[build:${appId}] ${line}`);
    }
    for (const err of result.errors ?? []) {
      logger.error(`[build:${appId}] ERROR: ${err}`);
    }

    let ipaPath: string | null = null;

    if (result.ok && result.ipaBuilt && result.ipaBase64) {
      const buildsDir = path.join(BUILDS_BASE_DIR, params.bundleId);
      const historyDir = path.join(buildsDir, "history");
      await fs.promises.mkdir(historyDir, { recursive: true });

      const destIpa = path.join(buildsDir, "latest.ipa");
      const historyIpa = path.join(historyDir, `${Date.now()}.ipa`);
      const ipaBuffer = Buffer.from(result.ipaBase64, "base64");

      await fs.promises.writeFile(destIpa, ipaBuffer);
      await fs.promises.writeFile(historyIpa, ipaBuffer);

      if (result.appStoreInfoBase64) {
        await fs.promises.writeFile(
          path.join(buildsDir, "latest.appstoreinfo.plist"),
          Buffer.from(result.appStoreInfoBase64, "base64"),
        );
      }

      await fs.promises.writeFile(
        path.join(buildsDir, "latest.json"),
        JSON.stringify(
          {
            builtAt: new Date().toISOString(),
            originalFilename: result.originalFilename ?? "app.ipa",
            bundleId: params.bundleId,
            exportMethod: params.exportMethod ?? "app-store",
            sizeBytes: result.sizeBytes ?? ipaBuffer.length,
            version: versionString ?? null,
            buildNumber: result.buildNumber ?? null,
          },
          null,
          2,
        ),
      );

      ipaPath = destIpa;
      logger.info(
        `[build:${appId}] Binary saved to ${destIpa} (${((result.sizeBytes ?? ipaBuffer.length) / 1024 / 1024).toFixed(1)} MB)`,
      );
    } else {
      logger.warn(
        `[build:${appId}] Binary build did not produce an IPA (ok=${result.ok}, ipaBuilt=${result.ipaBuilt})`,
      );
    }

    const succeeded = result.ok && result.ipaBuilt;
    await prisma.buildJob.update({
      where: { id: buildJob.id },
      data: {
        status: succeeded ? "COMPLETED" : "FAILED",
        logs: JSON.stringify(result.logs ?? []),
        errors: JSON.stringify(result.errors ?? []),
        ipaPath,
        version: versionString ?? null,
        buildNumber: result.buildNumber ?? null,
        completedAt: new Date(),
      },
    });

    if (params.commitSha && repoFullName) {
      await postCommitStatus(
        params.accessToken,
        repoFullName,
        params.commitSha,
        succeeded ? "success" : "failure",
        "marteso/build",
        succeeded ? "Binary build succeeded" : (result.errors?.[0] ?? "Binary build failed").slice(0, 140),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[build:${appId}] Binary build error: ${msg}`);

    await prisma.buildJob.update({
      where: { id: buildJob.id },
      data: {
        status: "FAILED",
        errors: JSON.stringify([msg]),
        completedAt: new Date(),
      },
    });

    if (params.commitSha && repoFullName) {
      await postCommitStatus(
        params.accessToken,
        repoFullName,
        params.commitSha,
        "failure",
        "marteso/build",
        msg.slice(0, 140),
      );
    }
  }
}
