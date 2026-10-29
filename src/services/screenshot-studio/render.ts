import fs from "fs";
import path from "path";
import PQueue from "p-queue";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config";
import { workerClient } from "../worker-client";
import {
  matchDescriptionKey,
  normalizeStudioStyle,
  normalizeStudioTitle,
  resolveShotStyles,
  resolveStudioTitle,
  storedShotPatch,
  storedShotStyles,
  studioBasename,
  studioDeviceLabel,
  titleLinesForTitle,
  type StudioStyle,
} from "./style";
import { frameComplexBatch } from "./complex";
import {
  createStudioRevision,
  ensureStudioOriginal,
  getEffectiveFramed,
  listStudioPresets,
  listStudioRevisions,
  nextStudioRev,
  parseTitlesMap,
  type StudioPresetInfo,
  type StudioRevisionInfo,
} from "./revisions";
import { getStudioDraft, type StudioDraft } from "./drafts";

export interface StudioItem {
  basename: string;
  url: string;
  rawUrl: string | null;
  deviceLabel: string;
  descKey: string | null;
  title: string;
  hasRaw: boolean;
}

export interface StudioLocaleData {
  locale: string;
  items: StudioItem[];
}

export interface StudioData {
  job: {
    id: string;
    appId: string;
    commitSha: string;
    commitMessage: string | null;
    branch: string | null;
    createdAt: Date;
  };
  style: StudioStyle;
  styles: Record<string, Partial<StudioStyle>>;
  locales: StudioLocaleData[];
  revisions: StudioRevisionInfo[];
  activeRevisionId: string | null;
  defaultRevisionId: string | null;
  presets: StudioPresetInfo[];
  draft: StudioDraft | null;
}

export interface StudioSaveLocale {
  titles: Record<string, string>;
  styles?: Record<string, Partial<StudioStyle>>;
  titleLines?: Record<string, unknown>;
}

export interface StudioSaveResult {
  revision: StudioRevisionInfo;
  modes: { worker: number };
  skipped: string[];
  jobId: string;
}

export interface StudioProgressEvent {
  done: number;
  total: number;
  locale: string | null;
  basenames: string[];
}

interface PlannedImage {
  locale: string;
  basename: string;
  title: string;
  style: StudioStyle;
  outPath: string;
}

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function assertStudioSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_RE.test(value) || value.includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
}

export function assertStudioBasename(value: string): string {
  const base = path.basename(value);

  if (value !== base || !/\.png$/i.test(base) || base.includes("..")) {
    throw new Error("Invalid screenshot name");
  }

  return base;
}

export function pickStudioSourceLocale(targetLocale: string, sourceLocales: string[]): string | null {
  if (sourceLocales.includes(targetLocale)) return targetLocale;
  if (sourceLocales.includes("en-US")) return "en-US";
  if (sourceLocales.includes("en")) return "en";

  return sourceLocales.find((locale) => locale.toLowerCase().startsWith("en-")) ?? sourceLocales[0] ?? null;
}

export const STUDIO_RENDER_CHUNK_SIZE = 8;

export function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const chunkSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 1;
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return chunks;
}

export function groupPlannedByDevice<T extends { basename: string }>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const label = studioDeviceLabel(item.basename);
    const list = groups.get(label) ?? [];

    list.push(item);
    groups.set(label, list);
  }

  return [...groups.values()];
}

function studioJobDir(jobId: string): string {
  return path.join(process.cwd(), "screenshots", jobId);
}

async function studioRawLocales(jobId: string): Promise<string[]> {
  const entries = await fs.promises
    .readdir(path.join(studioJobDir(jobId), "raw"), { withFileTypes: true })
    .catch(() => []);

  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function studioRevisionTitles(
  jobId: string,
  revisionId: string | null,
): Promise<Record<string, Record<string, string>>> {
  if (!revisionId) return {};

  const revision = await prisma.screenshotRevision.findFirst({
    where: { id: revisionId, jobId },
    select: { titles: true },
  });

  return parseTitlesMap(revision?.titles);
}

async function studioRevisionStyles(
  jobId: string,
  revisionId: string | null,
): Promise<Record<string, Partial<StudioStyle>>> {
  if (!revisionId) return {};

  const revision = await prisma.screenshotRevision.findFirst({
    where: { id: revisionId, jobId },
    select: { styles: true },
  });

  if (!revision?.styles || typeof revision.styles !== "object" || Array.isArray(revision.styles)) return {};

  const out: Record<string, Partial<StudioStyle>> = {};

  for (const [base, patch] of Object.entries(revision.styles as Record<string, unknown>)) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;

    out[base] = patch as Partial<StudioStyle>;
  }

  return out;
}

