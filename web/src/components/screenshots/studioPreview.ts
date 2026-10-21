import type { StudioStyle } from "./studioApi";

export interface StudioPreviewDraw {
  rawUrl: string;
  title: string;
  style: StudioStyle;
}

export interface PreviewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreviewLayout {
  workW: number;
  workH: number;
  outW: number;
  outH: number;
  pad: number;
  space: number;
  phone: PreviewRect;
  band: PreviewRect;
  cover: { s: number; dx: number; dy: number };
  frame: FrameEntry | null;
}

const FONT_SOURCES: Record<string, string> = {
  rounded: "/fonts/ArialRoundedBold.ttf",
  inter: "/fonts/Inter-Bold.ttf",
  baloo: "/fonts/Baloo2-Bold.ttf",
};

const FONT_FAMILIES: Record<string, string> = {
  rounded: "StudioRounded",
  inter: "StudioInter",
  baloo: "StudioBaloo",
};

interface FrameEntry {
  file: string;
  frameW: number;
  frameH: number;
  offX: number;
  offY: number;
  shotW: number;
  triple: boolean;
  rounded: boolean;
}

const FRAMES: Record<string, FrameEntry> = {
  "1320x2868": { file: "/frames/iphone-69.png", frameW: 1470, frameH: 3000, offX: 75, offY: 66, shotW: 1320, triple: true, rounded: true },
  "1290x2796": { file: "/frames/iphone-67.png", frameW: 1470, frameH: 2970, offX: 90, offY: 87, shotW: 1290, triple: true, rounded: true },
  "1242x2688": { file: "/frames/iphone-65.png", frameW: 1413, frameH: 2844, offX: 86, offY: 78, shotW: 1242, triple: true, rounded: false },
  "1206x2622": { file: "/frames/iphone-63.png", frameW: 1350, frameH: 2760, offX: 72, offY: 69, shotW: 1206, triple: true, rounded: true },
  "1242x2208": { file: "/frames/iphone-55.png", frameW: 1436, frameH: 2876, offX: 98, offY: 335, shotW: 1242, triple: true, rounded: false },
  "750x1334": { file: "/frames/iphone-47.png", frameW: 871, frameH: 1776, offX: 61, offY: 219, shotW: 750, triple: false, rounded: false },
  "2048x2732": { file: "/frames/ipad-129.png", frameW: 2245, frameH: 2930, offX: 96, offY: 102, shotW: 2048, triple: false, rounded: false },
  "1668x2388": { file: "/frames/ipad-11.png", frameW: 1863, frameH: 2583, offX: 95, offY: 100, shotW: 1668, triple: false, rounded: false },
};

const SIZE_REMAP: Record<string, { w: number; h: number }> = {
  "2064x2752": { w: 2048, h: 2732 },
};

export function computePreviewLayout(outW: number, outH: number, top: boolean): PreviewLayout {
  const remap = SIZE_REMAP[`${outW}x${outH}`];
  const workW = remap?.w ?? outW;
  const workH = remap?.h ?? outH;
  const frame = FRAMES[`${workW}x${workH}`] ?? null;
  const pad = frame?.triple ? 85 : 50;
  const space = pad + 150 + pad;

  const multi = frame ? workW / frame.shotW : 1;
  const frameScaledW = frame ? frame.frameW * multi : workW;
  const frameWidth = workW - pad * 2;
  const fw = frame && frameWidth < frameScaledW ? frameWidth / frameScaledW : 1;
  const imgW = frameScaledW * fw;
  const imgH = frame ? frame.frameH * multi * fw : workH;
  const phone = {
    x: (workW - imgW) / 2,
    y: top ? space : workH - space - imgH,
    w: imgW,
    h: imgH,
  };
  const band = { x: 0, y: top ? 0 : workH - space, w: workW, h: frame ? space : 0 };

  const s = remap ? Math.max(outW / workW, outH / workH) : 1;
  const dw = workW * s;
  const dh = workH * s;
  const cover = { s, dx: (outW - dw) / 2, dy: top ? 0 : outH - dh };

  return { workW, workH, outW, outH, pad, space, phone, band, cover, frame };
}

export function toOutRect(rect: PreviewRect, cover: PreviewLayout["cover"]): PreviewRect {
  return {
    x: rect.x * cover.s + cover.dx,
    y: rect.y * cover.s + cover.dy,
    w: rect.w * cover.s,
    h: rect.h * cover.s,
  };
}

export interface TitleMetrics {
  size: number;
  w: number;
  h: number;
  ascent: number;
}

export const TITLE_BASE_SIZE = 150;
export const TITLE_LINE_HEIGHT = 1.2;
export const TITLE_MAX_LINES = 12;

