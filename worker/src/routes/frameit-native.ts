import sharp from "sharp";
import { clipped, fitTitleToBox, renderLine, TITLE_BASE_SIZE, TITLE_LINE_HEIGHT, TRIPLE_DENSITY_SIZES } from "./frameit-shift";
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
  baseFontSize: number = TITLE_BASE_SIZE,
): Promise<TitleLayer | null> {
  const trimmed = text.trim();

  if (!trimmed) return null;

  const fitted = await fitTitleToBox({
    text: trimmed,
    fontPath,
    textColor,
    maxWidth,
    maxHeight,
    baseFontSize,
    tmpDir,
  });

  if (!fitted.fits) {
    console.warn(`[frameit] title still overflows its box at minimum font size: "${trimmed}"`);
  }

  const step = fitted.fontSize * TITLE_LINE_HEIGHT;
  const rendered: Array<{ ink: { buf: Buffer; w: number; h: number }; lineIndex: number }> = [];

  for (let i = 0; i < fitted.lines.length; i++) {
    const ink = await renderLine(fitted.lines[i], fontPath, textColor, fitted.fontSize, tmpDir);

    if (ink) rendered.push({ ink, lineIndex: i });
  }

  if (rendered.length === 0) return null;

  const blockW = Math.ceil(Math.max(...rendered.map((r) => r.ink.w)));
  const blockH = Math.round(fitted.lines.length * step);

  const composites = rendered.map(({ ink, lineIndex }) => ({
    input: ink.buf,
    left: Math.round(blockW / 2 - ink.w / 2),
    top: Math.round(lineIndex * step + (step - ink.h) / 2),
  }));

  const buf = await sharp({
    create: { width: blockW, height: blockH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buf, w: blockW, h: blockH };
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
  titleBaseFontSize?: number;
}

export async function renderBaseFrame(params: RenderBaseFrameParams): Promise<Buffer> {
  const { screenshot, work, layout, title, textColor, fontPath, background, device, bezel, tmpDir, titleBaseFontSize } =
    params;

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

  const titleLayer = await renderTitleLayer(title, fontPath, textColor, frameWidth, space, tmpDir, titleBaseFontSize);

  if (titleLayer) {
    const left = Math.round(work.w / 2 - titleLayer.w / 2);
    const bandCenterY = bandY + space / 2;
    const top = Math.round(bandCenterY - titleLayer.h / 2);
    const titlePlaced = await clipped(titleLayer.buf, left, top, work.w, work.h);

    if (titlePlaced) layers.push(titlePlaced);
  }

  return sharp(background).composite(layers).png().toBuffer();
}
