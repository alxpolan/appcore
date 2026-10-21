import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execAsync } from "./shared";

export type ShiftFrameLayout = "center" | "top" | "bottom";

export interface ShiftFrameContext {
  framed: Buffer;
  work: { w: number; h: number };
  layout: ShiftFrameLayout;
  offset: { x: number; y: number };
  titleOffset: { x: number; y: number };
  titleScale: number;
  deviceScale: number;
  titleBoxW: number;
  titleBoxH: number;
  titleLines: string[];
  title: string;
  fontPath: string;
  tmpDir: string;
  textColor: string;
  gradient: Buffer;
  deviceLayer: Buffer | undefined;
}

export const TITLE_BASE_SIZE = 150;
export const TITLE_LINE_HEIGHT = 1.2;

let magickBin: string | null = null;

export async function resolveMagickBin(): Promise<string> {
  if (magickBin) return magickBin;

  try {
    await execAsync("command -v magick");
    magickBin = "magick";
  } catch {
    magickBin = "convert";
  }

  return magickBin;
}

export const TRIPLE_DENSITY_SIZES = new Set([
  "1320x2868",
  "1290x2796",
  "1242x2688",
  "1206x2622",
  "1242x2208",
  "1179x2556",
]);

export function parseHexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());

  if (!match) return [255, 255, 255];

  const hex = match[1];

  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

async function extractTitleLayer(
  framed: Buffer,
  gradient: Buffer,
  work: { w: number; h: number },
  bandY: number,
  space: number,
  textColor: string,
  scale: number,
): Promise<Buffer> {
  const flat = await sharp(framed)
    .extract({ left: 0, top: bandY, width: work.w, height: space })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pure = await sharp(gradient)
    .extract({ left: 0, top: bandY, width: work.w, height: space })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [cr, cg, cb] = parseHexColor(textColor);
  const out = Buffer.alloc(work.w * space * 4);

  for (let i = 0; i < work.w * space; i++) {
    const o = i * flat.info.channels;
    const p = i * pure.info.channels;
    const channels: Array<[number, number, number]> = [
      [flat.data[o], pure.data[p], cr],
      [flat.data[o + 1], pure.data[p + 1], cg],
      [flat.data[o + 2], pure.data[p + 2], cb],
    ];

    let num = 0;
    let den = 0;

    for (const [observed, ground, ink] of channels) {
      const spread = Math.abs(ink - ground);

      if (spread > Math.abs(den)) {
        num = observed - ground;
        den = ink - ground;
      }
    }

    const alpha = Math.abs(den) < 8 ? 0 : Math.max(0, Math.min(1, num / den));
    out[i * 4] = cr;
    out[i * 4 + 1] = cg;
    out[i * 4 + 2] = cb;
    out[i * 4 + 3] = Math.round(alpha * 255);
  }

  const rgba = sharp(out, { raw: { width: work.w, height: space, channels: 4 } });

  if (scale === 1) return rgba.png().toBuffer();

  return rgba
    .resize(Math.max(1, Math.round(work.w * scale)), Math.max(1, Math.round(space * scale)))
    .png()
    .toBuffer();
}

