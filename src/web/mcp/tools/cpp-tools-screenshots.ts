import fs from "fs";
import path from "path";
import sharp from "sharp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  jsonResult,
  mcpToolMessages,
  registerMutatingTool,
  textResult,
} from "./shared";
import { loadJobWithAccess } from "./screenshot-studio-tools-reads";
import { getEffectiveFramed } from "../../../services/screenshot-studio/revisions";
import { detectDisplayTypeFromDimensions, uploadFileToSet } from "../../../services/utils/custom-product-pages";

const CPP_MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

export function registerCppScreenshotTools(server: McpServer, userId: string) {
  registerMutatingTool(
    server,
    userId,
    "add_cpp_screenshots_from_studio_job",
    {
      description:
        "Connect a Custom Product Page locale's screenshot set to the already-rendered screenshots of a " +
        "Screenshot Studio job, for one locale. Reads the job's current rendered files for that locale, " +
        "detects each screenshot's display type from its pixel dimensions, and uploads any that aren't already " +
        "in the set (existing filenames are skipped, not duplicated). Render the job in Screenshot Studio first " +
        "— get jobId from list_screenshot_jobs, and localizationId from list_cpp_localizations or add_cpp_locale.",
      inputSchema: {
        localizationId: z.string().describe("Custom Product Page localization ID to attach screenshots to."),
        jobId: z.string().describe("Screenshot Studio job ID, from list_screenshot_jobs."),
        locale: z
          .string()
          .describe("Which locale's rendered screenshots to pull from the job, e.g. 'en-US'."),
      },
    },
    async ({ localizationId, jobId, locale }: { localizationId: string; jobId: string; locale: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const effective = await getEffectiveFramed(jobId);
      const urls = effective.framedByLocale[locale] ?? [];

      if (urls.length === 0) {
        return textResult(`No rendered screenshots for locale '${locale}' in job ${jobId}.`);
      }

      try {
        const asc = await createAscClient(settings);
        const sets = await asc.listCustomProductPageScreenshotSets(localizationId);
        const uploaded: string[] = [];
        const skipped: Array<{ fileName: string; reason: string }> = [];

        for (const url of urls) {
          const fileName = decodeURIComponent(url.split("/").pop() ?? url);
          const absPath = path.join(process.cwd(), url.replace(/^\//, ""));
          const fileBytes = fs.readFileSync(absPath);

          if (fileBytes.length > CPP_MAX_SCREENSHOT_BYTES) {
            skipped.push({ fileName, reason: "exceeds 15MB" });
            continue;
          }

          const meta = await sharp(fileBytes).metadata();
          const displayType = detectDisplayTypeFromDimensions(meta.width, meta.height);

          if (!displayType) {
            skipped.push({ fileName, reason: `unsupported dimensions ${meta.width}x${meta.height}` });
            continue;
          }

          let set = sets.find((entry) => entry.attributes.screenshotDisplayType === displayType) ?? null;

          if (!set) {
            set = await asc.createCustomProductPageScreenshotSet(localizationId, displayType);
            sets.push(set);
          }

          const existingShots = await asc.listScreenshotsInSet(set.id);

          if (existingShots.some((shot) => shot.attributes.fileName === fileName)) {
            skipped.push({ fileName, reason: "already present in the screenshot set" });
            continue;
          }

          await uploadFileToSet(asc, set.id, fileName, fileBytes);
          uploaded.push(fileName);
        }

        return jsonResult({ localizationId, jobId, locale, uploaded, skipped });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_cpp_screenshot",
    {
      description:
        "Delete a single screenshot from a Custom Product Page's screenshot set. Get the screenshot id from " +
        "list_cpp_localizations.",
      inputSchema: {
        screenshotId: z.string().describe("Screenshot ID to delete, from list_cpp_localizations."),
      },
    },
    async ({ screenshotId }: { screenshotId: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);

        await asc.deleteScreenshot(screenshotId);

        return jsonResult({ ok: true, screenshotId });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );
}
