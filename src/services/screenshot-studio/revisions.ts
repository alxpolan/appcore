import fs from "fs";
import path from "path";
import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import type { ScreenshotStylePreset } from "@prisma/client";
import { normalizeStudioStyle, normalizeTitleLines, storedShotStyles, type StudioStyle } from "./style";

function parseStoredTitleLines(value: unknown): string[] {
  if (typeof value !== "string") return [];

  try {
    return normalizeTitleLines(JSON.parse(value));
  } catch {
    return [];
  }
}

export type FramedMap = Record<string, string[]>;

export interface StudioRevisionInfo {
  id: string;
  rev: number;
  name: string | null;
  createdAt: Date;
  isActive: boolean;
}

export interface EffectiveFramed {
  framedByLocale: FramedMap;
  revisionId: string | null;
  revision: StudioRevisionInfo | null;
}

export interface StudioPresetInfo extends StudioStyle {
  id: string;
  name: string;
  updatedAt: Date;
}

export function asFramedMap(value: unknown): FramedMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: FramedMap = {};

  for (const [locale, urls] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(urls)) out[locale] = urls.filter((u): u is string => typeof u === "string");
  }

  return out;
}

export function parseTitlesMap(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, Record<string, string>> = {};

  for (const [locale, titles] of Object.entries(value as Record<string, unknown>)) {
    if (!titles || typeof titles !== "object" || Array.isArray(titles)) continue;

    const localeTitles: Record<string, string> = {};

    for (const [base, title] of Object.entries(titles as Record<string, unknown>)) {
      if (typeof title === "string") localeTitles[base] = title;
    }

    out[locale] = localeTitles;
  }

  return out;
}

export async function getEffectiveFramed(jobId: string): Promise<EffectiveFramed> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    select: { framedByLocale: true, activeRevisionId: true },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  if (!job.activeRevisionId) {
    return { framedByLocale: asFramedMap(job.framedByLocale), revisionId: null, revision: null };
  }

  const revision = await prisma.screenshotRevision.findFirst({
    where: { id: job.activeRevisionId, jobId },
  });

  if (!revision) {
    return { framedByLocale: asFramedMap(job.framedByLocale), revisionId: null, revision: null };
  }

  return {
    framedByLocale: asFramedMap(revision.framedByLocale),
    revisionId: revision.id,
    revision: {
      id: revision.id,
      rev: revision.rev,
      name: revision.name,
      createdAt: revision.createdAt,
      isActive: true,
    },
  };
}

export async function writeEffectiveFramed(
  jobId: string,
  framedByLocale: FramedMap,
): Promise<{ revisionId: string | null }> {
  const current = await getEffectiveFramed(jobId);

  if (!current.revisionId) {
    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: { framedByLocale: framedByLocale as Prisma.InputJsonValue },
    });

    return { revisionId: null };
  }

  await prisma.screenshotRevision.update({
    where: { id: current.revisionId },
    data: { framedByLocale: framedByLocale as Prisma.InputJsonValue },
  });

  return { revisionId: current.revisionId };
}

export async function listStudioRevisions(
  jobId: string,
): Promise<{ revisions: StudioRevisionInfo[]; activeRevisionId: string | null }> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    select: { activeRevisionId: true },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const rows = await prisma.screenshotRevision.findMany({
    where: { jobId },
    orderBy: { rev: "asc" },
  });

  const revisions = rows.map((row) => ({
    id: row.id,
    rev: row.rev,
    name: row.name,
    createdAt: row.createdAt,
    isActive: row.id === job.activeRevisionId,
  }));

  return { revisions, activeRevisionId: job.activeRevisionId };
}