export function studioFontFamily(font: string): string {
  return FONT_FAMILIES[font] ?? FONT_FAMILIES.rounded;
}

export function measureTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  workW: number,
  pad: number,
  space: number,
  titleScale: number,
): TitleMetrics {
  ctx.font = `700 150px "${family}", system-ui, sans-serif`;

  const metrics = ctx.measureText(text);
  const rawW = metrics.width;
  const rawH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const ratioH = rawW / (workW - pad * 2);
  const ratioV = rawH / space;
  const k = (1 / Math.max(1, ratioH, ratioV)) * titleScale;

  return {
    size: 150 * k,
    w: rawW * k,
    h: rawH * k,
    ascent: metrics.actualBoundingBoxAscent * k,
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function wrapTitleLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  size: number,
  boxW: number,
): string[] {
  ctx.font = `700 ${size}px "${family}", system-ui, sans-serif`;

  const words = text.split(" ").filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;

    if (current && ctx.measureText(trial).width > boxW) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }

  if (current) lines.push(current);

  if (lines.length <= TITLE_MAX_LINES) return lines;

  return [...lines.slice(0, TITLE_MAX_LINES - 1), lines.slice(TITLE_MAX_LINES - 1).join(" ")];
}

let inkCanvas: HTMLCanvasElement | null = null;

