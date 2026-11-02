import fs from "fs";
import os from "os";
import path from "path";
import { getStudioData, renderStudioRevision, assertStudioSegment, assertStudioBasename, pickStudioSourceLocale, type StudioData } from "./render";
import { deleteStudioDraft, getStudioDraft, saveStudioDraft } from "./drafts";
import { effectiveLocaleStyles } from "./revisions";
import { normalizeStudioStyle, titleLinesForTitle } from "./style";
import { frameComplexBatch } from "./complex";

/** The shared working copy: active revision with the persisted Studio draft applied. */
export async function getStudioWorkspace(jobId: string): Promise<StudioData> {
  const data = await getStudioData(jobId);
  const draft = data.draft;
  if (!draft) return data;
  return {
    ...data,
    style: draft.style,
    locales: data.locales.map((locale) => {
      const hasStyles = locale.locale in draft.styles || "*" in draft.styles;
      const order = new Map((draft.order[locale.locale] ?? []).map((base, index) => [base, index]));
      const items = locale.items.map((item) => ({ ...item, title: draft.titles[locale.locale]?.[item.basename] ?? item.title }));
      if (order.size) items.sort((a, b) => (order.get(a.basename) ?? Infinity) - (order.get(b.basename) ?? Infinity));
      return { ...locale, items, styles: hasStyles ? effectiveLocaleStyles(draft.styles, locale.locale) : locale.styles };
    }),
  };
}

export async function saveStudioWorkspaceDraft(data: StudioData, userId: string) {
  return saveStudioDraft(data.job.id, {
    style: data.style,
    styles: Object.fromEntries(data.locales.map((locale) => [locale.locale, locale.styles])),
    titles: Object.fromEntries(data.locales.map((locale) => [locale.locale, Object.fromEntries(locale.items.map((item) => [item.basename, item.title]))])),
    order: Object.fromEntries(data.locales.map((locale) => [locale.locale, locale.items.map((item) => item.basename)])),
  }, userId, data.draft?.updatedAt.toISOString() ?? null);
}

export async function saveStudioWorkspaceRevision(jobId: string, userId: string, name?: string) {
  const data = await getStudioWorkspace(jobId);
  if (!data.draft) throw new Error("No draft to save. Edit screenshots first.");
  const result = await renderStudioRevision({
    jobId, name, style: data.style, pusher: userId,
    locales: Object.fromEntries(data.locales.map((locale) => [locale.locale, {
      styles: locale.styles, titles: Object.fromEntries(locale.items.map((item) => [item.basename, item.title])),
    }])),
    order: Object.fromEntries(data.locales.map((locale) => [locale.locale, locale.items.map((item) => item.basename)])),
  });
  // A newer edit made during rendering remains a draft.
  await deleteStudioDraft(jobId, data.draft.updatedAt.toISOString());
  return { ...result, draftRemaining: Boolean(await getStudioDraft(jobId)) };
}

/** Render the working copy for inspection without creating or activating a revision. */
export async function previewStudioWorkspace(jobId: string, locale: string, basename: string): Promise<Buffer> {
  assertStudioSegment(jobId, "job");
  assertStudioBasename(basename);
  const data = await getStudioWorkspace(jobId);
  const localeData = data.locales.find((entry) => entry.locale === locale);
  const item = localeData?.items.find((entry) => entry.basename === basename);
  if (!item || !localeData) throw new Error("Screenshot not found");
  const rawRoot = path.join(process.cwd(), "screenshots", jobId, "raw");
  const rawLocales = await fs.promises.readdir(rawRoot).catch(() => [] as string[]);
  const sourceLocale = pickStudioSourceLocale(locale, rawLocales);
  if (!sourceLocale || !item.hasRaw) throw new Error("No stored raw source for draft preview");
  const style = normalizeStudioStyle({ ...data.style, ...localeData.styles[basename] });
  style.titleLines = titleLinesForTitle(style.titleLines, item.title);
  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "studio-draft-preview-"));
  try {
    await frameComplexBatch({
      srcDir: path.join(rawRoot, sourceLocale), outDir, jobId,
      shots: [{ filename: basename, base: basename.replace(/\.[^.]+$/, ""), style }],
      titles: new Map([[basename.replace(/\.[^.]+$/, ""), item.title]]), style: data.style,
    });
    return await fs.promises.readFile(path.join(outDir, basename));
  } finally {
    await fs.promises.rm(outDir, { recursive: true, force: true });
  }
}