export async function clipped(
  layer: Buffer,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<{ input: Buffer; left: number; top: number } | null> {
  const meta = await sharp(layer).metadata();
  const lw = meta.width ?? w;
  const lh = meta.height ?? h;
  const visX0 = Math.max(0, x);
  const visY0 = Math.max(0, y);
  const visX1 = Math.min(w, x + lw);
  const visY1 = Math.min(h, y + lh);

  if (visX1 <= visX0 || visY1 <= visY0) return null;

  const visible = await sharp(layer)
    .extract({ left: visX0 - x, top: visY0 - y, width: visX1 - visX0, height: visY1 - visY0 })
    .toBuffer();

  return { input: visible, left: visX0, top: visY0 };
}

export async function cropToInk(buf: Buffer): Promise<{ buf: Buffer; w: number; h: number } | null> {
  const raw = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = raw.info.width;
  const h = raw.info.height;
  const ch = raw.info.channels;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw.data[(y * w + x) * ch + ch - 1] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < x0 || y1 < y0) return null;

  const cropped = await sharp(buf)
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .toBuffer();

  return { buf: cropped, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface LineClip {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clipLineToBox(
  inkW: number,
  inkH: number,
  x: number,
  y: number,
  boxLeft: number,
  boxTop: number,
  boxW: number,
  boxH: number,
): LineClip | null {
  const visX0 = Math.max(boxLeft, x);
  const visY0 = Math.max(boxTop, y);
  const visX1 = Math.min(boxLeft + boxW, x + inkW);
  const visY1 = Math.min(boxTop + boxH, y + inkH);

  if (visX1 <= visX0 || visY1 <= visY0) return null;

  const left = Math.max(0, Math.min(inkW, Math.round(visX0 - x)));
  const top = Math.max(0, Math.min(inkH, Math.round(visY0 - y)));
  const width = Math.max(0, Math.min(inkW - left, Math.round(visX1 - visX0)));
  const height = Math.max(0, Math.min(inkH - top, Math.round(visY1 - visY0)));

  if (width < 1 || height < 1) return null;

  return { left, top, width, height };
}

async function renderBoxTitle(
  ctx: ShiftFrameContext,
  work: { w: number; h: number },
  bandCenterY: number,
): Promise<Array<{ input: Buffer; left: number; top: number }>> {
  const lines = ctx.titleLines.length > 0 ? ctx.titleLines : [ctx.title];
  const size = TITLE_BASE_SIZE * ctx.titleScale;
  const step = size * TITLE_LINE_HEIGHT;
  const boxH = ctx.titleBoxH > 0 ? ctx.titleBoxH : lines.length * step;
  const boxTop = bandCenterY - boxH / 2 + ctx.titleOffset.y;
  const cx = work.w / 2 + ctx.titleOffset.x;
  const boxLeft = cx - ctx.titleBoxW / 2;
  const bin = await resolveMagickBin();
  const placed: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const lineFile = path.join(ctx.tmpDir, `boxtitle-${Date.now()}-${i}.txt`);
    const pngFile = path.join(ctx.tmpDir, `boxtitle-${Date.now()}-${i}.png`);
    fs.writeFileSync(lineFile, lines[i], "utf8");
    await execAsync(
      `"${bin}" -background none -fill "${ctx.textColor}" -font "${ctx.fontPath}" -pointsize ${size} "label:@${lineFile}" "${pngFile}"`,
    );

    const lineBuf = await fs.promises.readFile(pngFile);
    const ink = await cropToInk(lineBuf);

    if (!ink) continue;

    const x = Math.round(cx - ink.w / 2);
    const y = Math.round(boxTop + i * step + (step - ink.h) / 2);
    const clip = clipLineToBox(ink.w, ink.h, x, y, boxLeft, boxTop, ctx.titleBoxW, boxH);

    if (!clip) continue;

    const visible = await sharp(ink.buf).extract(clip).toBuffer();
    placed.push({ input: visible, left: x + clip.left, top: y + clip.top });
  }

  return placed;
}

export async function recompositeShiftedFrame(ctx: ShiftFrameContext): Promise<Buffer> {
  const { framed, work, layout, offset, titleOffset, titleScale, deviceScale } = ctx;
  const boxMode = ctx.titleBoxW > 0;
  const moveDevice = offset.x !== 0 || offset.y !== 0 || deviceScale !== 1;
  const moveTitle = titleOffset.x !== 0 || titleOffset.y !== 0 || titleScale !== 1 || boxMode;

  if (!moveDevice && !moveTitle) return framed;

  const pad = TRIPLE_DENSITY_SIZES.has(`${work.w}x${work.h}`) ? 85 : 50;
  const space = pad + 150 + pad;
  const bandY = layout === "bottom" ? work.h - space : 0;
  const bandCenterY = bandY + space / 2;
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];

  if (!moveDevice && boxMode && !ctx.deviceLayer) {
    const restY = layout === "bottom" ? 0 : bandY + space;
    const restH = work.h - space;
    const rest = await sharp(framed)
      .extract({ left: 0, top: restY, width: work.w, height: restH })
      .toBuffer();
    layers.push({ input: rest, left: 0, top: restY });
  }

  if (moveTitle && boxMode) {
    const boxLayers = await renderBoxTitle(ctx, work, bandCenterY);

    for (const layer of boxLayers) {
      const safe = await clipped(layer.input, layer.left, layer.top, work.w, work.h);

      if (safe) layers.push(safe);
    }
  } else if (moveTitle) {
    const text = await extractTitleLayer(framed, ctx.gradient, work, bandY, space, ctx.textColor, titleScale);
    const textMeta = await sharp(text).metadata();
    const textW = textMeta.width ?? work.w;
    const textH = textMeta.height ?? space;
    const placed = await clipped(
      text,
      Math.round(work.w / 2 - textW / 2 + titleOffset.x),
      Math.round(bandY + space / 2 - textH / 2 + titleOffset.y),
      work.w,
      work.h,
    );

    if (placed) layers.push(placed);
  } else {
    const titleBand = await sharp(framed)
      .extract({ left: 0, top: bandY, width: work.w, height: space })
      .toBuffer();
    layers.push({ input: titleBand, left: 0, top: bandY });
  }

  const placeDevice = async (k: number, ox: number, oy: number): Promise<void> => {
    const device = ctx.deviceLayer;

    if (!device) return;

    const deviceMeta = await sharp(device).metadata();
    const devW = deviceMeta.width ?? work.w;
    const devH = deviceMeta.height ?? work.h;
    const frameWidth = work.w - pad * 2;
    const fw = frameWidth < devW ? frameWidth / devW : 1;
    const imgW = Math.round(devW * fw * k);
    const imgH = Math.round(devH * fw * k);
    const homeX = (work.w - devW * fw) / 2;
    const homeY = layout === "bottom" ? work.h - space - devH * fw : space;
    const imgX = Math.round(homeX + ((devW * fw - imgW) / 2 + ox));
    const imgY = Math.round(homeY + ((devH * fw - imgH) / 2 + oy));
    const resizedDevice = await sharp(device).resize(imgW, imgH).png().toBuffer();
    const placed = await clipped(resizedDevice, imgX, imgY, work.w, work.h);

    if (placed) layers.push(placed);
  };

  if (moveDevice) {
    if (!ctx.deviceLayer) return framed;

    await placeDevice(deviceScale, offset.x, offset.y);
  } else if (boxMode) {
    await placeDevice(1, 0, 0);
  } else {
    const restY = layout === "bottom" ? 0 : bandY + space;
    const restH = work.h - space;
    const rest = await sharp(framed)
      .extract({ left: 0, top: restY, width: work.w, height: restH })
      .toBuffer();
    layers.push({ input: rest, left: 0, top: restY });
  }

  return sharp(ctx.gradient).composite(layers).png().toBuffer();
}
