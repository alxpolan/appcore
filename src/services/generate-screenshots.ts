import path from "path";
import fs from "fs";
import { logger, prisma, getTeamSettings } from "../config";
import { decryptNullable } from "../config/encryption";
import { frameWithFastlane } from "./frame-screenshots";
import { workerClient, type WorkerSnapshotResult } from "./worker-client";
import { postCommitStatus } from "./github";
import { generateScreenshotSublines, type ScreenshotSublines } from "./screenshot-subline-generator";
import { AppStoreConnectClient } from "./appstore-connect";
import { Prisma } from "@prisma/client";
import { createJobLogEmitter } from "./log-bus";
import { normalizeLocale } from "./utils/country_lang";
import { env } from "../config/env";

const GITHUB_STATUS_DESC_MAX_LEN = 140;
const FRAME_LOCALE_CONCURRENCY = 4;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-. ]+$/;

const EDITABLE_VERSION_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "WAITING_FOR_EXPORT_COMPLIANCE",
  "PENDING_DEVELOPER_RELEASE",
  "IN_REVIEW",
]);

type ScreenshotJobWithApp = Prisma.ScreenshotJobGetPayload<{ include: { app: true } }>;

type VersionLocale = {
  locale: string;
  name?: string;
  subtitle?: string;
  keywords?: string;
};

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

    // Split the run across idle workers: each part clones+builds itself but only
    // captures its share of languages, so wall-clock shrinks with worker count.
    const parts = Math.max(1, workerClient.freeSlotCount());
    let result: WorkerSnapshotResult;
    if (parts === 1) {
      result = await workerClient.snapshot(snapshotParams, log);
    } else {
      log(`[capture] Splitting run across ${parts} workers (languages dealt round-robin)`);
      // allSettled: one dead worker must not discard the surviving part's screenshots.
      const settled = await Promise.allSettled(
        Array.from({ length: parts }, (_, i) =>
          workerClient.snapshot({ ...snapshotParams, splitIndex: i, splitCount: parts }, (line) =>
            log(`[part ${i + 1}/${parts}] ${line}`),
          ),
        ),
      );
      const partials = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
      settled.forEach((s, i) => {
        if (s.status === "rejected") {
          log(`[capture] Part ${i + 1}/${parts} failed: ${s.reason instanceof Error ? s.reason.message : s.reason}`);
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

function compareVersionStrings(a: string, b: string): number {
  const aParts = a
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number);
  const bParts = b
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number);
  const len = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < len; i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return a.localeCompare(b);
}

// Language-split parts capture disjoint locales, so screenshots merge without
// collisions; descriptions/config are identical per part - keep the fullest one.
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

function uniqueValidLocales(locales: VersionLocale[]): VersionLocale[] {
  const seen = new Set<string>();
  const result: VersionLocale[] = [];

  for (const loc of locales) {
    const normalizedLoc = normalizeLocale(loc.locale);
    if (!normalizedLoc || seen.has(normalizedLoc)) continue;
    seen.add(normalizedLoc);
    result.push({ ...loc, locale: normalizedLoc });
  }

  return result;
}

async function resolveLatestVersionLocales(
  job: ScreenshotJobWithApp,
  log: (msg: string) => void,
): Promise<VersionLocale[]> {
  const versions = await prisma.appStoreVersion.findMany({
    where: { bundleId: job.app.bundleId },
    include: { localizations: true },
  });

  const ranked = versions
    .filter((v) => v.localizations.length > 0)
    .sort((a, b) => {
      const versionDiff = compareVersionStrings(b.versionString, a.versionString);
      if (versionDiff !== 0) return versionDiff;

      const stateDiff =
        Number(EDITABLE_VERSION_STATES.has(b.appStoreState)) - Number(EDITABLE_VERSION_STATES.has(a.appStoreState));
      if (stateDiff !== 0) return stateDiff;

      return b.syncedAt.getTime() - a.syncedAt.getTime();
    });

  const cached = ranked[0];
  if (cached) {
    const locales = uniqueValidLocales(
      cached.localizations.map((loc) => ({
        locale: loc.locale,
        name: loc.name,
        subtitle: loc.subtitle,
        keywords: loc.keywords,
      })),
    );

    log(`[framing] Using ${locales.length} locale(s) from App Store version ${cached.versionString}`);
    return locales;
  }

  if (!job.app.teamId || !job.app.trackId) {
    log("[framing] No cached App Store version locales found - using captured screenshot locales");
    return [];
  }

  const teamSettings = await getTeamSettings(job.app.teamId);
  const privateKey = decryptNullable(teamSettings?.ascPrivateKey);

  if (!teamSettings?.ascIssuerId || !teamSettings.ascKeyId || !privateKey) {
    log("[framing] No ASC credentials available for version locale refresh - using captured screenshot locales");
    return [];
  }

  try {
    const asc = new AppStoreConnectClient(
      { issuerId: teamSettings.ascIssuerId, keyId: teamSettings.ascKeyId, privateKey },
      { teamId: job.app.teamId },
    );
    const ascAppId = String(job.app.trackId);
    const versionsFromAsc = await asc.listVersions(ascAppId);
    const latestVersion = versionsFromAsc.sort((a, b) =>
      compareVersionStrings(b.attributes.versionString, a.attributes.versionString),
    )[0];

    if (!latestVersion) {
      log("[framing] ASC returned no versions - using captured screenshot locales");
      return [];
    }

    const [versionLocalizations, appInfoLocalizations] = await Promise.all([
      asc.getVersionLocalizations(latestVersion.id),
      asc.getAppInfoLocalizations(ascAppId).catch(() => []),
    ]);

    const appInfoByLocale = new Map<string, (typeof appInfoLocalizations)[number]>();
    for (const loc of appInfoLocalizations) {
      appInfoByLocale.set(loc.attributes.locale, loc);
    }

    const locales = uniqueValidLocales(
      versionLocalizations.map((loc) => {
        const appInfo = appInfoByLocale.get(loc.attributes.locale);
        return {
          locale: loc.attributes.locale,
          name: appInfo?.attributes.name,
          subtitle: appInfo?.attributes.subtitle,
          keywords: loc.attributes.keywords,
        };
      }),
    );

    log(`[framing] Refreshed ${locales.length} locale(s) from ASC version ${latestVersion.attributes.versionString}`);
    return locales;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[framing] Could not refresh version locales from ASC - using captured screenshot locales: ${msg}`);
    return [];
  }
}

function pickSourceLocale(targetLocale: string, sourceLocales: string[]): string | null {
  if (sourceLocales.includes(targetLocale)) return targetLocale;
  if (sourceLocales.includes("en-US")) return "en-US";
  if (sourceLocales.includes("en")) return "en";

  return sourceLocales.find((locale) => locale.toLowerCase().startsWith("en-")) ?? sourceLocales[0] ?? null;
}

async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

async function frameScreenshots(
  jobId: string,
  job: ScreenshotJobWithApp,
  outputDir: string,
  descriptions: Record<string, string>,
  hasDescriptions: boolean,
  sublines: ScreenshotSublines,
  frameConfig: Record<string, string>,
  targetLocales: string[],
  versionLocales: Record<string, VersionLocale>,
  log: (msg: string) => void,
): Promise<void> {
  try {
    const framedByLocale: Record<string, string[]> = {};
    const rawEntries = await fs.promises.readdir(path.join(outputDir, "raw"), { withFileTypes: true }).catch(() => []);
    const sourceLocaleDirs = new Map(
      rawEntries.filter((e) => e.isDirectory()).map((e) => [e.name, path.join(outputDir, "raw", e.name)]),
    );

    log(`[framing] Framing locales with concurrency ${FRAME_LOCALE_CONCURRENCY}`);

    // runConcurrent runs the workers under Promise.all, so an unhandled throw would
    // abandon every locale still queued. One bad locale must not cost all the others.
    const failedLocales: string[] = [];

    await runConcurrent(targetLocales, FRAME_LOCALE_CONCURRENCY, async (locale) => {
      try {
        await frameLocale(locale);
      } catch (err) {
        failedLocales.push(locale);
        log(`[framing] ${locale}: failed - ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    async function frameLocale(locale: string): Promise<void> {
      const sourceLocale = pickSourceLocale(locale, [...sourceLocaleDirs.keys()]);
      if (!sourceLocale) {
        log(`[framing] ${locale}: no raw screenshots available`);
        return;
      }

      const srcDir = sourceLocaleDirs.get(sourceLocale);
      if (!srcDir) return;

      if (sourceLocale !== locale) {
        log(`[framing] ${locale}: using ${sourceLocale} screenshots with localized text`);
      }

      const versionLocale = versionLocales[locale];
      const localeSublines = sublines[locale] ?? sublines["en-US"] ?? {};
      const defaultSubtitle = versionLocale?.subtitle || versionLocale?.name || job.app.currentSubtitle || job.app.name;
      let outputPaths: string[];

      const bgOptions = {
        bgColor1: frameConfig.bgColor1,
        bgColor2: frameConfig.bgColor2,
        textColor: frameConfig.textColor,
      };

      // Passing the directory is what makes the worker run the second, background-less
      // frameit pass. Leaving it undefined halves the ImageMagick work per locale.
      const unframedDir = env.FRAME_INCLUDE_UNFRAMED ? path.join(outputDir, "unframed", locale) : undefined;

      if (!hasDescriptions) {
        outputPaths = await frameWithFastlane(
          srcDir,
          path.join(outputDir, "framed", locale),
          {
            subtitle: defaultSubtitle,
            ...bgOptions,
          },
          unframedDir,
        );
      } else {
        const allEntries = await fs.promises.readdir(srcDir);
        const files = allEntries.filter((f) => /\.(png)$/i.test(f));

        // One call for the whole locale: each screenshot carries its own subline via
        // `titles`, which costs one fastlane boot instead of one per image.
        const titles: Record<string, string> = {};
        for (const filename of files) {
          const base = filename.replace(/\.[^.]+$/, "");
          const descKey = Object.keys(descriptions).find((k) => base === k || base.startsWith(k + "_"));
          titles[base] = descKey ? (localeSublines[descKey] ?? defaultSubtitle) : defaultSubtitle;
        }

        outputPaths = await frameWithFastlane(
          srcDir,
          path.join(outputDir, "framed", locale),
          {
            subtitle: defaultSubtitle,
            ...bgOptions,
            titles,
          },
          unframedDir,
        );

        log(`[framing] ${locale}: ${files.length} image(s) → ${outputPaths.length} path(s)`);
      }

      const urls = outputPaths.map(
        (p) => "/screenshots/" + path.relative(path.join(process.cwd(), "screenshots"), p).replace(/\\/g, "/"),
      );
      framedByLocale[locale] = (framedByLocale[locale] ?? []).concat(urls);
    }

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: { framedByLocale: framedByLocale as Prisma.InputJsonValue },
    });

    log(`[framing] Framing complete: ${Object.values(framedByLocale).flat().length} image(s)`);
    if (failedLocales.length > 0) {
      log(`[framing] WARNING: ${failedLocales.length} locale(s) produced no frames: ${failedLocales.join(", ")}`);
    }
  } catch (frameErr) {
    const frameMsg = frameErr instanceof Error ? frameErr.message : String(frameErr);
    const stack = frameErr instanceof Error ? frameErr.stack : undefined;
    log(`[framing] Framing failed (non-fatal): ${frameMsg}`);

    // undici reports every transport failure as "fetch failed" and puts the actual
    // reason (UND_ERR_HEADERS_TIMEOUT, ECONNRESET, ...) in `cause`.
    for (let cause = (frameErr as { cause?: unknown })?.cause, depth = 1; cause && depth <= 3; depth++) {
      const causeErr = cause as Error & { code?: string };
      const code = causeErr.code ? ` [${causeErr.code}]` : "";
      log(`[framing] Cause ${depth}: ${causeErr.message ?? String(cause)}${code}`);
      cause = (cause as { cause?: unknown })?.cause;
    }

    if (stack) log(`[framing] Stack: ${stack.split("\n").slice(0, 4).join(" | ")}`);
  }
}
