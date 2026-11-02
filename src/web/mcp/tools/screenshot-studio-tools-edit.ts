import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEffectiveFramed,
  getStudioWorkspace,
  saveStudioWorkspaceDraft,
  normalizeDeviceScale,
  normalizeRotation,
  normalizeStudioOffset,
  normalizeStudioOverlays,
  normalizeTitleBoxSize,
  normalizeTitleScale,
  normalizeTitleLineHeight,
  overlayAssetExists,
  saveStudioOverlay,
  saveStudioOverlayFromUrl,
  studioBasename,
  studioRawImageSize,
  type StudioStyle,
} from "../../../services/screenshot-studio";
import { registerMutatingTool, textResult } from "./shared";
import { loadJobWithAccess } from "./screenshot-studio-tools-reads";

async function applyShotStylePatch(
  jobId: string,
  basename: string,
  locales: string[] | undefined,
  mutate: (current: Partial<StudioStyle>) => Partial<StudioStyle>,
  userId: string,
) {
  const data = await getStudioWorkspace(jobId);
  const effective = await getEffectiveFramed(jobId);

  const available = Object.keys(effective.framedByLocale).filter((locale) =>
    (effective.framedByLocale[locale] ?? []).some((url) => studioBasename(url) === basename),
  );

  if (available.length === 0) throw new Error(`No screenshot "${basename}" found in any locale for job ${jobId}.`);

  if (locales?.some((locale) => !available.includes(locale))) {
    throw new Error(`Requested locales must contain screenshot "${basename}". Available: ${available.join(", ")}.`);
  }
  const targetLocales = locales ?? available;

  if (targetLocales.length === 0) throw new Error(`None of the requested locales have screenshot "${basename}".`);

  for (const entry of data.locales) {
    if (!targetLocales.includes(entry.locale)) continue;
    const styles = { ...entry.styles };
    const patched = mutate(styles[basename] ?? {});
    if (Object.keys(patched).length > 0) styles[basename] = patched;
    else delete styles[basename];
    entry.styles = styles;
  }
  const result = await saveStudioWorkspaceDraft(data, userId);

  return { result, targetLocales };
}

