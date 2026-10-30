import path from "path";
import fs from "fs";
import { prisma } from "../config";
import { frameComplexBatch, matchShotStyle, normalizeStudioStyle, storedShotStyles, type StudioStyle } from "./screenshot-studio";
import { ascClientForTeam } from "./asc-client";
import { Prisma } from "@prisma/client";
import { normalizeLocale } from "./utils/country_lang";
import type { ScreenshotSublines } from "./screenshot-subline-generator";
import type { ScreenshotJobWithApp, VersionLocale } from "./generate-screenshots-types";

const FRAME_LOCALE_CONCURRENCY = 4;

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

export async function resolveLatestVersionLocales(
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

  const asc = await ascClientForTeam(job.app.teamId);

  if (!asc) {
    log("[framing] No ASC credentials available for version locale refresh - using captured screenshot locales");

    return [];
  }

  try {
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

export interface FrameScreenshotsProgress {
  done: number;
  total: number;
  locale: string | null;
}

export function screenshotFrameStyle(
  frameConfig: Record<string, string>,
  defaultStyle: unknown,
): { style: StudioStyle; usedPinnedDefault: boolean } {
  const pinnedDefault =
    defaultStyle && typeof defaultStyle === "object" ? normalizeStudioStyle(defaultStyle) : null;

  if (pinnedDefault) {
    pinnedDefault.titleLines = [];
  }

  const style = normalizeStudioStyle({
    bgColor1: frameConfig.bgColor1,
    bgColor2: frameConfig.bgColor2,
    textColor: frameConfig.textColor,
    textPosition: frameConfig.textPosition,
    ...(pinnedDefault ?? {}),
  });

  return { style, usedPinnedDefault: pinnedDefault != null };
}

export async function frameScreenshots(
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
  onProgress?: (event: FrameScreenshotsProgress) => void,
): Promise<void> {
  try {
    const framedByLocale: Record<string, string[]> = {};
    const rawEntries = await fs.promises.readdir(path.join(outputDir, "raw"), { withFileTypes: true }).catch(() => []);
    const sourceLocaleDirs = new Map(
      rawEntries.filter((e) => e.isDirectory()).map((e) => [e.name, path.join(outputDir, "raw", e.name)]),
    );

    log(`[framing] Framing locales with concurrency ${FRAME_LOCALE_CONCURRENCY}`);

    const failedLocales: string[] = [];

    const shotDefaults = storedShotStyles(job.app.defaultScreenshotShotStyles);
    const usedShotStyles: Record<string, Partial<StudioStyle>> = {};
    const frameStyle = screenshotFrameStyle(frameConfig, job.app.defaultScreenshotStyle);

    if (frameStyle.usedPinnedDefault) log("[framing] Using pinned Studio default style");

    const style = frameStyle.style;

    let framedCount = 0;
    let plannedCount = 0;

    for (const locale of targetLocales) {
      const sourceLocale = pickSourceLocale(locale, [...sourceLocaleDirs.keys()]);
      const srcDir = sourceLocale ? sourceLocaleDirs.get(sourceLocale) : undefined;

      if (!srcDir) continue;

      const entries = await fs.promises.readdir(srcDir).catch(() => [] as string[]);

      plannedCount += entries.filter((entry) => /\.png$/i.test(entry)).length;
    }

    onProgress?.({ done: 0, total: plannedCount, locale: null });

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

      const entries = await fs.promises.readdir(srcDir);
      const shots = entries
        .filter((f) => /\.(png)$/i.test(f))
        .map((filename) => {
          const patch = matchShotStyle(shotDefaults, filename);
          const shotStyle = patch ? normalizeStudioStyle({ ...style, ...patch }) : style;

          if (patch) usedShotStyles[filename] = patch;

          return { filename, base: filename.replace(/\.[^.]+$/, ""), style: shotStyle };
        })
        .sort((a, b) => a.base.localeCompare(b.base));

      const titles = new Map<string, string>();

      for (const shot of shots) {
        const descKey = hasDescriptions
          ? Object.keys(descriptions).find((k) => shot.base === k || shot.base.startsWith(k + "_"))
          : undefined;

        titles.set(shot.base, descKey ? (localeSublines[descKey] ?? defaultSubtitle) : defaultSubtitle);
      }

      const framedDir = path.join(outputDir, "framed", locale);

      await frameComplexBatch({ srcDir, outDir: framedDir, shots, titles, style, log });

      framedCount += shots.length;
      onProgress?.({ done: framedCount, total: plannedCount, locale });

      const urls = shots.map((shot) => `/screenshots/${jobId}/framed/${locale}/${shot.base}.png`);

      framedByLocale[locale] = (framedByLocale[locale] ?? []).concat(urls);

      log(`[framing] ${locale}: ${shots.length} image(s) → ${urls.length} path(s)`);
    }

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: {
        framedByLocale: framedByLocale as Prisma.InputJsonValue,
        screenshotStyle: style as Prisma.InputJsonValue,
        screenshotShotStyles: usedShotStyles as Prisma.InputJsonValue,
      },
    });

    log(`[framing] Framing complete: ${Object.values(framedByLocale).flat().length} image(s)`);

    if (failedLocales.length > 0) {
      log(`[framing] WARNING: ${failedLocales.length} locale(s) produced no frames: ${failedLocales.join(", ")}`);
    }
  } catch (frameErr) {
    const frameMsg = frameErr instanceof Error ? frameErr.message : String(frameErr);
    const stack = frameErr instanceof Error ? frameErr.stack : undefined;

    log(`[framing] Framing failed (non-fatal): ${frameMsg}`);

    for (let cause = (frameErr as { cause?: unknown })?.cause, depth = 1; cause && depth <= 3; depth++) {
      const causeErr = cause as Error & { code?: string };
      const code = causeErr.code ? ` [${causeErr.code}]` : "";

      log(`[framing] Cause ${depth}: ${causeErr.message ?? String(cause)}${code}`);
      cause = (cause as { cause?: unknown })?.cause;
    }

    if (stack) log(`[framing] Stack: ${stack.split("\n").slice(0, 4).join(" | ")}`);
  }
}
