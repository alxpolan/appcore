import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import { getEffectiveFramed, getStudioData, renderStudioRevision, studioBasename } from "../../../services/screenshot-studio";
import {
  appNotFoundWithListApps,
  getSettingsWithBundleId,
  mcpToolMessages,
  registerMutatingTool,
  textResult,
  verifyMcpAppAccess,
  verifyMcpAppAccessById,
} from "./shared";

function imageMimeType(basename: string): string {
  return /\.jpe?g$/i.test(basename) ? "image/jpeg" : "image/png";
}

async function loadJobWithAccess(userId: string, jobId: string) {
  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true, appId: true } });
  if (!job) return { job: null, app: null };

  const app = await verifyMcpAppAccessById(userId, job.appId);

  return { job, app };
}

export function registerScreenshotStudioTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_screenshot_jobs",
    {
      description:
        "List completed App Store screenshot jobs for an app, with their locales and how many studio revisions " +
        "each one has. Use this to find a jobId for get_screenshot_studio_overview, view_app_screenshot, or " +
        "update_screenshot_caption. Use list_apps first to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Falls back to the user's default app if omitted."),
        limit: z.number().int().min(1).max(50).default(10).describe("Max jobs to return (default 10, max 50)"),
      },
    },
    async ({ bundleId, limit }: { bundleId?: string; limit: number }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return textResult(mcpToolMessages.noBundleIdProvidedWithDefault);
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);

      if (!app) {
        return textResult(appNotFoundWithListApps(resolvedBundleId));
      }

      const jobs = await prisma.screenshotJob.findMany({
        where: { appId: app.id, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          commitMessage: true,
          branch: true,
          createdAt: true,
          framedByLocale: true,
          _count: { select: { revisions: true } },
        },
      });

      const result = jobs.map((j) => ({
        jobId: j.id,
        commitMessage: j.commitMessage,
        branch: j.branch,
        createdAt: j.createdAt,
        locales: j.framedByLocale && typeof j.framedByLocale === "object" ? Object.keys(j.framedByLocale) : [],
        revisionCount: j._count.revisions,
      }));

      return textResult(JSON.stringify(result, null, 2));
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_screenshot_studio_overview",
    {
      description:
        "Get the full screenshot studio state for a job: every locale, screenshot filename (basename), device " +
        "label, and current caption/title text. Use list_screenshot_jobs first to find a jobId, then this to see " +
        "exactly what's framed and what each caption says before viewing or editing anything.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
      },
    },
    async ({ jobId }: { jobId: string }) => {
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const data = await getStudioData(jobId);

      const result = {
        jobId: data.job.id,
        commitMessage: data.job.commitMessage,
        branch: data.job.branch,
        activeRevisionId: data.activeRevisionId,
        revisions: data.revisions,
        locales: data.locales.map((l) => ({
          locale: l.locale,
          items: l.items.map((item) => ({
            basename: item.basename,
            deviceLabel: item.deviceLabel,
            caption: item.title,
            hasRawSource: item.hasRaw,
          })),
        })),
      };

      return textResult(JSON.stringify(result, null, 2));
    },
  );

  // @ts-ignore
  server.registerTool(
    "view_app_screenshot",
    {
      description:
        "View one framed App Store screenshot as an image, so you can visually check its layout, background, " +
        "and caption text. Use get_screenshot_studio_overview first to find the exact basename and locale.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        locale: z.string().describe("Locale to view, e.g. 'en-US' (from get_screenshot_studio_overview)."),
      },
    },
    async ({ jobId, basename, locale }: { jobId: string; basename: string; locale: string }) => {
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const effective = await getEffectiveFramed(jobId);
      const url = (effective.framedByLocale[locale] ?? []).find((u) => studioBasename(u) === basename);

      if (!url) {
        return textResult(`No screenshot "${basename}" found for locale "${locale}" in job ${jobId}.`);
      }

      const absPath = path.join(process.cwd(), url);

      if (!fs.existsSync(absPath)) {
        return textResult(`Screenshot file is missing on disk: ${url}`);
      }

      const data = await fs.promises.readFile(absPath);

      return {
        content: [
          { type: "image" as const, data: data.toString("base64"), mimeType: imageMimeType(basename) },
          { type: "text" as const, text: `${locale} / ${basename}` },
        ],
      };
    },
  );

  registerMutatingTool(
    server,
    userId,
    "update_screenshot_caption",
    {
      description:
        "Change the caption/title text burned into one framed App Store screenshot and re-render it. Creates a " +
        "new studio revision (the previous one stays available). Use get_screenshot_studio_overview first to find " +
        "the exact basename and locale, and view_app_screenshot afterwards to confirm the result.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        locale: z.string().describe("Locale to update, e.g. 'en-US' (from get_screenshot_studio_overview)."),
        caption: z.string().min(1).max(200).describe("New caption/title text for this screenshot."),
      },
    },
    async ({ jobId, basename, locale, caption }: { jobId: string; basename: string; locale: string; caption: string }) => {
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const data = await getStudioData(jobId);
      const result = await renderStudioRevision({
        jobId,
        style: data.style,
        locales: { [locale]: { titles: { [basename]: caption } } },
      });

      return textResult(
        `Caption updated. New studio revision rev${result.revision.rev} (${result.revision.id}) is now active for ` +
          `job ${jobId}. ${basename} / ${locale} → "${caption}". Use view_app_screenshot to see the result.`,
      );
    },
    {
      action: "mcp.update_screenshot_caption",
      summarize: (args) => ({
        summary: `Updated caption for ${args.basename} (${args.locale}) in job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );
}
