import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_STUDIO_STYLE,
  normalizeStudioOverlays,
  normalizeStudioStyle,
  type StudioStyle,
} from "./style";
import { parseTitlesMap } from "./revisions";

export interface StudioDraft {
  style: StudioStyle;
  styles: Record<string, Partial<StudioStyle>>;
  titles: Record<string, Record<string, string>>;
  updatedBy: string | null;
  updatedAt: Date;
}

type StudioDraftBody = Omit<StudioDraft, "updatedBy" | "updatedAt">;

const DRAFT_STYLE_KEYS = Object.keys(DEFAULT_STUDIO_STYLE) as Array<keyof StudioStyle>;

function cleanDraftStyles(value: unknown): Record<string, Partial<StudioStyle>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const styles: Record<string, Partial<StudioStyle>> = {};

  for (const [base, patch] of Object.entries(value as Record<string, unknown>)) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;

    const source = patch as Record<string, unknown>;
    const clean: Partial<StudioStyle> = {};
    const sink = clean as Record<string, unknown>;

    for (const key of DRAFT_STYLE_KEYS) {
      if (key === "titleLines" || key === "overlays" || source[key] === undefined) continue;

      sink[key] = source[key];
    }

    const overlays = normalizeStudioOverlays(source.overlays);

    if (overlays.length > 0) sink.overlays = overlays;

    if (Object.keys(clean).length > 0) styles[base] = clean;
  }

  return styles;
}

export function normalizeStudioDraft(value: unknown): StudioDraftBody {
  const input = (value ?? {}) as { style?: unknown; styles?: unknown; titles?: unknown };

  return {
    style: normalizeStudioStyle(input.style),
    styles: cleanDraftStyles(input.styles),
    titles: parseTitlesMap(input.titles),
  };
}

export async function getStudioDraft(jobId: string): Promise<StudioDraft | null> {
  const row = await prisma.screenshotStudioDraft.findUnique({ where: { jobId } });

  if (!row) return null;

  const body = normalizeStudioDraft({ style: row.style, styles: row.styles, titles: row.titles });

  return { ...body, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function saveStudioDraft(
  jobId: string,
  value: unknown,
  updatedBy: string | null,
): Promise<StudioDraft> {
  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const body = normalizeStudioDraft(value);

  const row = await prisma.screenshotStudioDraft.upsert({
    where: { jobId },
    create: {
      jobId,
      style: body.style as unknown as Prisma.InputJsonValue,
      styles: body.styles as unknown as Prisma.InputJsonValue,
      titles: body.titles as unknown as Prisma.InputJsonValue,
      updatedBy,
    },
    update: {
      style: body.style as unknown as Prisma.InputJsonValue,
      styles: body.styles as unknown as Prisma.InputJsonValue,
      titles: body.titles as unknown as Prisma.InputJsonValue,
      updatedBy,
    },
  });

  return { ...body, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function deleteStudioDraft(jobId: string): Promise<void> {
  await prisma.screenshotStudioDraft.deleteMany({ where: { jobId } });
}
