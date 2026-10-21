import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execAsync } from "./shared";
import { clipped, cropToInk, resolveMagickBin, TITLE_BASE_SIZE, TRIPLE_DENSITY_SIZES } from "./frameit-shift";
import type { FrameitDevice } from "./frameit-devices";

export type NativeLayout = "center" | "top" | "bottom";

export function frameitPad(work: { w: number; h: number }): number {
  return TRIPLE_DENSITY_SIZES.has(`${work.w}x${work.h}`) ? 85 : 50;
}

export function frameitSpace(work: { w: number; h: number }): number {
  return frameitPad(work) * 2 + TITLE_BASE_SIZE;
}

const SCREEN_CORNER_RADIUS = 100;

async function applyRoundedScreenCorners(screenshot: Buffer, width: number, height: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect width="${width}" height="${height}" rx="${SCREEN_CORNER_RADIUS}" ry="${SCREEN_CORNER_RADIUS}" fill="#fff"/>
    </svg>`,
  );

  return sharp(screenshot)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export async function renderDeviceLayer(
  screenshot: Buffer,
  device: FrameitDevice,
  bezel: Buffer,
): Promise<Buffer> {
  const bezelMeta = await sharp(bezel).metadata();
  const bezelW = bezelMeta.width ?? device.width;
  const bezelH = bezelMeta.height ?? device.width;

  const screenshotMeta = await sharp(screenshot).metadata();
  const resized =
    screenshotMeta.width === device.width
      ? screenshot
      : await sharp(screenshot).resize({ width: device.width }).png().toBuffer();

  const resizedMeta = resized === screenshot ? screenshotMeta : await sharp(resized).metadata();
  const resizedScreenshot = device.roundedScreenCorners
    ? await applyRoundedScreenCorners(resized, resizedMeta.width ?? device.width, resizedMeta.height ?? 0)
    : resized;

  return sharp({
    create: { width: bezelW, height: bezelH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: resizedScreenshot, left: device.offsetX, top: device.offsetY },
      { input: bezel, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

interface TitleLayer {
  buf: Buffer;
  w: number;
  h: number;
}

async function renderTitleLayer(
  text: string,
  fontPath: string,
  textColor: string,
  maxWidth: number,
  maxHeight: number,
  tmpDir: string,
): Promise<TitleLayer | null> {
  const trimmed = text.trim();

  if (!trimmed) return null;

  const bin = await resolveMagickBin();
  const lineFile = path.join(tmpDir, `basetitle-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const pngFile = path.join(tmpDir, `basetitle-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(lineFile, text, "utf8");
  await execAsync(
    `"${bin}" -background none -fill "${textColor}" -font "${fontPath}" -pointsize ${TITLE_BASE_SIZE} "label:@${lineFile}" "${pngFile}"`,
  );

  const rendered = await fs.promises.readFile(pngFile);
  const ink = await cropToInk(rendered);

  if (!ink) return null;

  const ratioH = ink.w / maxWidth;
  const ratioV = ink.h / maxHeight;

  if (ratioH <= 1 && ratioV <= 1) return { buf: ink.buf, w: ink.w, h: ink.h };

  const scale = 1 / Math.max(ratioH, ratioV);
  const w = Math.max(1, Math.round(ink.w * scale));
  const h = Math.max(1, Math.round(ink.h * scale));
  const resized = await sharp(ink.buf).resize(w, h).png().toBuffer();

  return { buf: resized, w, h };
}

export interface RenderBaseFrameParams {
  screenshot: Buffer;
  work: { w: number; h: number };
  layout: NativeLayout;
  title: string;
  textColor: string;
  fontPath: string;
  background: Buffer;
  device: FrameitDevice;
  bezel: Buffer;
  tmpDir: string;
}

export async function renderBaseFrame(params: RenderBaseFrameParams): Promise<Buffer> {
  const { screenshot, work, layout, title, textColor, fontPath, background, device, bezel, tmpDir } = params;

  const pad = frameitPad(work);
  const space = frameitSpace(work);
  const bandY = layout === "bottom" ? work.h - space : 0;

  const deviceLayer = await renderDeviceLayer(screenshot, device, bezel);
  const deviceMeta = await sharp(deviceLayer).metadata();
  const devW = deviceMeta.width ?? device.width;
  const devH = deviceMeta.height ?? device.width;

  const frameWidth = work.w - pad * 2;
  const fw = frameWidth < devW ? frameWidth / devW : 1;
  const resizedW = Math.round(devW * fw);
  const resizedH = Math.round(devH * fw);
  const resizedDevice = fw === 1 ? deviceLayer : await sharp(deviceLayer).resize(resizedW, resizedH).png().toBuffer();

  const homeX = Math.round(work.w / 2 - resizedW / 2);
  const homeY = layout === "bottom" ? work.h - space - resizedH : space;

  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  const devicePlaced = await clipped(resizedDevice, homeX, homeY, work.w, work.h);

  if (devicePlaced) layers.push(devicePlaced);

  const titleLayer = await renderTitleLayer(title, fontPath, textColor, frameWidth, space, tmpDir);

  if (titleLayer) {
    const left = Math.round(work.w / 2 - titleLayer.w / 2);
    const bandCenterY = bandY + space / 2;
    const top = Math.round(bandCenterY - titleLayer.h / 2);
    const titlePlaced = await clipped(titleLayer.buf, left, top, work.w, work.h);

    if (titlePlaced) layers.push(titlePlaced);
  }

  return sharp(background).composite(layers).png().toBuffer();
}
