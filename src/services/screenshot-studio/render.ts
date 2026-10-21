import fs from "fs";
import path from "path";
import PQueue from "p-queue";
import { prisma } from "../../config";
import { workerClient } from "../worker-client";
import {
  DEFAULT_STUDIO_GEOMETRY,
  matchDescriptionKey,
  normalizeStudioStyle,
  normalizeStudioTitle,
  resolveStudioTitle,
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
  type StudioPresetInfo,
  type StudioRevisionInfo,
} from "./revisions";

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
  presets: StudioPresetInfo[];
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

function studioJobDir(jobId: string): string {
  return path.join(process.cwd(), "screenshots", jobId);
}

function storedShotPatch(patch: unknown): Partial<StudioStyle> | null {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;

  const rest = { ...(patch as Partial<StudioStyle>) };
  delete rest.titleLines;

  if (JSON.stringify({ ...DEFAULT_STUDIO_GEOMETRY, ...rest }) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
    return null;
  }

  return rest;
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

  if (!revision?.titles || typeof revision.titles !== "object" || Array.isArray(revision.titles)) return {};

  const out: Record<string, Record<string, string>> = {};

  for (const [locale, titles] of Object.entries(revision.titles as Record<string, unknown>)) {
    if (!titles || typeof titles !== "object" || Array.isArray(titles)) continue;

    const localeTitles: Record<string, string> = {};

    for (const [base, title] of Object.entries(titles as Record<string, unknown>)) {
      if (typeof title === "string") localeTitles[base] = title;
    }

    out[locale] = localeTitles;
  }

  return out;
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

export async function getStudioData(jobId: string): Promise<StudioData> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    include: { app: { select: { id: true, name: true, currentSubtitle: true } } },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const effective = await getEffectiveFramed(jobId);
  const { revisions, activeRevisionId } = await listStudioRevisions(jobId);
  const presets = await listStudioPresets(job.appId);
  const revisionTitles = await studioRevisionTitles(jobId, effective.revisionId);
  const rawLocales = await studioRawLocales(jobId);

  const sublines = (job.screenshotSublines ?? {}) as Record<string, Record<string, string>>;
  const descriptions = (job.screenshotDescriptions ?? {}) as Record<string, string>;
  const fallbackTitle = job.app.currentSubtitle || job.app.name;
  const style =
    (await studioRevisionStyle(jobId, effective.revisionId)) ?? normalizeStudioStyle(job.screenshotStyle);

  const styles = await studioRevisionStyles(jobId, effective.revisionId);

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
    presets,
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

  const startedAt = new Date();
  const job = await prisma.screenshotJob.findUnique({
    where: { id: args.jobId },
    include: { app: { select: { name: true, currentSubtitle: true } } },
  });

  if (!job) throw new Error(`Screenshot job ${args.jobId} not found`);

  const effective = await getEffectiveFramed(args.jobId);
  const revisionTitles = await studioRevisionTitles(args.jobId, effective.revisionId);
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

    for (const chunk of splitIntoChunks(localePlanned, STUDIO_RENDER_CHUNK_SIZE)) {
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

  const studioJob = await prisma.screenshotJob.create({
    data: {
      appId: job.appId,
      commitSha: `studio-rev${revision.rev}`,
      commitMessage: args.name ? `Studio rev${revision.rev} — ${args.name}` : `Studio rev${revision.rev}`,
      branch: "studio",
      pusher: args.pusher ?? null,
      status: "COMPLETED",
      screenshotUrls: [],
      framedByLocale: framedByLocale as Prisma.InputJsonValue,
      screenshotStyle: storedGlobalStyle as Prisma.InputJsonValue,
      screenshotSublines: (job.screenshotSublines ?? {}) as Prisma.InputJsonValue,
      screenshotDescriptions: (job.screenshotDescriptions ?? {}) as Prisma.InputJsonValue,
      logs: JSON.stringify(logLines),
      startedAt,
      completedAt: new Date(),
    },
  });

  fs.cpSync(path.join(studioJobDir(args.jobId), "raw"), path.join(studioJobDir(studioJob.id), "raw"), {
    recursive: true,
  });

  return { revision, modes: { worker: planned.length }, skipped, jobId: studioJob.id };
}