function blitCenteredLine(
  main: CanvasRenderingContext2D,
  line: string,
  fontCss: string,
  color: string,
  cx: number,
  slotTop: number,
  step: number,
): void {
  if (!inkCanvas) inkCanvas = document.createElement("canvas");

  const ink = inkCanvas.getContext("2d");

  if (!ink) return;

  ink.font = fontCss;
  ink.textAlign = "left";
  ink.textBaseline = "middle";

  const pad = 16;
  const tempW = Math.ceil(ink.measureText(line).width) + pad * 2;
  const tempH = Math.ceil(step) * 2 + pad * 2;
  ink.canvas.width = tempW;
  ink.canvas.height = tempH;
  ink.font = fontCss;
  ink.textAlign = "left";
  ink.textBaseline = "middle";
  ink.fillStyle = color;
  ink.fillText(line, pad, tempH / 2);

  const pixels = ink.getImageData(0, 0, tempW, tempH).data;
  let x0 = tempW;
  let y0 = tempH;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < tempH; y++) {
    for (let x = 0; x < tempW; x++) {
      if (pixels[(y * tempW + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 < x0 || y1 < y0) return;

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  main.drawImage(ink.canvas, x0, y0, w, h, Math.round(cx - w / 2), Math.round(slotTop + (step - h) / 2), w, h);
}

const MAX_AUTO_LINES = 4;
const MIN_FONT_RATIO = 0.45;
const SHRINK_STEP = 0.92;

export interface FittedTitleBlock {
  lines: string[];
  size: number;
}

export function fitTitleBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  family: string,
  boxW: number,
  boxH: number,
  baseSize: number,
): FittedTitleBlock {
  const minSize = Math.max(24, Math.round(baseSize * MIN_FONT_RATIO));
  let size = baseSize;
  let lines = wrapTitleLines(ctx, text, family, size, boxW);

  while (true) {
    const blockH = lines.length * size * TITLE_LINE_HEIGHT;
    const tooTall = boxH > 0 && blockH > boxH;
    const tooManyLines = lines.length > MAX_AUTO_LINES;

    if (!tooTall && !tooManyLines) return { lines, size };

    if (size <= minSize) return { lines, size: minSize };

    size = Math.max(minSize, Math.round(size * SHRINK_STEP));
    lines = wrapTitleLines(ctx, text, family, size, boxW);
  }
}

export function measureTitleBlock(
  title: string,
  font: string,
  workW: number,
  pad: number,
  space: number,
  titleScale: number,
  boxW = 0,
  boxH = 0,
): TitleMetrics {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }

  if (!measureCtx || title.trim().length === 0) {
    return { size: 0, w: 0, h: 0, ascent: 0 };
  }

  if (boxW > 0) {
    const baseSize = TITLE_BASE_SIZE * titleScale;
    const fitted = fitTitleBlock(measureCtx, title.trim(), studioFontFamily(font), boxW, boxH, baseSize);
    const step = fitted.size * TITLE_LINE_HEIGHT;
    const h = boxH > 0 ? boxH : fitted.lines.length * step;

    return { size: fitted.size, w: boxW, h, ascent: step / 2 };
  }

  return measureTitle(measureCtx, title.trim(), studioFontFamily(font), workW, pad, space, titleScale);
}

const loadedFonts = new Set<string>();

export async function ensureStudioFont(font: string): Promise<string> {
  const family = FONT_FAMILIES[font] ?? FONT_FAMILIES.rounded;

  if (loadedFonts.has(family)) return family;

  const face = new FontFace(family, `url(${FONT_SOURCES[font] ?? FONT_SOURCES.rounded})`, { weight: "700" });

  await face.load();
  document.fonts.add(face);
  loadedFonts.add(family);

  return family;
}

const imageCache = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);

  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export async function drawStudioPreview(canvas: HTMLCanvasElement, draw: StudioPreviewDraw): Promise<void> {
  const { style, title } = draw;
  const text = title.trim().length > 0 ? title.trim() : " ";
  const top = style.textPosition === "top";

  const [family, raw] = await Promise.all([ensureStudioFont(style.font), loadImage(draw.rawUrl)]);
  const layout = computePreviewLayout(raw.naturalWidth, raw.naturalHeight, top);
  const { workW, workH, outW, outH, pad, space, frame } = layout;

  const work = document.createElement("canvas");
  work.width = workW;
  work.height = workH;
  const ctx = work.getContext("2d");

  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, workW, workH);
  bg.addColorStop(0, style.bgColor1);
  bg.addColorStop(1, style.bgColor2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, workW, workH);

  if (!frame) {
    const s = Math.min(workW / outW, workH / outH);
    const dw = outW * s;
    const dh = outH * s;
    ctx.drawImage(raw, (workW - dw) / 2, (workH - dh) / 2, dw, dh);
  } else {
    const bandCenterY = top ? space / 2 : workH - space / 2;

    if (style.titleBoxW > 0) {
      const baseSize = TITLE_BASE_SIZE * style.titleScale;
      const fitted =
        text === " "
          ? { lines: [], size: baseSize }
          : fitTitleBlock(ctx, text, family, style.titleBoxW, style.titleBoxH, baseSize);
      const step = fitted.size * TITLE_LINE_HEIGHT;
      const boxH = style.titleBoxH > 0 ? style.titleBoxH : fitted.lines.length * step;
      const boxTop = bandCenterY - boxH / 2 + style.titleOffsetY;
      const cx = workW / 2 + style.titleOffsetX;

      if (fitted.lines.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - style.titleBoxW / 2, boxTop, style.titleBoxW, boxH);
        ctx.clip();

        const fontCss = `700 ${fitted.size}px "${family}", system-ui, sans-serif`;

        for (let i = 0; i < fitted.lines.length; i++) {
          blitCenteredLine(ctx, fitted.lines[i], fontCss, style.textColor, cx, boxTop + i * step, step);
        }

        ctx.restore();
      }
    } else {
      const tm = measureTitle(ctx, text, family, workW, pad, space, style.titleScale);
      const titleTop = bandCenterY - tm.h / 2 + style.titleOffsetY;

      if (text !== " ") {
        ctx.font = `700 ${tm.size}px "${family}", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = style.textColor;
        ctx.fillText(text, workW / 2 + style.titleOffsetX, titleTop + tm.ascent);
      }
    }

    const multi = workW / frame.shotW;
    const devW = frame.frameW * multi;
    const devH = frame.frameH * multi;
    const dev = document.createElement("canvas");
    dev.width = devW;
    dev.height = devH;
    const devCtx = dev.getContext("2d");

    if (devCtx) {
      const shotX = frame.offX * multi;
      const shotY = frame.offY * multi;

      if (frame.rounded) {
        devCtx.save();
        devCtx.beginPath();
        devCtx.roundRect(shotX, shotY, workW, workH, 100 * multi);
        devCtx.clip();
        devCtx.drawImage(raw, shotX, shotY, workW, workH);
        devCtx.restore();
      } else {
        devCtx.drawImage(raw, shotX, shotY, workW, workH);
      }

      const frameImg = await loadImage(frame.file);
      devCtx.drawImage(frameImg, 0, 0, devW, devH);

      const { phone } = layout;
      const k = style.deviceScale;
      ctx.drawImage(
        dev,
        phone.x + ((phone.w - phone.w * k) / 2 + style.offsetX),
        phone.y + ((phone.h - phone.h * k) / 2 + style.offsetY),
        phone.w * k,
        phone.h * k,
      );
    }
  }

  canvas.width = outW;
  canvas.height = outH;
  const out = canvas.getContext("2d");

  if (!out) return;

  if (!SIZE_REMAP[`${outW}x${outH}`]) {
    out.drawImage(work, 0, 0);
    return;
  }

  const { s, dx, dy } = layout.cover;
  out.drawImage(work, dx, dy, workW * s, workH * s);
}
