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
  rotation: number;
  titleRotation: number;
}

export interface RotatedPlacement {
  input: Buffer;
  left: number;
  top: number;
}

export async function rotatedPlacement(
  input: Buffer,
  iw: number,
  ih: number,
  cx: number,
  cy: number,
  angleDeg: number,
): Promise<RotatedPlacement> {
  const norm = ((((angleDeg % 360) + 360) % 360) + 180) % 360 - 180;

  if (norm === 0) return { input, left: Math.round(cx - iw / 2), top: Math.round(cy - ih / 2) };

  const span = Math.ceil(Math.hypot(iw, ih));
  const canvas = await sharp({
    create: { width: span, height: span, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input, left: Math.round((span - iw) / 2), top: Math.round((span - ih) / 2) }])
    .png()
    .toBuffer();
  const spun = await sharp(canvas)
    .rotate(angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(spun).metadata();
  const w = meta.width ?? span;
  const h = meta.height ?? span;

  return { input: spun, left: Math.round(cx - w / 2), top: Math.round(cy - h / 2) };
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

export interface RenderedLine {
  buf: Buffer;
  w: number;
  h: number;
}

export async function renderLine(
  text: string,
  fontPath: string,
  textColor: string,
  fontSize: number,
  tmpDir: string,
): Promise<RenderedLine | null> {
  const bin = await resolveMagickBin();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lineFile = path.join(tmpDir, `line-${id}.txt`);
  const pngFile = path.join(tmpDir, `line-${id}.png`);

  fs.writeFileSync(lineFile, text, "utf8");
  await execAsync(
    `"${bin}" -background none -fill "${textColor}" -font "${fontPath}" -pointsize ${fontSize} "label:@${lineFile}" "${pngFile}"`,
  );

  const rendered = await fs.promises.readFile(pngFile);

  return cropToInk(rendered);
}

async function wrapWords(
  words: string[],
  fontPath: string,
  textColor: string,
  fontSize: number,
  maxWidth: number,
  tmpDir: string,
): Promise<string[]> {
  const lines: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(" ");
    const ink = await renderLine(candidate, fontPath, textColor, fontSize, tmpDir);
    const fitsWidth = !ink || ink.w <= maxWidth;

    if (fitsWidth || current.length === 0) {
      current.push(word);
      continue;
    }

    lines.push(current.join(" "));
    current = [word];
  }

  if (current.length > 0) lines.push(current.join(" "));

  return lines;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;

  let capped = 1;

  for (let i = 1; i <= k; i++) {
    capped = Math.min(201, Math.round((capped * (n - k + i)) / i));
  }

  return capped;
}

export function chooseBalancedLines(
  candidates: string[][],
  widthOf: (line: string) => number | null,
  maxWidth: number,
  fallback: string[],
): string[] {
  const fallbackWidths = fallback.map((line) => widthOf(line) ?? 0);
  let best = fallback;
  let bestLongest = Math.max(...fallbackWidths);
  let bestImbalance = bestLongest - Math.min(...fallbackWidths);
  let bestFirst = fallbackWidths[0] ?? 0;

  for (const lines of candidates) {
    if (lines === fallback) continue;

    const widths = lines.map((line) => widthOf(line) ?? 0);

    if (widths.some((width) => width > maxWidth)) continue;

    const longest = Math.max(...widths);
    const shortest = Math.min(...widths);
    const imbalance = longest - shortest;
    const first = widths[0] ?? 0;
    const better =
      longest < bestLongest ||
      (longest === bestLongest && (imbalance < bestImbalance || (imbalance === bestImbalance && first < bestFirst)));

    if (better) {
      best = lines;
      bestLongest = longest;
      bestImbalance = imbalance;
      bestFirst = first;
    }
  }

  return best;
}

async function wrapWordsBalanced(
  words: string[],
  fontPath: string,
  textColor: string,
  fontSize: number,
  maxWidth: number,
  tmpDir: string,
): Promise<string[]> {
  const greedy = await wrapWords(words, fontPath, textColor, fontSize, maxWidth, tmpDir);

  if (greedy.length <= 1) return greedy;

  if (words.length > 12) return greedy;

  if (binomial(words.length - 1, greedy.length - 1) > 200) return greedy;

  const splits: number[][] = [];
  const cursor: number[] = [];

  const collectSplits = (start: number, remaining: number): void => {
    if (remaining === 1) {
      splits.push([...cursor, words.length]);

      return;
    }

    for (let i = start + 1; i <= words.length - remaining + 1; i++) {
      cursor.push(i);

      collectSplits(i, remaining - 1);

      cursor.pop();
    }
  };

  collectSplits(0, greedy.length);

  const candidates = splits.map((points) => {
    const lines: string[] = [];
    let from = 0;

    for (const to of points) {
      lines.push(words.slice(from, to).join(" "));

      from = to;
    }

    return lines;
  });

  const charScore = (lines: string[]) => {
    const lens = lines.map((line) => line.length);
    const longest = Math.max(...lens);

    return { longest, imbalance: longest - Math.min(...lens), first: lens[0] ?? 0 };
  };

  const ranked = [...candidates].sort((a, b) => {
    const left = charScore(a);
    const right = charScore(b);

    if (left.longest !== right.longest) return left.longest - right.longest;

    if (left.imbalance !== right.imbalance) return left.imbalance - right.imbalance;

    return left.first - right.first;
  });

  const shortlist = ranked.slice(0, 8);

  if (!shortlist.some((lines) => lines.length === greedy.length && lines.every((line, index) => line === greedy[index]))) {
    shortlist.push(greedy);
  }

  const measured = new Map<string, number>();

  for (const lines of shortlist) {
    for (const line of lines) {
      if (measured.has(line)) continue;

      const ink = await renderLine(line, fontPath, textColor, fontSize, tmpDir);

      measured.set(line, ink?.w ?? 0);
    }
  }

  return chooseBalancedLines(shortlist, (line) => measured.get(line) ?? 0, maxWidth, greedy);
}

const MAX_AUTO_LINES = 4;
const MIN_FONT_RATIO = 0.45;

export interface FittedTitle {
  lines: string[];
  fontSize: number;
  fits: boolean;
}

export async function fitTitleToBox(args: {
  text: string;
  fontPath: string;
  textColor: string;
  maxWidth: number;
  maxHeight: number;
  baseFontSize: number;
  tmpDir: string;
}): Promise<FittedTitle> {
  const words = args.text.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return { lines: [], fontSize: args.baseFontSize, fits: true };

  const minFontSize = Math.max(24, Math.round(args.baseFontSize * MIN_FONT_RATIO));
  let fontSize = args.baseFontSize;
  let lines = await wrapWordsBalanced(words, args.fontPath, args.textColor, fontSize, args.maxWidth, args.tmpDir);

  while (true) {
    const blockHeight = lines.length * fontSize * TITLE_LINE_HEIGHT;
    const tooTall = args.maxHeight > 0 && blockHeight > args.maxHeight;
    const tooManyLines = lines.length > MAX_AUTO_LINES;

    if (!tooTall && !tooManyLines) return { lines, fontSize, fits: true };

    if (fontSize <= minFontSize) return { lines, fontSize, fits: false };

    fontSize = Math.max(minFontSize, Math.round(fontSize * 0.92));
    lines = await wrapWordsBalanced(words, args.fontPath, args.textColor, fontSize, args.maxWidth, args.tmpDir);
  }
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
  const hasCustomLines = ctx.titleLines.length > 0;
  const baseFontSize = TITLE_BASE_SIZE * ctx.titleScale;

  const fitted = hasCustomLines
    ? { lines: ctx.titleLines, fontSize: baseFontSize, fits: true }
    : await fitTitleToBox({
        text: ctx.title,
        fontPath: ctx.fontPath,
        textColor: ctx.textColor,
        maxWidth: ctx.titleBoxW,
        maxHeight: ctx.titleBoxH,
        baseFontSize,
        tmpDir: ctx.tmpDir,
      });

  if (!fitted.fits) {
    console.warn(`[frameit] title still overflows its box at minimum font size: "${ctx.title}"`);
  }

  const lines = fitted.lines;
  const size = fitted.fontSize;
  const step = size * TITLE_LINE_HEIGHT;
  const boxH = ctx.titleBoxH > 0 ? ctx.titleBoxH : lines.length * step;
  const boxTop = bandCenterY - boxH / 2 + ctx.titleOffset.y;
  const cx = work.w / 2 + ctx.titleOffset.x;
  const boxLeft = cx - ctx.titleBoxW / 2;
  const placed: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const ink = await renderLine(lines[i], ctx.fontPath, ctx.textColor, size, ctx.tmpDir);

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
  const { framed, work, layout, offset, titleOffset, titleScale, deviceScale, rotation, titleRotation } = ctx;
  const boxMode = ctx.titleBoxW > 0;
  const moveDevice = offset.x !== 0 || offset.y !== 0 || deviceScale !== 1 || rotation !== 0;
  const moveTitle = titleOffset.x !== 0 || titleOffset.y !== 0 || titleScale !== 1 || boxMode || titleRotation !== 0;

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
    const titleCx = Math.round(work.w / 2 + titleOffset.x);
    const titleCy = Math.round(bandCenterY + titleOffset.y);

    if (titleRotation !== 0) {
      const boxCanvas = await sharp({
        create: { width: work.w, height: work.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite(boxLayers.map((layer) => ({ input: layer.input, left: layer.left, top: layer.top })))
        .png()
        .toBuffer();
      const spun = await rotatedPlacement(boxCanvas, work.w, work.h, titleCx, titleCy, titleRotation);
      const placed = await clipped(spun.input, spun.left, spun.top, work.w, work.h);

      if (placed) layers.push(placed);
    } else {
      for (const layer of boxLayers) {
        const safe = await clipped(layer.input, layer.left, layer.top, work.w, work.h);

        if (safe) layers.push(safe);
      }
    }
  } else if (moveTitle) {
    const text = await extractTitleLayer(framed, ctx.gradient, work, bandY, space, ctx.textColor, titleScale);
    const textMeta = await sharp(text).metadata();
    const textW = textMeta.width ?? work.w;
    const textH = textMeta.height ?? space;
    const titleCx = Math.round(work.w / 2 + titleOffset.x);
    const titleCy = Math.round(bandY + space / 2 + titleOffset.y);
    const spun = await rotatedPlacement(text, textW, textH, titleCx, titleCy, titleRotation);
    const placed = await clipped(spun.input, spun.left, spun.top, work.w, work.h);

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
    const spun = await rotatedPlacement(resizedDevice, imgW, imgH, imgX + imgW / 2, imgY + imgH / 2, rotation);
    const placed = await clipped(spun.input, spun.left, spun.top, work.w, work.h);

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
