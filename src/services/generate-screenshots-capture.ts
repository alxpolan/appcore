import path from "path";
import fs from "fs";
import { logger, prisma, getTeamSettings } from "../config";
import { decryptNullable } from "../config/encryption";
import { workerClient, type WorkerSnapshotResult } from "./worker-client";
import { postCommitStatus } from "./github";
import { generateScreenshotSublines, type ScreenshotSublines } from "./screenshot-subline-generator";
import { Prisma } from "@prisma/client";
import { createJobLogEmitter } from "./log-bus";
import { normalizeLocale } from "./utils/country_lang";
import type { ScreenshotJobWithApp } from "./generate-screenshots-types";
import { frameScreenshots, resolveLatestVersionLocales } from "./generate-screenshots-framing";

const GITHUB_STATUS_DESC_MAX_LEN = 140;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-. ]+$/;

export async function runScreenshotGeneration(jobId: string): Promise<void> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    include: { app: true },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const logs: string[] = [];
  const { emit: emitLog, finish: finishLog } = createJobLogEmitter(jobId);
  const log = (msg: string) => {
    logs.push(msg);
    emitLog(msg);
    logger.info(`[screenshots:${jobId}] ${msg}`);
  };

  await prisma.screenshotJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    await runWorkerScreenshotGeneration(jobId, job, path.join(process.cwd(), "screenshots", jobId), logs, log);
  } finally {
    finishLog();
  }
}