async function studioRevisionStyle(jobId: string, revisionId: string | null): Promise<StudioStyle | null> {
  if (!revisionId) return null;

  const revision = await prisma.screenshotRevision.findFirst({
    where: { id: revisionId, jobId },
    select: { style: true },
  });

  if (!revision?.style || typeof revision.style !== "object" || Array.isArray(revision.style)) return null;

  return normalizeStudioStyle(revision.style);
}

function framedBasenames(framedByLocale: Record<string, string[]>): string[] {
  const out = new Set<string>();

  for (const urls of Object.values(framedByLocale)) {
    for (const url of urls) out.add(studioBasename(url));
  }

  return [...out];
}

function fallbackStudioShotStyles(
  jobShotStyles: unknown,
  appShotStyles: unknown,
  basenames: string[],
): Record<string, Partial<StudioStyle>> {
  const snapshot = storedShotStyles(jobShotStyles);

  if (Object.keys(snapshot).length > 0) return snapshot;

  return resolveShotStyles(storedShotStyles(appShotStyles), basenames);
}

export async function getStudioData(jobId: string): Promise<StudioData> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    include: {
      app: {
        select: {
          id: true,
          name: true,
          currentSubtitle: true,
          defaultScreenshotRevisionId: true,
          defaultScreenshotStyle: true,
          defaultScreenshotShotStyles: true,
          defaultScreenshotTitles: true,
        },
      },
    },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const effective = await getEffectiveFramed(jobId);
  const { revisions, activeRevisionId } = await listStudioRevisions(jobId);
  const presets = await listStudioPresets(job.appId);
  const revisionTitles = await studioRevisionTitles(jobId, effective.revisionId);
  const defaultTitles = parseTitlesMap(job.app.defaultScreenshotTitles);
  const rawLocales = await studioRawLocales(jobId);

  const sublines = (job.screenshotSublines ?? {}) as Record<string, Record<string, string>>;
  const descriptions = (job.screenshotDescriptions ?? {}) as Record<string, string>;
  const fallbackTitle = job.app.currentSubtitle || job.app.name;
  const style =
    (await studioRevisionStyle(jobId, effective.revisionId)) ??
    normalizeStudioStyle(job.screenshotStyle ?? job.app.defaultScreenshotStyle);

  const styles = effective.revisionId
    ? await studioRevisionStyles(jobId, effective.revisionId)
    : fallbackStudioShotStyles(
        job.screenshotShotStyles,
        job.app.defaultScreenshotShotStyles,
        framedBasenames(effective.framedByLocale),
      );

  const locales = Object.entries(effective.framedByLocale)
    .sort(([a], [b]) => {
      if (a === "en-US") return -1;
      if (b === "en-US") return 1;

      return a.localeCompare(b);
    })
    .map(([locale, urls]) => {
      const sourceLocale = pickStudioSourceLocale(locale, rawLocales);

      const items = urls.map((url) => {
        const basename = studioBasename(url);
        const descKey = matchDescriptionKey(basename, descriptions);
        const hasRaw = sourceLocale
          ? fs.existsSync(path.join(studioJobDir(jobId), "raw", sourceLocale, basename))
          : false;

        const item: StudioItem = {
          basename,
          url,
          rawUrl: hasRaw && sourceLocale ? `/screenshots/${jobId}/raw/${sourceLocale}/${basename}` : null,
          deviceLabel: studioDeviceLabel(url),
          descKey,
          title:
            revisionTitles[locale]?.[basename] ??
            defaultTitles[locale]?.[basename] ??
            resolveStudioTitle({ basename, locale, sublines, descriptions, fallback: fallbackTitle }),
          hasRaw,
        };

        return item;
      });

      return { locale, items };
    });

  return {
    job: {
      id: job.id,
      appId: job.appId,
      commitSha: job.commitSha,
      commitMessage: job.commitMessage,
      branch: job.branch,
      createdAt: job.createdAt,
    },
    style,
    styles,
    locales,
    revisions,
    activeRevisionId,
    defaultRevisionId: job.app.defaultScreenshotRevisionId ?? null,
    presets,
    draft: await getStudioDraft(jobId),
  };
}

