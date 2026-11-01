import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import {
  getEffectiveFramed,
  getStudioData,
  listShotBezels,
  renderStudioRevision,
  studioBasename,
  studioRawImageSize,
} from "../../../services/screenshot-studio";
import {
  appNotFoundWithListApps,
  getSettingsWithBundleId,
  mcpToolMessages,
  registerMutatingTool,
  textResult,
  verifyMcpAppAccess,
  verifyMcpAppAccessById,
} from "./shared";

export function imageMimeType(basename: string): string {
  return /\.jpe?g$/i.test(basename) ? "image/jpeg" : "image/png";
}

export async function loadJobWithAccess(userId: string, jobId: string) {
  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true, appId: true } });
  if (!job) return { job: null, app: null };

  const app = await verifyMcpAppAccessById(userId, job.appId);

  return { job, app };
}

export function registerScreenshotStudioReadTools(server: McpServer, userId: string) {
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
        "label, native pixel size, current caption/title text, and current layout (position/scale/rotation of the " +
        "device frame and caption, device frame color, and any image overlays already placed on that shot). Use " +
        "list_screenshot_jobs first to find a jobId, then this before editing anything with update_screenshot_caption, " +
        "update_screenshot_layout, list_screenshot_bezels, add_screenshot_overlay, update_screenshot_overlay, or " +
        "delete_screenshot_overlay. Pass locale and/or basename to scope the result to one shot instead of every " +
        "locale — a full job can have dozens of locales, so scoping down keeps the response small when you only " +
        "need one screenshot's current layout.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        locale: z.string().optional().describe("Restrict to one locale, e.g. 'en-US'. Returns every locale if omitted."),
        basename: z
          .string()
          .optional()
          .describe("Restrict to one screenshot filename, e.g. '01_Home.png'. Returns every screenshot if omitted."),
      },
    },
    async ({ jobId, locale, basename }: { jobId: string; locale?: string; basename?: string }) => {
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const data = await getStudioData(jobId);

      const locales = locale ? data.locales.filter((l) => l.locale === locale) : data.locales;

      if (locale && locales.length === 0) {
        return textResult(`Locale "${locale}" not found for job ${jobId}.`);
      }

      const basenames = basename ? locales.flatMap((l) => l.items.filter((item) => item.basename === basename)) : null;

      if (basename && (!basenames || basenames.length === 0)) {
        return textResult(`Screenshot "${basename}" not found${locale ? ` for locale "${locale}"` : ""} in job ${jobId}.`);
      }

      const result = {
        jobId: data.job.id,
        commitMessage: data.job.commitMessage,
        branch: data.job.branch,
        activeRevisionId: data.activeRevisionId,
        revisions: data.revisions,
        globalStyle: data.style,
        locales: await Promise.all(
          locales.map(async (l) => ({
            locale: l.locale,
            items: await Promise.all(
              l.items
                .filter((item) => !basename || item.basename === basename)
                .map(async (item) => ({
                  basename: item.basename,
                  deviceLabel: item.deviceLabel,
                  caption: item.title,
                  hasRawSource: item.hasRaw,
                  nativeSize: item.hasRaw ? await studioRawImageSize(jobId, item.basename) : null,
                  layout: data.styles[item.basename] ?? {},
                })),
            ),
          })),
        ),
      };

      return textResult(JSON.stringify(result, null, 2));
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_screenshot_bezels",
    {
      description:
        "List the available device frame (bezel) colors for one screenshot, e.g. the different finishes of an " +
        "iPhone/iPad frame. Returns each option's file name (pass to update_screenshot_layout's deviceFrame " +
        "field) and display color, plus which one is currently the default. Use get_screenshot_studio_overview " +
        "first to find the exact basename.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
      },
    },
    async ({ jobId, basename }: { jobId: string; basename: string }) => {
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const bezels = await listShotBezels(jobId, basename);

      return textResult(JSON.stringify(bezels, null, 2));
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