async function runWorkerScreenshotGeneration(
  jobId: string,
  job: ScreenshotJobWithApp,
  outputDir: string,
  logs: string[],
  log: (msg: string) => void,
): Promise<void> {
  let token: string | undefined;
  let repoFullName: string | undefined;

  try {
    if (!job.app.teamId) {
      throw new Error("App has no team");
    }

    const teamSettings = await getTeamSettings(job.app.teamId);

    if (!teamSettings?.githubAccessToken) {
      throw new Error("No GitHub access token available");
    }

    if (!job.app.githubRepoFullName) {
      throw new Error("No GitHub repo linked to this app");
    }

    const decrypted = decryptNullable(teamSettings.githubAccessToken);
    if (!decrypted) throw new Error("Failed to decrypt GitHub access token");
    token = decrypted;
    repoFullName = job.app.githubRepoFullName;

    if (job.commitSha) {
      await postCommitStatus(
        decrypted,
        job.app.githubRepoFullName,
        job.commitSha,
        "pending",
        "marteso/screenshots",
        "Screenshot generation in progress…",
      );
    }

    for (const line of [
      "███╗   ███╗ █████╗ ██████╗ ████████╗███████╗███████╗ ██████╗ ",
      "████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██╔════╝██╔════╝██╔═══██╗",
      "██╔████╔██║███████║██████╔╝   ██║   █████╗  ███████╗██║   ██║",
      "██║╚██╔╝██║██╔══██║██╔══██╗   ██║   ██╔══╝  ╚════██║██║   ██║",
      "██║ ╚═╝ ██║██║  ██║██║  ██║   ██║   ███████╗███████║╚██████╔╝",
      "╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚══════╝ ╚═════╝ ",
    ])
      log(line);
    log("Delegating screenshot generation to worker...");

    let envVars: Record<string, string> | undefined;

    if (job.app.snapshotEnvVars) {
      try {
        const decryptedVars = decryptNullable(job.app.snapshotEnvVars);
        if (!decryptedVars) throw new Error("Failed to decrypt snapshotEnvVars");

        const parsed = JSON.parse(decryptedVars) as Array<{ key: string; value: string }>;

        envVars = Object.fromEntries(parsed.map(({ key, value }) => [key, value]));
        log(`[config] Loaded ${parsed.length} UI test environment variable(s)`);
      } catch {
        log("[config] Warning: could not parse snapshotEnvVars - skipping");
      }
    } else {
      log(
        "[config] Warning: no UI test environment variables configured for this app - if your tests require login, add EMAIL/PASSWORD under App Settings → UI Test Environment",
      );
    }

    const snapshotParams = {
      repoUrl: `https://github.com/${repoFullName}.git`,
      accessToken: token,
      branch: job.branch ?? undefined,
      appName: job.app.name,
      bundleId: job.app.bundleId,
      iosDir: job.app.githubIosDir ?? undefined,
      framework: job.app.githubFramework ?? undefined,
      envVars,
    };

    const parts = Math.max(1, workerClient.freeSlotCount());
    let result: WorkerSnapshotResult;

    if (parts === 1) {
      result = await workerClient.snapshot(snapshotParams, log);
    } else {
      log(`[capture] Splitting run across ${parts} workers (languages dealt round-robin)`);
      const settled = await Promise.allSettled(
        Array.from({ length: parts }, (_, i) =>
          workerClient.snapshot({ ...snapshotParams, splitIndex: i, splitCount: parts }, (line) =>
            log(`[${workerClient.slotLabel(i)}] ${line}`),
          ),
        ),
      );

      const partials = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
      settled.forEach((s, i) => {
        if (s.status === "rejected") {
          log(
            `[capture] ${workerClient.slotLabel(i)} failed: ${s.reason instanceof Error ? s.reason.message : s.reason}`,
          );
        }
      });

      if (partials.length === 0) {
        throw settled[0].status === "rejected" ? settled[0].reason : new Error("All snapshot parts failed");
      }

      result = mergeSnapshotResults(partials);
    }

    if (!result.ok) {
      throw new Error(`Worker snapshot failed: ${result.errors.join("; ")}`);
    }

    const screenshotUrls: string[] = [];
    const detectedLocales: string[] = [];

    for (const [locale, images] of Object.entries(result.screenshots)) {
      const normalizedLoc = normalizeLocale(locale);

      if (!normalizedLoc) {
        log(`[capture] Skipping invalid locale: ${locale}`);
        continue;
      }

      await fs.promises.mkdir(path.join(outputDir, "raw", normalizedLoc), { recursive: true });

      for (const img of images) {
        const safeFilename = safeSnapshotFilename(img.filename);

        if (!safeFilename) {
          log(`[capture] Skipping suspicious filename: ${img.filename}`);
          continue;
        }

        await fs.promises.writeFile(
          path.join(outputDir, "raw", normalizedLoc, safeFilename),
          Buffer.from(img.data, "base64"),
        );
        screenshotUrls.push(`/screenshots/${jobId}/raw/${normalizedLoc}/${safeFilename}`);
      }

      detectedLocales.push(normalizedLoc);
    }

    log(
      `[capture] Saved ${screenshotUrls.length} screenshot${screenshotUrls.length === 1 ? "" : "s"} from worker: ${screenshotUrls.join(", ")} (outputDir=${outputDir})`,
    );

    if (result.xcresultLogs && result.xcresultLogs.length > 0) {
      await fs.promises.mkdir(path.join(outputDir, "logs"), { recursive: true });
      let saved = 0;

      for (const archive of result.xcresultLogs) {
        const safeFilename = safeSnapshotFilename(archive.filename);

        if (!safeFilename) {
          log(`[capture] Skipping suspicious xcresult filename: ${archive.filename}`);
          continue;
        }

        if (!archive.data) {
          log(`[capture] Skipping xcresult ${safeFilename}: no data (download failed)`);
          continue;
        }

        await fs.promises.writeFile(path.join(outputDir, "logs", safeFilename), Buffer.from(archive.data, "base64"));
        saved += 1;
      }

      log(`[capture] Saved ${saved} xcresult archive(s)`);
    }

    const descriptions = result.descriptions ?? {};
    const frameConfig = result.config ?? {};
    const filenameKeys = [
      ...new Set(
        Object.values(result.screenshots)
          .flat()
          .map(({ filename }) => {
            const base =
              filename.replace(/\.[^.]+$/, "").match(/^(.+?)(?:_[a-z]{2}(?:-[A-Z]{2})?_)/)?.[1] ??
              filename.replace(/\.[^.]+$/, "");

            return Object.keys(descriptions).find((k) => base === k || base.startsWith(k + "_")) ?? base;
          }),
      ),
    ];

    const effectiveDescriptions: Record<string, string> = { ...descriptions };

    for (const key of filenameKeys) {
      if (!effectiveDescriptions[key]) effectiveDescriptions[key] = key.replace(/_/g, " ");
    }

    const hasDescriptions = Object.keys(effectiveDescriptions).length > 0;
    let sublines: ScreenshotSublines = {};

    const targetVersionLocales = await resolveLatestVersionLocales(job, log);
    const targetLocales =
      targetVersionLocales.length > 0
        ? targetVersionLocales.map((loc) => loc.locale)
        : detectedLocales.length > 0
          ? detectedLocales
          : ["en-US"];

    const versionLocaleMap = Object.fromEntries(targetVersionLocales.map((loc) => [loc.locale, loc]));

    log(`[framing] Target locales: ${targetLocales.join(", ")}`);

    if (hasDescriptions && screenshotUrls.length > 0) {
      log(
        `[framing] Generating AI sublines for ${Object.keys(effectiveDescriptions).length} screen${Object.keys(effectiveDescriptions).length === 1 ? "" : "s"}...`,
      );
      try {
        sublines = await generateScreenshotSublines(
          job.appId,
          effectiveDescriptions,
          targetLocales,
          targetVersionLocales,
        );
        log(
          `[framing] AI sublines generated for ${Object.keys(sublines).length} locale${Object.keys(sublines).length === 1 ? "" : "s"}`,
        );
      } catch (sublineErr) {
        const sublineMsg = sublineErr instanceof Error ? sublineErr.message : String(sublineErr);

        log(`[framing] Subline generation failed (non-fatal): ${sublineMsg}`);
      }
    }

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: {
        screenshotUrls,
        ...(hasDescriptions && {
          screenshotDescriptions: effectiveDescriptions as Prisma.InputJsonValue,
          screenshotSublines: sublines as Prisma.InputJsonValue,
        }),
      },
    });

    await frameScreenshots(
      jobId,
      job,
      outputDir,
      effectiveDescriptions,
      hasDescriptions,
      sublines,
      frameConfig,
      targetLocales,
      versionLocaleMap,
      log,
    );

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        logs: JSON.stringify(logs),
      },
    });

    if (job.commitSha && token && repoFullName) {
      await postCommitStatus(
        token,
        repoFullName,
        job.commitSha,
        "success",
        "marteso/screenshots",
        "Screenshots generated successfully",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    log(`ERROR: ${msg}`);

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error: msg,
        completedAt: new Date(),
        logs: JSON.stringify(logs),
      },
    });

    if (job.commitSha && token && repoFullName) {
      await postCommitStatus(
        token,
        repoFullName,
        job.commitSha,
        "failure",
        "marteso/screenshots",
        msg.slice(0, GITHUB_STATUS_DESC_MAX_LEN),
      );
    }
  }
}