export async function renderStudioRevision(args: {
  jobId: string;
  name?: string;
  style: StudioStyle;
  locales: Record<string, StudioSaveLocale>;
  onProgress?: (event: StudioProgressEvent) => void;
  pusher?: string | null;
}): Promise<StudioSaveResult> {
  assertStudioSegment(args.jobId, "job");

  const job = await prisma.screenshotJob.findUnique({
    where: { id: args.jobId },
    include: { app: { select: { name: true, currentSubtitle: true, defaultScreenshotTitles: true } } },
  });

  if (!job) throw new Error(`Screenshot job ${args.jobId} not found`);

  const effective = await getEffectiveFramed(args.jobId);
  const revisionTitles = await studioRevisionTitles(args.jobId, effective.revisionId);
  const defaultTitles = parseTitlesMap(job.app.defaultScreenshotTitles);
  const globalStyle = normalizeStudioStyle(args.style);
  const rawLocales = await studioRawLocales(args.jobId);

  const sublines = (job.screenshotSublines ?? {}) as Record<string, Record<string, string>>;
  const descriptions = (job.screenshotDescriptions ?? {}) as Record<string, string>;
  const fallbackTitle = job.app.currentSubtitle || job.app.name;
  const requestedLocales = Object.keys(args.locales ?? {});

  if (requestedLocales.length === 0) throw new Error("Select at least one locale");

  const planned: PlannedImage[] = [];
  const skipped: string[] = [];
  const titlesOut: Record<string, Record<string, string>> = { ...revisionTitles };
  const stylesOut: Record<string, Partial<StudioStyle>> = {};

  for (const locale of requestedLocales) {
    assertStudioSegment(locale, "locale");

    const current = effective.framedByLocale[locale];

    if (!current) throw new Error(`Locale ${locale} has no screenshots in this run`);

    const save = args.locales[locale];
    const localeTitles: Record<string, string> = {};
    const sourceLocale = pickStudioSourceLocale(locale, rawLocales);

    for (const url of current) {
      const basename = assertStudioBasename(studioBasename(url));
      const currentTitle =
        revisionTitles[locale]?.[basename] ??
        defaultTitles[locale]?.[basename] ??
        resolveStudioTitle({ basename, locale, sublines, descriptions, fallback: fallbackTitle });

      const title = normalizeStudioTitle(save.titles[basename] ?? currentTitle);
      const style = normalizeStudioStyle({ ...globalStyle, ...save.styles?.[basename] });

      style.titleLines = titleLinesForTitle(save.titleLines?.[basename] ?? style.titleLines, title);
      const hasRaw = sourceLocale
        ? fs.existsSync(path.join(studioJobDir(args.jobId), "raw", sourceLocale, basename))
        : false;

      localeTitles[basename] = title;

      if (!hasRaw) {
        skipped.push(`${locale}/${basename}`);
        continue;
      }

      planned.push({ locale, basename, title, style, outPath: "" });
    }

    titlesOut[locale] = localeTitles;

    for (const [base, patch] of Object.entries(save.styles ?? {})) {
      const clean = storedShotPatch(patch);

      if (!clean) {
        delete stylesOut[base];
        continue;
      }

      stylesOut[base] = clean;
    }
  }

  if (planned.length === 0) throw new Error("No editable sources stored for these locales");

  await ensureStudioOriginal(args.jobId);

  const rev = await nextStudioRev(args.jobId);
  const revDir = path.join(studioJobDir(args.jobId), "studio", `rev${rev}`);

  for (const item of planned) {
    item.outPath = path.join(revDir, item.locale, item.basename);
  }

  const totalPlanned = planned.length;
  let donePlanned = 0;

  args.onProgress?.({ done: 0, total: totalPlanned, locale: null, basenames: [] });

  const queue = new PQueue({ concurrency: workerClient.frameitSlotCount() });
  const tasks: Array<Promise<void>> = [];

  for (const locale of requestedLocales) {
    const localePlanned = planned.filter((item) => item.locale === locale);

    if (localePlanned.length === 0) continue;

    const sourceLocale = pickStudioSourceLocale(locale, rawLocales);

    if (!sourceLocale) throw new Error(`No source screenshots stored for ${locale}`);

    for (const chunk of groupPlannedByDevice(localePlanned)) {
      const titles = new Map(chunk.map((item) => [item.basename.replace(/\.[^.]+$/, ""), item.title]));
      const basenames = chunk.map((item) => item.basename);

      tasks.push(
        queue.add(async () => {
          args.onProgress?.({ done: donePlanned, total: totalPlanned, locale, basenames });

          await frameComplexBatch({
            srcDir: path.join(studioJobDir(args.jobId), "raw", sourceLocale),
            outDir: path.join(revDir, locale),
            shots: chunk.map((item) => ({
              filename: item.basename,
              base: item.basename.replace(/\.[^.]+$/, ""),
              style: item.style,
            })),
            titles,
            style: globalStyle,
          });

          donePlanned += chunk.length;
          args.onProgress?.({ done: donePlanned, total: totalPlanned, locale, basenames: [] });
        }),
      );
    }
  }

  try {
    await Promise.all(tasks);
  } catch (err) {
    queue.clear();
    throw err;
  }

  const framedByLocale = { ...effective.framedByLocale };
  const skippedSet = new Set(skipped);

  for (const locale of requestedLocales) {
    const current = effective.framedByLocale[locale] ?? [];

    framedByLocale[locale] = current.map((url) => {
      if (skippedSet.has(`${locale}/${studioBasename(url)}`)) return url;

      return `/screenshots/${args.jobId}/studio/rev${rev}/${locale}/${studioBasename(url)}`;
    });
  }

  const storedGlobalStyle = { ...globalStyle, titleLines: [] };

  const revision = await createStudioRevision({
    jobId: args.jobId,
    rev,
    name: args.name,
    framedByLocale,
    style: storedGlobalStyle,
    titles: titlesOut,
    styles: stylesOut,
  });

  const logLines = [
    `Studio revision rev${revision.rev} saved from job ${args.jobId}`,
    `Framed ${planned.length} screenshots for ${requestedLocales.join(", ")} via worker`,
  ];

  if (skipped.length > 0) {
    logLines.push(`Skipped ${skipped.length}: ${skipped.join(", ")}`);
  }

  await prisma.screenshotJob.update({
    where: { id: args.jobId },
    data: { logs: JSON.stringify(logLines) },
  });

  return { revision, modes: { worker: planned.length }, skipped, jobId: args.jobId };
}