export async function ensureStudioOriginal(jobId: string): Promise<StudioRevisionInfo | null> {
  const existing = await prisma.screenshotRevision.findFirst({
    where: { jobId },
    orderBy: { rev: "asc" },
  });

  if (existing) return null;

  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    select: { framedByLocale: true, screenshotStyle: true },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const created = await prisma.screenshotRevision.create({
    data: {
      jobId,
      rev: 0,
      name: "Original",
      framedByLocale: (job.framedByLocale ?? {}) as Prisma.InputJsonValue,
      style: (job.screenshotStyle ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });

  return {
    id: created.id,
    rev: created.rev,
    name: created.name,
    createdAt: created.createdAt,
    isActive: false,
  };
}

export async function nextStudioRev(jobId: string): Promise<number> {
  const latest = await prisma.screenshotRevision.findFirst({
    where: { jobId },
    orderBy: { rev: "desc" },
    select: { rev: true },
  });

  return (latest?.rev ?? 0) + 1;
}

export async function createStudioRevision(args: {
  jobId: string;
  rev: number;
  name?: string;
  framedByLocale: FramedMap;
  style?: StudioStyle;
  titles?: Record<string, Record<string, string>>;
  styles?: Record<string, Partial<StudioStyle>>;
}): Promise<StudioRevisionInfo> {
  const created = await prisma.screenshotRevision.create({
    data: {
      jobId: args.jobId,
      rev: args.rev,
      name: args.name?.trim() || null,
      framedByLocale: args.framedByLocale as Prisma.InputJsonValue,
      style: (args.style ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      titles: (args.titles ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      styles: (args.styles ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });

  await prisma.screenshotJob.update({
    where: { id: args.jobId },
    data: { activeRevisionId: created.id },
  });

  return {
    id: created.id,
    rev: created.rev,
    name: created.name,
    createdAt: created.createdAt,
    isActive: true,
  };
}

export const STUDIO_JOB_NAME_MAX_LENGTH = 80;

export function normalizeStudioJobName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const clean = value.trim().replace(/\s+/g, " ");

  if (!clean) return null;

  return clean.slice(0, STUDIO_JOB_NAME_MAX_LENGTH);
}

export async function renameStudioJob(
  jobId: string,
  name: unknown,
): Promise<{ jobId: string; commitMessage: string | null }> {
  const job = await prisma.screenshotJob.findUnique({
    where: { id: jobId },
    select: { id: true },
  });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const commitMessage = normalizeStudioJobName(name);

  await prisma.screenshotJob.update({
    where: { id: jobId },
    data: { commitMessage },
  });

  return { jobId, commitMessage };
}

export async function setActiveStudioRevision(jobId: string, revisionId: string | null): Promise<void> {
  if (revisionId) {
    const revision = await prisma.screenshotRevision.findFirst({
      where: { id: revisionId, jobId },
      select: { id: true },
    });

    if (!revision) throw new Error(`Screenshot revision ${revisionId} not found`);
  }

  await prisma.screenshotJob.update({
    where: { id: jobId },
    data: { activeRevisionId: revisionId },
  });
}

export async function setAppDefaultFromRevision(
  appId: string,
  revisionId: string,
): Promise<{ appId: string; revisionId: string }> {
  const revision = await prisma.screenshotRevision.findUnique({
    where: { id: revisionId },
    include: { job: { select: { appId: true } } },
  });

  if (!revision) throw new Error(`Screenshot revision ${revisionId} not found`);
  if (revision.job.appId !== appId) throw new Error("Revision does not belong to this app");

  const style = normalizeStudioStyle(revision.style);

  style.titleLines = [];

  const styles = storedShotStyles(revision.styles);
  const titles = parseTitlesMap(revision.titles);

  await prisma.app.update({
    where: { id: appId },
    data: {
      defaultScreenshotStyle: style as Prisma.InputJsonValue,
      defaultScreenshotShotStyles: styles as Prisma.InputJsonValue,
      defaultScreenshotRevisionId: revision.id,
      defaultScreenshotTitles: titles as Prisma.InputJsonValue,
    },
  });

  return { appId, revisionId: revision.id };
}

export async function deleteStudioRevision(
  revisionId: string,
): Promise<{ jobId: string; activeRevisionId: string | null }> {
  const revision = await prisma.screenshotRevision.findUnique({ where: { id: revisionId } });

  if (!revision) throw new Error(`Screenshot revision ${revisionId} not found`);

  await prisma.screenshotRevision.delete({ where: { id: revisionId } });

  await prisma.app.updateMany({
    where: { defaultScreenshotRevisionId: revisionId },
    data: { defaultScreenshotRevisionId: null },
  });

  const revDir = path.join(process.cwd(), "screenshots", revision.jobId, "studio", `rev${revision.rev}`);

  if (fs.existsSync(revDir)) {
    fs.rmSync(revDir, { recursive: true, force: true });
  }

  const job = await prisma.screenshotJob.findUnique({
    where: { id: revision.jobId },
    select: { activeRevisionId: true },
  });

  if (job?.activeRevisionId !== revisionId) {
    return { jobId: revision.jobId, activeRevisionId: job?.activeRevisionId ?? null };
  }

  const fallback = await prisma.screenshotRevision.findFirst({
    where: { jobId: revision.jobId },
    orderBy: { rev: "desc" },
    select: { id: true },
  });

  await prisma.screenshotJob.update({
    where: { id: revision.jobId },
    data: { activeRevisionId: fallback?.id ?? null },
  });

  return { jobId: revision.jobId, activeRevisionId: fallback?.id ?? null };
}

export function asPresetInfo(row: ScreenshotStylePreset): StudioPresetInfo {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    ...normalizeStudioStyle({
      bgColor1: row.bgColor1,
      bgColor2: row.bgColor2,
      textColor: row.textColor,
      font: row.font,
      textPosition: row.textPosition,
      offsetX: row.offsetX,
      offsetY: row.offsetY,
      titleOffsetX: row.titleOffsetX,
      titleOffsetY: row.titleOffsetY,
      titleScale: row.titleScale,
      deviceScale: row.deviceScale,
      titleBoxW: row.titleBoxW,
      titleBoxH: row.titleBoxH,
      titleLines: parseStoredTitleLines(row.titleLines),
    }),
  };
}

export async function listStudioPresets(appId: string): Promise<StudioPresetInfo[]> {
  const rows = await prisma.screenshotStylePreset.findMany({
    where: { appId },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(asPresetInfo);
}

export async function createStudioPreset(
  appId: string,
  name: string,
  style: StudioStyle,
): Promise<StudioPresetInfo> {
  const cleanName = name.trim();

  if (!cleanName) throw new Error("Preset name is required");

  const stored = { ...style, titleLines: [] };

  try {
    const created = await prisma.screenshotStylePreset.create({
      data: {
        appId,
        name: cleanName,
        bgColor1: stored.bgColor1,
        bgColor2: stored.bgColor2,
        textColor: stored.textColor,
        font: stored.font,
        textPosition: stored.textPosition,
        offsetX: stored.offsetX,
        offsetY: stored.offsetY,
        titleOffsetX: stored.titleOffsetX,
        titleOffsetY: stored.titleOffsetY,
        titleScale: stored.titleScale,
        deviceScale: stored.deviceScale,
        titleBoxW: stored.titleBoxW,
        titleBoxH: stored.titleBoxH,
        titleLines: JSON.stringify(stored.titleLines),
      },
    });

    return asPresetInfo(created);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error(`A preset named "${cleanName}" already exists`);
    }

    throw err;
  }
}

export async function updateStudioPreset(
  presetId: string,
  patch: { name?: string; style?: Partial<StudioStyle> },
): Promise<StudioPresetInfo> {
  const row = await prisma.screenshotStylePreset.findUnique({ where: { id: presetId } });

  if (!row) throw new Error(`Style preset ${presetId} not found`);

  const data: {
    name?: string;
    bgColor1?: string;
    bgColor2?: string;
    textColor?: string;
    font?: string;
    textPosition?: string;
    offsetX?: number;
    offsetY?: number;
    titleOffsetX?: number;
    titleOffsetY?: number;
    titleScale?: number;
    deviceScale?: number;
    titleBoxW?: number;
    titleBoxH?: number;
    titleLines?: string;
  } = {};

  if (patch.name !== undefined) {
    const cleanName = patch.name.trim();

    if (!cleanName) throw new Error("Preset name is required");

    data.name = cleanName;
  }

  if (patch.style) {
    const merged = normalizeStudioStyle({ ...asPresetInfo(row), ...patch.style });

    data.bgColor1 = merged.bgColor1;
    data.bgColor2 = merged.bgColor2;
    data.textColor = merged.textColor;
    data.font = merged.font;
    data.textPosition = merged.textPosition;
    data.offsetX = merged.offsetX;
    data.offsetY = merged.offsetY;
    data.titleOffsetX = merged.titleOffsetX;
    data.titleOffsetY = merged.titleOffsetY;
    data.titleScale = merged.titleScale;
    data.deviceScale = merged.deviceScale;
    data.titleBoxW = merged.titleBoxW;
    data.titleBoxH = merged.titleBoxH;
    data.titleLines = JSON.stringify([]);
  }

  try {
    const updated = await prisma.screenshotStylePreset.update({
      where: { id: presetId },
      data,
    });

    return asPresetInfo(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error(`A preset named "${patch.name?.trim()}" already exists`);
    }

    throw err;
  }
}

export async function deleteStudioPreset(presetId: string): Promise<void> {
  const row = await prisma.screenshotStylePreset.findUnique({
    where: { id: presetId },
    select: { id: true },
  });

  if (!row) throw new Error(`Style preset ${presetId} not found`);

  await prisma.screenshotStylePreset.delete({ where: { id: presetId } });
}
