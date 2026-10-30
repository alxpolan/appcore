import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { prisma } from "../../config";
import { workerClient } from "../worker-client";

const OVERLAY_MAX_BYTES = 6 * 1024 * 1024;
const BEZEL_SLOT_RETRIES = 3;

export interface StudioBezelOption {
  file: string;
  color: string;
  frameW: number;
  frameH: number;
}

export interface StudioBezelDevice {
  offsetX: number;
  offsetY: number;
  width: number;
  rounded: boolean;
}

export interface StudioOverlayFile {
  id: string;
  url: string;
}

function assertStudioJobId(jobId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(jobId)) throw new Error("Invalid job");
}

export async function listShotBezels(
  jobId: string,
  basename: string,
): Promise<{ current: string | null; options: StudioBezelOption[]; device: StudioBezelDevice | null }> {
  assertStudioJobId(jobId);

  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/i.test(basename) || basename.includes("..")) {
    throw new Error("Invalid screenshot name");
  }

  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const rawRoot = path.join(process.cwd(), "screenshots", jobId, "raw");
  const locales = await fs.promises.readdir(rawRoot).catch(() => [] as string[]);

  for (const locale of locales) {
    let dims: { w: number; h: number } | null = null;

    try {
      const meta = await sharp(path.join(rawRoot, locale, basename)).metadata();

      if (meta.width && meta.height) dims = { w: meta.width, h: meta.height };
    } catch {
      continue;
    }

    if (!dims) continue;

    let lastError: unknown = new Error("Frame service unavailable");

    for (let attempt = 0; attempt < BEZEL_SLOT_RETRIES; attempt++) {
      try {
        const result = await workerClient.frameitBezels(basename, dims.w, dims.h);

        if (!result || result.ok === false || !Array.isArray(result.options)) {
          lastError = new Error(
            typeof result?.error === "string" && result.error.length > 0 ? result.error : "Frame service unavailable",
          );
          continue;
        }

        const options = result.options
          .filter((option) => typeof option?.file === "string" && typeof option?.color === "string")
          .map((option) => ({
            file: option.file,
            color: option.color,
            frameW: Number.isFinite(option.frameW) ? option.frameW : 0,
            frameH: Number.isFinite(option.frameH) ? option.frameH : 0,
          }));
        const rawDevice = result.device;
        const device =
          rawDevice &&
          Number.isFinite(rawDevice.offsetX) &&
          Number.isFinite(rawDevice.offsetY) &&
          Number.isFinite(rawDevice.width) &&
          rawDevice.width > 0
            ? {
                offsetX: rawDevice.offsetX,
                offsetY: rawDevice.offsetY,
                width: rawDevice.width,
                rounded: rawDevice.rounded !== false,
              }
            : null;

        return { current: result.current ?? null, options, device };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Frame service unavailable");
  }

  throw new Error("No editable source stored for this screenshot");
}

export async function getFrameBezelImage(file: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.'()\-]*\.png$/i.test(file) || file.includes("..")) {
    throw new Error("Invalid bezel file");
  }

  let lastError: unknown = new Error("Bezel image unavailable");

  for (let attempt = 0; attempt < BEZEL_SLOT_RETRIES; attempt++) {
    try {
      return await workerClient.frameitBezelImage(file);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Bezel image unavailable");
}

export async function saveStudioOverlay(jobId: string, dataUrl: unknown): Promise<StudioOverlayFile> {
  assertStudioJobId(jobId);

  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  if (typeof dataUrl !== "string") throw new Error("Image data is required");

  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());

  if (!match) throw new Error("Expected a PNG, JPEG or WebP data URL image");

  const buf = Buffer.from(match[2], "base64");

  if (buf.length === 0 || buf.length > OVERLAY_MAX_BYTES) throw new Error("Image must be smaller than 6 MB");

  try {
    await sharp(buf).metadata();
  } catch {
    throw new Error("Could not read image data");
  }

  const png = await sharp(buf).png().toBuffer();
  const id = crypto.randomUUID();
  const dir = path.join(process.cwd(), "screenshots", jobId, "overlays");

  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, `${id}.png`), png);

  return { id, url: `/screenshots/${jobId}/overlays/${id}.png` };
}

export async function deleteStudioOverlay(jobId: string, overlayId: string): Promise<void> {
  assertStudioJobId(jobId);

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(overlayId)) throw new Error("Invalid overlay");

  await fs.promises.rm(path.join(process.cwd(), "screenshots", jobId, "overlays", `${overlayId}.png`), {
    force: true,
  });
}

export async function duplicateStudioOverlay(jobId: string, overlayId: string): Promise<StudioOverlayFile> {
  assertStudioJobId(jobId);

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(overlayId)) throw new Error("Invalid overlay");

  const job = await prisma.screenshotJob.findUnique({ where: { id: jobId }, select: { id: true } });

  if (!job) throw new Error(`Screenshot job ${jobId} not found`);

  const source = path.join(process.cwd(), "screenshots", jobId, "overlays", `${overlayId}.png`);

  try {
    await fs.promises.access(source);
  } catch {
    throw new Error("Overlay not found");
  }

  const id = crypto.randomUUID();

  await fs.promises.copyFile(source, path.join(process.cwd(), "screenshots", jobId, "overlays", `${id}.png`));

  return { id, url: `/screenshots/${jobId}/overlays/${id}.png` };
}
