import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyStudioGeometry,
  deleteStudioLocales,
  getStudioWorkspace,
  saveStudioWorkspaceDraft,
  saveStudioWorkspaceRevision,
  deleteStudioDraft,
  reorderFramedScreenshots,
  normalizeStudioStyle,
  type StudioApplyMode,
} from "../../../services/screenshot-studio";
import { loadJobWithAccess } from "./screenshot-studio-tools-reads";
import { registerMutatingTool, textResult } from "./shared";

export function registerScreenshotStudioManageTools(server: McpServer, userId: string) {
  registerMutatingTool(server, userId, "delete_screenshot_locales", {
    description: "Permanently delete selected languages and their screenshots from a Studio job, including all revisions and drafts. At least one language must remain. Use get_screenshot_studio_overview to find locale codes. This deletes Studio screenshots, not App Store Connect localizations.",
    inputSchema: {
      jobId: z.string(),
      locales: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)).min(1)
        .describe("Locale codes to delete, e.g. ['de-DE', 'fr-FR']."),
    },
    annotations: { destructiveHint: true },
  }, async ({ jobId, locales }: { jobId: string; locales: string[] }) => {
    const { job, app } = await loadJobWithAccess(userId, jobId);
    if (!job || !app) return textResult(`Screenshot job not found: ${jobId}`);
    return textResult(JSON.stringify(await deleteStudioLocales(jobId, locales)));
  });

  registerMutatingTool(server, userId, "reorder_screenshots", {
    description: "Change screenshot order in the shared Studio draft without rendering images or changing the saved revision. Call save_screenshot_revision explicitly when ready. Pass every basename in the source language exactly once, in the desired order. Optionally propagate that order to all languages; screenshots absent from the source language stay at the end in their existing order. Use get_screenshot_studio_overview to inspect order and basenames.",
    inputSchema: {
      jobId: z.string(),
      locale: z.string().describe("Source language whose complete order is supplied."),
      basenames: z.array(z.string()).min(1).describe("Every screenshot basename in this language, in the desired order."),
      allLocales: z.boolean().default(false).describe("Also reorder matching screenshots across every language."),
    },
  }, async ({ jobId, locale, basenames, allLocales }: { jobId: string; locale: string; basenames: string[]; allLocales: boolean }) => {
    const { job, app } = await loadJobWithAccess(userId, jobId);
    if (!job || !app) return textResult(`Screenshot job not found: ${jobId}`);
    const data = await getStudioWorkspace(jobId);
    const framed = Object.fromEntries(data.locales.map((entry) => [entry.locale, entry.items.map((item) => item.url)]));
    const ordered = reorderFramedScreenshots(framed, locale, basenames, allLocales);
    for (const entry of data.locales) {
      const byUrl = new Map(entry.items.map((item) => [item.url, item]));
      entry.items = ordered[entry.locale].map((url) => byUrl.get(url)!);
    }
    const draft = await saveStudioWorkspaceDraft(data, userId);
    return textResult(JSON.stringify({ state: "draft", updatedAt: draft.updatedAt, order: draft.order }));
  });

  registerMutatingTool(server, userId, "apply_screenshot_layout", {
    description: "Copy one screenshot's device and caption geometry, including line spacing, using the same three Apply scopes as Studio. device-locale: every screenshot of this device type in the source language; screen-all: this exact screenshot across all languages; device-all: every screenshot of this device type across all languages. Preserves target captions, overlays, device frame colors and appearance. Edits the shared Studio draft without rendering images or creating a revision. Source geometry includes current draft changes. Call save_screenshot_revision explicitly when ready.",
    inputSchema: {
      jobId: z.string(),
      locale: z.string().describe("Source language."),
      basename: z.string().describe("Source screenshot basename from get_screenshot_studio_overview."),
      scope: z.enum(["device-locale", "screen-all", "device-all"]),
    },
  }, async ({ jobId, locale, basename, scope }: { jobId: string; locale: string; basename: string; scope: StudioApplyMode }) => {
    const { job, app } = await loadJobWithAccess(userId, jobId);
    if (!job || !app) return textResult(`Screenshot job not found: ${jobId}`);
    const data = await getStudioWorkspace(jobId);
    const sourceLocale = data.locales.find((entry) => entry.locale === locale);
    const selected = sourceLocale?.items.find((item) => item.basename === basename);
    if (!sourceLocale || !selected) return textResult(`Screenshot "${basename}" not found for locale "${locale}".`);
    const overrides = Object.fromEntries(data.locales.map((entry) => [entry.locale, entry.styles]));
    const source = { ...data.style, ...sourceLocale.styles[basename] };
    const styles = applyStudioGeometry(overrides, data.locales, locale, selected, source, scope);
    const locales = Object.fromEntries(data.locales
      .filter((entry) => scope !== "device-locale" || entry.locale === locale)
      .map((entry) => [entry.locale, { titles: {}, styles: styles[entry.locale] }]));
    const changed = data.locales.some((entry) => locales[entry.locale] && entry.items.some((item) =>
      JSON.stringify(normalizeStudioStyle({ ...data.style, ...entry.styles[item.basename] })) !==
      JSON.stringify(normalizeStudioStyle({ ...data.style, ...styles[entry.locale][item.basename] })),
    ));
    if (!changed) return textResult("Selected screenshots already have this geometry; no images were rendered.");
    for (const entry of data.locales) entry.styles = styles[entry.locale];
    const draft = await saveStudioWorkspaceDraft(data, userId);
    return textResult(JSON.stringify({ state: "draft", updatedAt: draft.updatedAt, scope, revisionCreated: false }));
  });
  registerMutatingTool(server, userId, "save_screenshot_revision", {
    description: "Explicitly save the current shared Studio draft as a named revision, render only changed screenshots, and activate it. Editing tools never create revisions automatically. Inspect get_screenshot_studio_overview and view_app_screenshot first, then call this when you decide the draft is ready. Newer concurrent draft changes are kept.",
    inputSchema: { jobId: z.string(), name: z.string().max(80).optional().describe("Optional revision name.") },
  }, async ({ jobId, name }: { jobId: string; name?: string }) => {
    const { job, app } = await loadJobWithAccess(userId, jobId);
    if (!job || !app) return textResult(`Screenshot job not found: ${jobId}`);
    return textResult(JSON.stringify(await saveStudioWorkspaceRevision(jobId, userId, name)));
  });

  registerMutatingTool(server, userId, "discard_screenshot_draft", {
    description: "Explicitly discard the current shared Studio draft and return to the saved active revision. No revision is created. This also discards unsaved changes made by a human in Studio; inspect the draft before using it.",
    inputSchema: { jobId: z.string() }, annotations: { destructiveHint: true },
  }, async ({ jobId }: { jobId: string }) => {
    const { job, app } = await loadJobWithAccess(userId, jobId);
    if (!job || !app) return textResult(`Screenshot job not found: ${jobId}`);
    const data = await getStudioWorkspace(jobId);
    if (data.draft) await deleteStudioDraft(jobId, data.draft.updatedAt.toISOString());
    if ((await getStudioWorkspace(jobId)).draft) return textResult("The draft changed concurrently and was kept. Inspect it before discarding again.");
    return textResult("Draft discarded. The saved active revision is unchanged.");
  });

}