export async function duplicateStudioJob(jobId: string, pusher?: string | null): Promise<{ jobId: string }> {
  assertStudioSegment(jobId, "job");

  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    include: { app: { select: { defaultScreenshotStyle: true, defaultScreenshotShotStyles: true } } },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const effective = await getEffectiveFramed(jobId);
  const style =
    (await studioRevisionStyle(jobId, effective.revisionId)) ??
    normalizeStudioStyle(job.screenshotStyle ?? job.app.defaultScreenshotStyle);

  const titles = await studioRevisionTitles(jobId, effective.revisionId);
  const styles = effective.revisionId
    ? await studioRevisionStyles(jobId, effective.revisionId)
    : fallbackStudioShotStyles(
        job.screenshotShotStyles,
        job.app.defaultScreenshotShotStyles,
        framedBasenames(effective.framedByLocale),
      );

  const duplicate = await prisma.screenshotJob.create({
    data: {
      appId: job.appId,
      commitSha: `duplicate-of-${jobId}`,
      commitMessage: `Duplicate of ${job.commitMessage || job.commitSha.slice(0, 7)}`,
      branch: "studio",
      pusher: pusher ?? null,
      status: "COMPLETED",
      screenshotUrls: [],
      framedByLocale: effective.framedByLocale as Prisma.InputJsonValue,
      screenshotStyle: style as Prisma.InputJsonValue,
      screenshotSublines: (job.screenshotSublines ?? {}) as Prisma.InputJsonValue,
      screenshotDescriptions: (job.screenshotDescriptions ?? {}) as Prisma.InputJsonValue,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  await createStudioRevision({
    jobId: duplicate.id,
    rev: 0,
    framedByLocale: effective.framedByLocale,
    style,
    titles,
    styles,
  });

  fs.cpSync(path.join(studioJobDir(jobId), "raw"), path.join(studioJobDir(duplicate.id), "raw"), {
    recursive: true,
  });

  return { jobId: duplicate.id };
}