function safeSnapshotFilename(filename: string): string | null {
  const basename = path.basename(filename);

  return basename && SAFE_FILENAME_RE.test(basename) ? basename : null;
}

function mergeSnapshotResults(parts: WorkerSnapshotResult[]): WorkerSnapshotResult {
  const merged: WorkerSnapshotResult = {
    ok: parts.every((p) => p.ok),
    logs: parts.flatMap((p) => p.logs ?? []),
    errors: parts.flatMap((p) => p.errors ?? []),
    screenshots: {},
    descriptions: {},
    config: {},
    xcresultLogs: parts.flatMap((p) => p.xcresultLogs ?? []),
    ipaBuilt: parts.some((p) => p.ipaBuilt),
    ipaPath: parts.find((p) => p.ipaPath)?.ipaPath,
  };

  for (const p of parts) {
    for (const [locale, imgs] of Object.entries(p.screenshots ?? {})) {
      merged.screenshots[locale] = (merged.screenshots[locale] ?? []).concat(imgs);
    }

    if (Object.keys(p.descriptions ?? {}).length > Object.keys(merged.descriptions).length) {
      merged.descriptions = p.descriptions;
    }

    if (Object.keys(p.config ?? {}).length > Object.keys(merged.config).length) {
      merged.config = p.config;
    }
  }

  return merged;
}