export function registerScreenshotStudioEditTools(server: McpServer, userId: string) {
  registerMutatingTool(
    server,
    userId,
    "update_screenshot_layout",
    {
      description:
        "Reposition, resize, or rotate the device frame and/or caption on one screenshot, and/or change its " +
        "device frame color in the shared Studio draft. No rendering or revision is created. Call save_screenshot_revision explicitly when ready. Only the fields you pass are changed — " +
        "everything else (including any overlays already on the shot) is kept as-is. Applies to every locale that " +
        "has this screenshot unless you pass locales. Use get_screenshot_studio_overview first to see the current " +
        "layout and exact basename, list_screenshot_bezels to see valid deviceFrame values, and view_app_screenshot " +
        "afterwards to confirm the result.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        locales: z
          .array(z.string()).min(1)
          .optional()
          .describe("Locales to apply to, e.g. ['en-US']. Defaults to every locale that has this screenshot."),
        offsetX: z
          .number()
          .optional()
          .describe("Device frame horizontal offset in pixels, positive = right. Range -2048..2048."),
        offsetY: z
          .number()
          .optional()
          .describe("Device frame vertical offset in pixels, positive = down. Range -2048..2048."),
        deviceScale: z.number().optional().describe("Device frame scale multiplier, 1 = default. Range 0.2..2."),
        rotation: z.number().optional().describe("Device frame rotation in degrees, -180..180."),
        titleOffsetX: z
          .number()
          .optional()
          .describe("Caption horizontal offset in pixels, positive = right. Range -2048..2048."),
        titleOffsetY: z
          .number()
          .optional()
          .describe("Caption vertical offset in pixels, positive = down. Range -2048..2048."),
        titleScale: z.number().optional().describe("Caption font scale multiplier, 1 = default. Range 0.2..3."),
        titleLineHeight: z.number().min(1).max(2.5).optional().describe("Caption line spacing multiplier, 1.2 = default. Range 1..2.5."),
        titleBoxW: z.number().optional().describe("Caption wrap box width in pixels, 0 = auto-size. Range 0..4096."),
        titleBoxH: z.number().optional().describe("Caption wrap box height in pixels, 0 = auto-size. Range 0..4096."),
        titleRotation: z.number().optional().describe("Caption rotation in degrees, -180..180."),
        deviceFrame: z
          .string()
          .optional()
          .describe(
            "Device frame color/file from list_screenshot_bezels (e.g. 'iphone-15-pro-black.png'). Pass an empty " +
              "string to reset to the default frame for this device.",
          ),
      },
    },
    async (args: {
      jobId: string;
      basename: string;
      locales?: string[];
      offsetX?: number;
      offsetY?: number;
      deviceScale?: number;
      rotation?: number;
      titleOffsetX?: number;
      titleOffsetY?: number;
      titleScale?: number;
      titleLineHeight?: number;
      titleBoxW?: number;
      titleBoxH?: number;
      titleRotation?: number;
      deviceFrame?: string;
    }) => {
      const { jobId, basename, locales } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const hasField =
        args.offsetX !== undefined ||
        args.offsetY !== undefined ||
        args.deviceScale !== undefined ||
        args.rotation !== undefined ||
        args.titleOffsetX !== undefined ||
        args.titleOffsetY !== undefined ||
        args.titleScale !== undefined ||
        args.titleLineHeight !== undefined ||
        args.titleBoxW !== undefined ||
        args.titleBoxH !== undefined ||
        args.titleRotation !== undefined ||
        args.deviceFrame !== undefined;

      if (!hasField) {
        return textResult("Provide at least one field to change.");
      }

      const { targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const next: Partial<StudioStyle> = { ...current };

        if (args.offsetX !== undefined) next.offsetX = normalizeStudioOffset(args.offsetX);
        if (args.offsetY !== undefined) next.offsetY = normalizeStudioOffset(args.offsetY);
        if (args.deviceScale !== undefined) next.deviceScale = normalizeDeviceScale(args.deviceScale);
        if (args.rotation !== undefined) next.rotation = normalizeRotation(args.rotation);
        if (args.titleOffsetX !== undefined) next.titleOffsetX = normalizeStudioOffset(args.titleOffsetX);
        if (args.titleOffsetY !== undefined) next.titleOffsetY = normalizeStudioOffset(args.titleOffsetY);
        if (args.titleScale !== undefined) next.titleScale = normalizeTitleScale(args.titleScale);
        if (args.titleLineHeight !== undefined) next.titleLineHeight = normalizeTitleLineHeight(args.titleLineHeight);
        if (args.titleBoxW !== undefined) next.titleBoxW = normalizeTitleBoxSize(args.titleBoxW);
        if (args.titleBoxH !== undefined) next.titleBoxH = normalizeTitleBoxSize(args.titleBoxH);
        if (args.titleRotation !== undefined) next.titleRotation = normalizeRotation(args.titleRotation);

        if (args.deviceFrame !== undefined) {
          if (args.deviceFrame.length === 0) delete next.deviceFrame;
          else next.deviceFrame = args.deviceFrame.slice(0, 120);
        }

        return next;
      }, userId);

      return textResult(
        `Draft layout updated for job ${jobId}. ${basename} → ${targetLocales.join(", ")}. ` +
          "No revision was created. Use view_app_screenshot to preview, then save_screenshot_revision when ready.",
      );
    },
    {
      action: "mcp.update_screenshot_layout",
      summarize: (args) => ({
        summary: `Updated layout for ${args.basename} in job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );

  registerMutatingTool(
    server,
    userId,
    "upload_screenshot_overlay_asset",
    {
      description:
        "Upload an image once so it can be placed as an overlay on many screenshots and locales without " +
        "resending the image data each time. Returns an assetId — pass it to add_screenshot_overlay's assetId " +
        "field instead of imageDataUrl/imageUrl on every subsequent call for this job.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        imageDataUrl: z
          .string()
          .optional()
          .describe(
            "The image as a data URL, e.g. 'data:image/png;base64,iVBORw0KG...'. PNG, JPEG, or WebP, under 6 MB. " +
              "Provide this or imageUrl, not both.",
          ),
        imageUrl: z
          .string()
          .optional()
          .describe("A public http(s) URL to fetch the image from, as an alternative to imageDataUrl."),
      },
    },
    async (args: { jobId: string; imageDataUrl?: string; imageUrl?: string }) => {
      const { jobId, imageDataUrl, imageUrl } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      if ((imageDataUrl ? 1 : 0) + (imageUrl ? 1 : 0) !== 1) {
        return textResult("Provide exactly one of imageDataUrl or imageUrl.");
      }

      const overlay = imageUrl
        ? await saveStudioOverlayFromUrl(jobId, imageUrl)
        : await saveStudioOverlay(jobId, imageDataUrl);

      return textResult(
        `Uploaded. assetId "${overlay.id}". Pass this as assetId to add_screenshot_overlay to place it on any ` +
          "number of screenshots in this job without resending the image.",
      );
    },
    {
      action: "mcp.upload_screenshot_overlay_asset",
      summarize: (args) => ({
        summary: `Uploaded overlay asset for job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );

  registerMutatingTool(
    server,
    userId,
    "add_screenshot_overlay",
    {
      description:
        "Add an image overlay (sticker, badge, extra graphic, etc.) on top of one or more screenshots and " +
        "update the shared Studio draft, without rendering or creating revisions. Call save_screenshot_revision explicitly when ready. Applies to every locale that has each screenshot unless you " +
        "pass locales. Supply the image as imageDataUrl (base64), imageUrl (a public http(s) URL, fetched " +
        "server-side), or assetId (from upload_screenshot_overlay_asset or a previous add_screenshot_overlay " +
        "call) — assetId is the cheapest way to place the same image on many screenshots. Use " +
        "get_screenshot_studio_overview first to see each screenshot's nativeSize, and view_app_screenshot " +
        "afterwards to confirm the result. The response has two different ids, don't mix them up: an assetId " +
        "(the uploaded image file — reuse it via the assetId field on later calls) and one overlayId per " +
        "screenshot it was placed on (each placement is independent — pass that exact basename + overlayId to " +
        "update_screenshot_overlay / delete_screenshot_overlay; the same assetId placed on 5 screenshots " +
        "produces 5 different overlayIds).",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z
          .string()
          .optional()
          .describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview). Use this or basenames."),
        basenames: z
          .array(z.string())
          .max(50)
          .optional()
          .describe("Multiple screenshot filenames to place the same overlay on in one call. Use this or basename."),
        locales: z
          .array(z.string()).min(1)
          .optional()
          .describe("Locales to apply to, e.g. ['en-US']. Defaults to every locale that has each screenshot."),
        imageDataUrl: z
          .string()
          .optional()
          .describe(
            "The overlay image as a data URL, e.g. 'data:image/png;base64,iVBORw0KG...'. PNG, JPEG, or WebP, " +
              "under 6 MB. Provide exactly one of imageDataUrl, imageUrl, or assetId.",
          ),
        imageUrl: z
          .string()
          .optional()
          .describe("A public http(s) URL to fetch the overlay image from, as an alternative to imageDataUrl."),
        assetId: z
          .string()
          .optional()
          .describe(
            "Reuse an already-uploaded image instead of resending it — from upload_screenshot_overlay_asset or " +
              "the id returned by a previous add_screenshot_overlay call on this job.",
          ),
        x: z
          .number()
          .optional()
          .describe(
            "Overlay center X in pixels, same coordinate space as each screenshot's native size (origin top-left). " +
              "Defaults to that screenshot's horizontal center.",
          ),
        y: z
          .number()
          .optional()
          .describe(
            "Overlay center Y in pixels, same coordinate space as each screenshot's native size (origin top-left). " +
              "Defaults to that screenshot's vertical center.",
          ),
        scale: z.number().optional().describe("Overlay scale multiplier, 1 = the image's native size. Default 1."),
        rotation: z.number().optional().describe("Overlay rotation in degrees, -180..180. Default 0."),
      },
    },
    async (args: {
      jobId: string;
      basename?: string;
      basenames?: string[];
      locales?: string[];
      imageDataUrl?: string;
      imageUrl?: string;
      assetId?: string;
      x?: number;
      y?: number;
      scale?: number;
      rotation?: number;
    }) => {
      const { jobId, locales } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const basenames = args.basenames && args.basenames.length > 0 ? args.basenames : args.basename ? [args.basename] : [];

      if (basenames.length === 0) {
        return textResult("Provide basename or basenames.");
      }

      const sourceCount = (args.imageDataUrl ? 1 : 0) + (args.imageUrl ? 1 : 0) + (args.assetId ? 1 : 0);

      if (sourceCount !== 1) {
        return textResult("Provide exactly one of imageDataUrl, imageUrl, or assetId.");
      }

      let overlay: { id: string; url: string };

      if (args.assetId) {
        const url = await overlayAssetExists(jobId, args.assetId);

        if (!url) {
          return textResult(
            `Overlay asset "${args.assetId}" not found for job ${jobId}. Upload it first with ` +
              "upload_screenshot_overlay_asset.",
          );
        }

        overlay = { id: args.assetId, url };
      } else if (args.imageUrl) {
        overlay = await saveStudioOverlayFromUrl(jobId, args.imageUrl);
      } else {
        overlay = await saveStudioOverlay(jobId, args.imageDataUrl);
      }

      const placed: string[] = [];
      const skipped: string[] = [];

      for (const basename of basenames) {
        let x = args.x;
        let y = args.y;

        if (x === undefined || y === undefined) {
          const size = await studioRawImageSize(jobId, basename);

          if (!size) {
            skipped.push(`${basename} (no native size, pass x/y explicitly)`);
            continue;
          }

          x = x ?? size.w / 2;
          y = y ?? size.h / 2;
        }

        const placementId = crypto.randomUUID();

        try {
          const { targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
            const existing = Array.isArray(current.overlays) ? current.overlays : [];
            const merged = normalizeStudioOverlays([
              ...existing,
              { id: placementId, url: overlay.url, x, y, scale: args.scale ?? 1, rotation: args.rotation ?? 0 },
            ]);
            const next = { ...current };

            if (merged.length > 0) next.overlays = merged;
            else delete next.overlays;

            return next;
          }, userId);

          placed.push(`${basename} (overlayId "${placementId}", locales: ${targetLocales.join(", ")})`);
        } catch (err) {
          skipped.push(`${basename} (${(err as Error).message})`);
        }
      }

      if (placed.length === 0) {
        return textResult(`Overlay uploaded (assetId "${overlay.id}") but could not be placed. ${skipped.join("; ")}`);
      }

      return textResult(
        `Overlay placed, assetId "${overlay.id}" (reuse this with add_screenshot_overlay's assetId field for more ` +
          "screenshots without resending the image). Each screenshot below got its own overlayId — use that " +
          "with basename when calling update_screenshot_overlay / delete_screenshot_overlay, since the same " +
          "assetId can be placed on many screenshots independently. " +
          `Draft updated for job ${jobId}. Placed on: ${placed.join("; ")}. No revision was created.` +
          (skipped.length > 0 ? ` Skipped: ${skipped.join("; ")}.` : "") +
          " Use view_app_screenshot to see the result.",
      );
    },
    {
      action: "mcp.add_screenshot_overlay",
      summarize: (args) => ({
        summary: `Added overlay to ${args.basenames?.join(", ") ?? args.basename ?? "screenshot"} in job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );

  registerMutatingTool(
    server,
    userId,
    "update_screenshot_overlay",
    {
      description:
        "Reposition, rescale, or rotate an existing image overlay on one screenshot as a " +
        "draft edit, without rendering or creating a revision. Call save_screenshot_revision explicitly when ready. Only the fields you pass are changed. Use get_screenshot_studio_overview to find the " +
        "overlay's id under that shot's layout.overlays.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        overlayId: z.string().describe("The overlay's id, from get_screenshot_studio_overview or add_screenshot_overlay."),
        locales: z
          .array(z.string()).min(1)
          .optional()
          .describe("Locales to apply to, e.g. ['en-US']. Defaults to every locale that has this screenshot."),
        x: z.number().optional().describe("New overlay center X in pixels (native screenshot coordinate space)."),
        y: z.number().optional().describe("New overlay center Y in pixels (native screenshot coordinate space)."),
        scale: z.number().optional().describe("New overlay scale multiplier, 1 = the image's native size."),
        rotation: z.number().optional().describe("New overlay rotation in degrees, -180..180."),
      },
    },
    async (args: {
      jobId: string;
      basename: string;
      overlayId: string;
      locales?: string[];
      x?: number;
      y?: number;
      scale?: number;
      rotation?: number;
    }) => {
      const { jobId, basename, overlayId, locales } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const { targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const existing = Array.isArray(current.overlays) ? current.overlays : [];
        const index = existing.findIndex((overlay) => overlay.id === overlayId);

        if (index === -1) throw new Error(`Overlay "${overlayId}" not found on "${basename}".`);

        const prev = existing[index];
        const updated = [...existing];

        updated[index] = {
          ...prev,
          x: args.x ?? prev.x,
          y: args.y ?? prev.y,
          scale: args.scale ?? prev.scale,
          rotation: args.rotation ?? prev.rotation,
        };

        const next = { ...current, overlays: normalizeStudioOverlays(updated) };

        return next;
      }, userId);

      return textResult(
        `Draft overlay "${overlayId}" updated for job ${jobId}. ${basename} → ${targetLocales.join(", ")}. ` +
          "No revision was created. Preview with view_app_screenshot; save with save_screenshot_revision.",
      );
    },
    {
      action: "mcp.update_screenshot_overlay",
      summarize: (args) => ({
        summary: `Updated overlay ${args.overlayId} on ${args.basename} in job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_screenshot_overlay",
    {
      description:
        "Remove an image overlay from one screenshot in the shared Studio draft, without rendering or creating revisions. Call save_screenshot_revision explicitly when ready. The underlying " +
        "uploaded image is retained for other languages, earlier revisions and reuse — the same " +
        "assetId can be placed on several screenshots independently, via add_screenshot_overlay's basenames field " +
        "or repeated calls.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        overlayId: z.string().describe("The overlay's id, from get_screenshot_studio_overview or add_screenshot_overlay."),
        locales: z
          .array(z.string()).min(1)
          .optional()
          .describe("Locales to apply to, e.g. ['en-US']. Defaults to every locale that has this screenshot."),
      },
    },
    async (args: { jobId: string; basename: string; overlayId: string; locales?: string[] }) => {
      const { jobId, basename, overlayId, locales } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      const before = await getStudioWorkspace(jobId);
      const removedOverlay = before.locales
        .filter((locale) => !locales || locales.includes(locale.locale))
        .flatMap((locale) => locale.styles[basename]?.overlays ?? [])
        .find((overlay) => overlay.id === overlayId);

      if (!removedOverlay) {
        return textResult(`Overlay "${overlayId}" not found on "${basename}".`);
      }

      const { targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const existing = Array.isArray(current.overlays) ? current.overlays : [];
        const remaining = existing.filter((overlay) => overlay.id !== overlayId);
        const next = { ...current };

        if (remaining.length > 0) next.overlays = remaining;
        else delete next.overlays;

        return next;
      }, userId);

      return textResult(
        `Draft overlay "${overlayId}" removed for job ${jobId}. ${basename} → ${targetLocales.join(", ")}. No revision was created.` +
          " The uploaded image was retained for reuse and earlier revisions.",
      );
    },
    {
      action: "mcp.delete_screenshot_overlay",
      summarize: (args) => ({
        summary: `Removed overlay ${args.overlayId} from ${args.basename} in job ${args.jobId}`,
        entityType: "ScreenshotJob",
        entityId: args.jobId,
      }),
    },
  );
}
