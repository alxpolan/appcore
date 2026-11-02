import { prisma } from "../../config";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_STUDIO_STYLE,
  normalizeStudioOverlays,
  normalizeStudioStyle,
  type StudioStyle,
} from "./style";
import { parseLocaleStyles, parseTitlesMap, type LocaleStylesMap } from "./revisions";

export interface StudioDraft {
  style: StudioStyle;
  styles: LocaleStylesMap;
  titles: Record<string, Record<string, string>>;
  order: Record<string, string[]>;
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

export class StudioDraftConflictError extends Error {
  constructor() { super("Draft changed in another session. Reload it before editing again."); }
}

function cleanDraftOrder(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, order]) =>
    Array.isArray(order) && order.every((base) => typeof base === "string") && new Set(order).size === order.length,
  )) as Record<string, string[]>;
}

export function normalizeStudioDraft(value: unknown): StudioDraftBody {
  const input = (value ?? {}) as { style?: unknown; styles?: unknown; titles?: unknown; order?: unknown };

  return {
    style: normalizeStudioStyle(input.style),
    styles: parseLocaleStyles(input.styles, cleanDraftStyles),
    titles: parseTitlesMap(input.titles),
    order: cleanDraftOrder(input.order),
  };
}

export async function getStudioDraft(jobId: string): Promise<StudioDraft | null> {
  const row = await prisma.screenshotStudioDraft.findUnique({ where: { jobId } });

  if (!row) return null;

  const body = normalizeStudioDraft({ style: row.style, styles: row.styles, titles: row.titles, order: row.order });

  return { ...body, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function saveStudioDraft(
  jobId: string,
  value: unknown,
  updatedBy: string | null,
  expectedUpdatedAt?: string | null,
): Promise<StudioDraft> {
  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const body = normalizeStudioDraft(value);

  const data = {
    style: body.style as unknown as Prisma.InputJsonValue,
    styles: body.styles as unknown as Prisma.InputJsonValue,
    titles: body.titles as unknown as Prisma.InputJsonValue,
    order: body.order as Prisma.InputJsonValue,
    updatedBy,
  };
  if (expectedUpdatedAt !== undefined) {
    if (expectedUpdatedAt === null) {
      try {
        const row = await prisma.screenshotStudioDraft.create({ data: { jobId, ...data } });
        return { ...body, updatedBy, updatedAt: row.updatedAt };
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") throw new StudioDraftConflictError();
        throw err;
      }
    }
    const expected = new Date(expectedUpdatedAt);
    if (!Number.isFinite(expected.getTime())) throw new StudioDraftConflictError();
    const updatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
    const result = await prisma.screenshotStudioDraft.updateMany({
      where: { jobId, updatedAt: expected }, data: { ...data, updatedAt },
    });
    if (result.count !== 1) throw new StudioDraftConflictError();
    return { ...body, updatedBy, updatedAt };
  }

  const row = await prisma.screenshotStudioDraft.upsert({
    where: { jobId },
    create: { jobId, ...data },
    update: data,
  });

  return { ...body, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function deleteStudioDraft(jobId: string, expectedUpdatedAt?: string): Promise<void> {
  await prisma.screenshotStudioDraft.deleteMany({
    where: { jobId, ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}) },
  });
}
