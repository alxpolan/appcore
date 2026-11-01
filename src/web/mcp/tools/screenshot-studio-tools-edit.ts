import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  deleteStudioOverlay,
  getEffectiveFramed,
  getStudioData,
  normalizeDeviceScale,
  normalizeRotation,
  normalizeStudioOffset,
  normalizeStudioOverlays,
  normalizeTitleBoxSize,
  normalizeTitleScale,
  renderStudioRevision,
  saveStudioOverlay,
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
) {
  const data = await getStudioData(jobId);
  const effective = await getEffectiveFramed(jobId);

  const available = Object.keys(effective.framedByLocale).filter((locale) =>
    (effective.framedByLocale[locale] ?? []).some((url) => studioBasename(url) === basename),
  );

  if (available.length === 0) throw new Error(`No screenshot "${basename}" found in any locale for job ${jobId}.`);

  const targetLocales =
    locales && locales.length > 0 ? locales.filter((locale) => available.includes(locale)) : available;

  if (targetLocales.length === 0) throw new Error(`None of the requested locales have screenshot "${basename}".`);

  const stylesOut: Record<string, Partial<StudioStyle>> = { ...data.styles };
  const patched = mutate(stylesOut[basename] ?? {});

  if (Object.keys(patched).length > 0) stylesOut[basename] = patched;
  else delete stylesOut[basename];

  const localesPayload: Record<string, { titles: Record<string, string>; styles: Record<string, Partial<StudioStyle>> }> =
    {};

  for (const locale of targetLocales) {
    localesPayload[locale] = { titles: {}, styles: stylesOut };
  }

  const result = await renderStudioRevision({ jobId, style: data.style, locales: localesPayload });

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
        "device frame color, then re-render it as a new studio revision. Only the fields you pass are changed — " +
        "everything else (including any overlays already on the shot) is kept as-is. Applies to every locale that " +
        "has this screenshot unless you pass locales. Use get_screenshot_studio_overview first to see the current " +
        "layout and exact basename, list_screenshot_bezels to see valid deviceFrame values, and view_app_screenshot " +
        "afterwards to confirm the result.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        locales: z
          .array(z.string())
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
        args.titleBoxW !== undefined ||
        args.titleBoxH !== undefined ||
        args.titleRotation !== undefined ||
        args.deviceFrame !== undefined;

      if (!hasField) {
        return textResult("Provide at least one field to change.");
      }

      const { result, targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const next: Partial<StudioStyle> = { ...current };

        if (args.offsetX !== undefined) next.offsetX = normalizeStudioOffset(args.offsetX);
        if (args.offsetY !== undefined) next.offsetY = normalizeStudioOffset(args.offsetY);
        if (args.deviceScale !== undefined) next.deviceScale = normalizeDeviceScale(args.deviceScale);
        if (args.rotation !== undefined) next.rotation = normalizeRotation(args.rotation);
        if (args.titleOffsetX !== undefined) next.titleOffsetX = normalizeStudioOffset(args.titleOffsetX);
        if (args.titleOffsetY !== undefined) next.titleOffsetY = normalizeStudioOffset(args.titleOffsetY);
        if (args.titleScale !== undefined) next.titleScale = normalizeTitleScale(args.titleScale);
        if (args.titleBoxW !== undefined) next.titleBoxW = normalizeTitleBoxSize(args.titleBoxW);
        if (args.titleBoxH !== undefined) next.titleBoxH = normalizeTitleBoxSize(args.titleBoxH);
        if (args.titleRotation !== undefined) next.titleRotation = normalizeRotation(args.titleRotation);

        if (args.deviceFrame !== undefined) {
          if (args.deviceFrame.length === 0) delete next.deviceFrame;
          else next.deviceFrame = args.deviceFrame.slice(0, 120);
        }

        return next;
      });

      return textResult(
        `Layout updated. New studio revision rev${result.revision.rev} (${result.revision.id}) is now active for ` +
          `job ${jobId}. ${basename} → ${targetLocales.join(", ")}. Use view_app_screenshot to see the result.`,
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
    "add_screenshot_overlay",
    {
      description:
        "Add an image overlay (sticker, badge, extra graphic, etc.) on top of one screenshot and re-render it as " +
        "a new studio revision. Applies to every locale that has this screenshot unless you pass locales. Use " +
        "get_screenshot_studio_overview first to see the screenshot's nativeSize so you can place the overlay " +
        "sensibly, and view_app_screenshot afterwards to confirm the result. Returns the new overlay's id — keep " +
        "it to reposition or remove it later with update_screenshot_overlay / delete_screenshot_overlay.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        locales: z
          .array(z.string())
          .optional()
          .describe("Locales to apply to, e.g. ['en-US']. Defaults to every locale that has this screenshot."),
        imageDataUrl: z
          .string()
          .describe(
            "The overlay image as a data URL, e.g. 'data:image/png;base64,iVBORw0KG...'. PNG, JPEG, or WebP, under 6 MB.",
          ),
        x: z
          .number()
          .optional()
          .describe(
            "Overlay center X in pixels, same coordinate space as the screenshot's native size (origin top-left). " +
              "Defaults to the horizontal center of the screenshot.",
          ),
        y: z
          .number()
          .optional()
          .describe(
            "Overlay center Y in pixels, same coordinate space as the screenshot's native size (origin top-left). " +
              "Defaults to the vertical center of the screenshot.",
          ),
        scale: z.number().optional().describe("Overlay scale multiplier, 1 = the image's native size. Default 1."),
        rotation: z.number().optional().describe("Overlay rotation in degrees, -180..180. Default 0."),
      },
    },
    async (args: {
      jobId: string;
      basename: string;
      locales?: string[];
      imageDataUrl: string;
      x?: number;
      y?: number;
      scale?: number;
      rotation?: number;
    }) => {
      const { jobId, basename, locales, imageDataUrl } = args;
      const { job, app } = await loadJobWithAccess(userId, jobId);

      if (!job || !app) {
        return textResult(`Screenshot job not found: ${jobId}`);
      }

      let x = args.x;
      let y = args.y;

      if (x === undefined || y === undefined) {
        const size = await studioRawImageSize(jobId, basename);

        if (!size) {
          return textResult(
            `Could not determine the native size of "${basename}" to center the overlay. Provide x and y explicitly.`,
          );
        }

        x = x ?? size.w / 2;
        y = y ?? size.h / 2;
      }

      const overlay = await saveStudioOverlay(jobId, imageDataUrl);

      const { result, targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const existing = Array.isArray(current.overlays) ? current.overlays : [];
        const merged = normalizeStudioOverlays([
          ...existing,
          { id: overlay.id, url: overlay.url, x, y, scale: args.scale ?? 1, rotation: args.rotation ?? 0 },
        ]);
        const next = { ...current };

        if (merged.length > 0) next.overlays = merged;
        else delete next.overlays;

        return next;
      });

      return textResult(
        `Overlay added (id "${overlay.id}"). New studio revision rev${result.revision.rev} (${result.revision.id}) ` +
          `is now active for job ${jobId}. ${basename} → ${targetLocales.join(", ")}. Use view_app_screenshot to see ` +
          "the result.",
      );
    },
    {
      action: "mcp.add_screenshot_overlay",
      summarize: (args) => ({
        summary: `Added overlay to ${args.basename} in job ${args.jobId}`,
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
        "Reposition, rescale, or rotate an existing image overlay on one screenshot, then re-render it as a new " +
        "studio revision. Only the fields you pass are changed. Use get_screenshot_studio_overview to find the " +
        "overlay's id under that shot's layout.overlays.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        overlayId: z.string().describe("The overlay's id, from get_screenshot_studio_overview or add_screenshot_overlay."),
        locales: z
          .array(z.string())
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

      const { result, targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
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
      });

      return textResult(
        `Overlay "${overlayId}" updated. New studio revision rev${result.revision.rev} (${result.revision.id}) is ` +
          `now active for job ${jobId}. ${basename} → ${targetLocales.join(", ")}. Use view_app_screenshot to see ` +
          "the result.",
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
      description: "Remove an image overlay from one screenshot and re-render it as a new studio revision.",
      inputSchema: {
        jobId: z.string().describe("Screenshot job ID, from list_screenshot_jobs."),
        basename: z.string().describe("Screenshot filename, e.g. '01_Home.png' (from get_screenshot_studio_overview)."),
        overlayId: z.string().describe("The overlay's id, from get_screenshot_studio_overview or add_screenshot_overlay."),
        locales: z
          .array(z.string())
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

      const { result, targetLocales } = await applyShotStylePatch(jobId, basename, locales, (current) => {
        const existing = Array.isArray(current.overlays) ? current.overlays : [];

        if (!existing.some((overlay) => overlay.id === overlayId)) {
          throw new Error(`Overlay "${overlayId}" not found on "${basename}".`);
        }

        const remaining = existing.filter((overlay) => overlay.id !== overlayId);
        const next = { ...current };

        if (remaining.length > 0) next.overlays = remaining;
        else delete next.overlays;

        return next;
      });

      await deleteStudioOverlay(jobId, overlayId);

      return textResult(
        `Overlay "${overlayId}" removed. New studio revision rev${result.revision.rev} (${result.revision.id}) is ` +
          `now active for job ${jobId}. ${basename} → ${targetLocales.join(", ")}.`,
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
