import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import { pickFrameitFont, STUDIO_FRAMEIT_FONTS } from "./frameit-fonts";
import { fitTitleToBox, recompositeShiftedFrame, TITLE_BASE_SIZE } from "./frameit-shift";
import {
  FRAMEIT_ASSETS_DIR,
  bezelsForDevice,
  listBezelFiles,
  loadBezelImage,
  resolveDevice,
  type FrameitDevice,
} from "./frameit-devices";
import { frameitPad, frameitSpace, renderBaseFrame, renderDeviceLayer } from "./frameit-native";

export const frameitRouter = Router();

const SIZE_REMAP: Record<string, { w: number; h: number }> = {
  "2064x2752": { w: 2048, h: 2732 },
};

type LayoutMode = "center" | "top" | "bottom";

function normalizeOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  return Math.max(-2048, Math.min(2048, Math.round(value)));
}

function normalizeScale(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;

  return Math.max(min, Math.min(max, Math.round(value * 100) / 100));
}

function normalizeBoxSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  return Math.max(0, Math.min(4096, Math.round(value)));
}

function normalizeTitleLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const lines: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;

    const line = entry.replace(/\s+/g, " ").trim().slice(0, 200);

    if (!line) continue;

    lines.push(line);
  }

  if (lines.length <= 12) return lines;

  return [...lines.slice(0, 11), lines.slice(11).join(" ")];
}

interface FrameitOverlay {
  data: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
}

function normalizeRotation(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;

  return Math.round(wrapped * 10) / 10;
}

interface FrameitRequest {
  images: Array<{
    filename: string;
    data: string;
    title?: string;
    offsetX?: number;
    offsetY?: number;
    titleOffsetX?: number;
    titleOffsetY?: number;
    titleScale?: number;
    deviceScale?: number;
    titleBoxW?: number;
    titleBoxH?: number;
    titleLines?: string[];
    bezelFile?: string;
    rotation?: number;
    titleRotation?: number;
    overlays?: FrameitOverlay[];
  }>;
  options: {
    subtitle?: string;
    title?: string;
    bgColor1?: string;
    bgColor2?: string;
    textColor?: string;
    layoutMode?: LayoutMode | "random";
    fontFamily?: "rounded" | "inter" | "baloo";
  };
}

frameitRouter.post("/frameit", async (req: Request, res: Response) => {
  const { images, options } = req.body as FrameitRequest;

  if (!images || images.length === 0) {
    res.status(400).json({ error: "No images provided" });

    return;
  }

  const {
    subtitle,
    title,
    bgColor1 = "#667eea",
    bgColor2 = "#764ba2",
    textColor = "#ffffff",
    layoutMode: layoutModeInput,
    fontFamily,
  } = options || {};

  const requestedFamily = fontFamily && STUDIO_FRAMEIT_FONTS[fontFamily] ? fontFamily : "rounded";
  const familyFontPath = path.join(__dirname, "fonts", STUDIO_FRAMEIT_FONTS[requestedFamily]);

  const LAYOUT_MODES: LayoutMode[] = ["center", "top", "bottom"];
  const resolveLayout = (): LayoutMode => {
    if (layoutModeInput === "random") return LAYOUT_MODES[Math.floor(Math.random() * LAYOUT_MODES.length)];
    if (layoutModeInput) return layoutModeInput;

    return "center";
  };

  const tmpDir = path.join(os.tmpdir(), `worker-frameit-${Date.now()}`);

  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const outputDims = new Map<string, { w: number; h: number }>();
    const layoutByBase = new Map<string, LayoutMode>();
    const titleByBase = new Map<string, string>();
    const offsetByBase = new Map<string, { x: number; y: number }>();
    const titleOffsetByBase = new Map<string, { x: number; y: number }>();
    const titleScaleByBase = new Map<string, number>();
    const deviceScaleByBase = new Map<string, number>();
    const rotationByBase = new Map<string, number>();
    const titleRotationByBase = new Map<string, number>();
    const titleBoxByBase = new Map<string, { w: number; h: number }>();
    const titleLinesByBase = new Map<string, string[]>();
    const workDimsByBase = new Map<string, { w: number; h: number }>();
    const workBufferByBase = new Map<string, Buffer>();
    const deviceByBase = new Map<string, FrameitDevice>();

    for (const img of images) {
      const buf = Buffer.from(img.data, "base64");
      const basename = img.filename.replace(/\.[^.]+$/, "");
      const meta = await sharp(buf).metadata();
      const remapKey = `${meta.width}x${meta.height}`;
      const remap = SIZE_REMAP[remapKey];
      const workW = remap ? remap.w : (meta.width ?? 1290);
      const workH = remap ? remap.h : (meta.height ?? 2796);

      const device = resolveDevice(img.filename, workW, workH);

      if (!device) {
        throw new Error(
          `No known device bezel matches screenshot '${img.filename}' at ${workW}x${workH}`,
        );
      }

      deviceByBase.set(basename, device);
      outputDims.set(basename, {
        w: meta.width ?? 1290,
        h: meta.height ?? 2796,
      });
      layoutByBase.set(basename, resolveLayout());
      titleByBase.set(basename, img.title ?? title ?? subtitle ?? " ");
      offsetByBase.set(basename, { x: normalizeOffset(img.offsetX), y: normalizeOffset(img.offsetY) });
      titleOffsetByBase.set(basename, {
        x: normalizeOffset(img.titleOffsetX),
        y: normalizeOffset(img.titleOffsetY),
      });
      titleScaleByBase.set(basename, normalizeScale(img.titleScale, 0.2, 3));
      deviceScaleByBase.set(basename, normalizeScale(img.deviceScale, 0.2, 2));
      rotationByBase.set(basename, normalizeRotation(img.rotation));
      titleRotationByBase.set(basename, normalizeRotation(img.titleRotation));
      titleBoxByBase.set(basename, { w: normalizeBoxSize(img.titleBoxW), h: normalizeBoxSize(img.titleBoxH) });
      titleLinesByBase.set(basename, normalizeTitleLines(img.titleLines));

      const workBuffer = remap
        ? await sharp(buf).resize(remap.w, remap.h, { fit: "fill" }).png().toBuffer()
        : buf;

      workDimsByBase.set(basename, { w: workW, h: workH });
      workBufferByBase.set(basename, workBuffer);
    }

    const sizeKey = (w: number, h: number) => `${w}x${h}`;
    const backgroundCache = new Map<string, Buffer>();

    const backgroundFor = async (w: number, h: number): Promise<Buffer> => {
      const key = sizeKey(w, h);
      const cached = backgroundCache.get(key);

      if (cached) return cached;

      const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="${bgColor1}"/>
          <stop offset="100%" stop-color="${bgColor2}"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#bg)"/>
    </svg>`;

      const rendered = await sharp(Buffer.from(svg)).png().toBuffer();

      backgroundCache.set(key, rendered);

      return rendered;
    };

    const fontSourcePath = pickFrameitFont(
      [title ?? "", subtitle ?? "", ...titleByBase.values()].join(" "),
      familyFontPath,
    );

    const deviceChanged = new Set([
      ...[...offsetByBase.entries()].filter(([, o]) => o.x !== 0 || o.y !== 0).map(([base]) => base),
      ...[...deviceScaleByBase.entries()].filter(([, k]) => k !== 1).map(([base]) => base),
      ...[...rotationByBase.entries()].filter(([, r]) => r !== 0).map(([base]) => base),
    ]);

    const titleChanged = new Set([
      ...[...titleOffsetByBase.entries()].filter(([, o]) => o.x !== 0 || o.y !== 0).map(([base]) => base),
      ...[...titleScaleByBase.entries()].filter(([, k]) => k !== 1).map(([base]) => base),
      ...[...titleRotationByBase.entries()].filter(([, r]) => r !== 0).map(([base]) => base),
    ]);

    const boxChanged = new Set([...titleBoxByBase.entries()].filter(([, b]) => b.w > 0).map(([base]) => base));

    const shiftedBases = new Set([...deviceChanged, ...titleChanged, ...boxChanged]);
    const devicePassBases = new Set([...deviceChanged, ...boxChanged]);

    const bezelCacheByFile = new Map<string, Buffer>();
    const loadBezelCached = async (device: FrameitDevice) => {
      const cached = bezelCacheByFile.get(device.bezelFile);

      if (cached) return cached;

      const loaded = await loadBezelImage(device);

      bezelCacheByFile.set(device.bezelFile, loaded);

      return loaded;
    };

    const uniformBasesByDevice = new Map<string, string[]>();

    for (const img of images) {
      const basename = img.filename.replace(/\.[^.]+$/, "");

      if (boxChanged.has(basename)) continue;

      const device = deviceByBase.get(basename)!;
      const list = uniformBasesByDevice.get(device.bezelFile) ?? [];

      list.push(basename);
      uniformBasesByDevice.set(device.bezelFile, list);
    }

    const titleBaseFontSizeByBase = new Map<string, number>();

    for (const bases of uniformBasesByDevice.values()) {
      const work = workDimsByBase.get(bases[0])!;
      const maxWidth = work.w - frameitPad(work) * 2;
      const maxHeight = frameitSpace(work);

      const fitted = await Promise.all(
        bases.map((base) =>
          fitTitleToBox({
            text: titleByBase.get(base) ?? " ",
            fontPath: fontSourcePath,
            textColor,
            maxWidth,
            maxHeight,
            baseFontSize: TITLE_BASE_SIZE,
            tmpDir,
          }),
        ),
      );

      const sharedFontSize = Math.min(...fitted.map((f) => f.fontSize));

      for (const base of bases) titleBaseFontSizeByBase.set(base, sharedFontSize);
    }

    const framedByBase = new Map<string, Buffer>();

    for (const img of images) {
      const basename = img.filename.replace(/\.[^.]+$/, "");
      const work = workDimsByBase.get(basename)!;
      const device = deviceByBase.get(basename)!;
      const bezel = await loadBezelCached(device);
      const background = await backgroundFor(work.w, work.h);
      const renderTitle = boxChanged.has(basename) ? " " : (titleByBase.get(basename) ?? " ");

      const framed = await renderBaseFrame({
        screenshot: workBufferByBase.get(basename)!,
        work,
        layout: layoutByBase.get(basename) ?? "center",
        title: renderTitle,
        textColor,
        fontPath: fontSourcePath,
        background,
        device,
        bezel,
        tmpDir,
        titleBaseFontSize: titleBaseFontSizeByBase.get(basename),
      });

      framedByBase.set(basename, framed);
    }

    const bezelAllowlist = new Set(await listBezelFiles());

    for (const img of images) {
      const basename = img.filename.replace(/\.[^.]+$/, "");

      if (typeof img.bezelFile !== "string" || img.bezelFile.length === 0) continue;

      const override = img.bezelFile;

      if (!bezelAllowlist.has(override)) {
        throw new Error(`Unknown bezel file '${override}' for screenshot '${img.filename}'`);
      }

      const resolved = deviceByBase.get(basename);

      if (resolved) deviceByBase.set(basename, { ...resolved, bezelFile: override });
    }

    const overlayByBase = new Map<string, Array<{ data: string; x: number; y: number; scale: number; rotation: number }>>();

    for (const img of images) {
      if (!Array.isArray(img.overlays) || img.overlays.length === 0) continue;

      const basename = img.filename.replace(/\.[^.]+$/, "");
      const list: Array<{ data: string; x: number; y: number; scale: number; rotation: number }> = [];

      for (const overlay of img.overlays) {
        if (!overlay || typeof overlay.data !== "string" || overlay.data.length === 0) continue;

        const x = typeof overlay.x === "number" && Number.isFinite(overlay.x) ? overlay.x : 0;
        const y = typeof overlay.y === "number" && Number.isFinite(overlay.y) ? overlay.y : 0;

        list.push({ data: overlay.data, x, y, scale: normalizeScale(overlay.scale, 0.1, 8), rotation: normalizeRotation(overlay.rotation) });
      }

      if (list.length > 0) overlayByBase.set(basename, list);
    }

    const applyOverlays = async (base: string, framed: Buffer): Promise<Buffer> => {
      const list = overlayByBase.get(base);

      if (!list || list.length === 0) return framed;

      const parts: Array<{ input: Buffer; left: number; top: number }> = [];

      for (const overlay of list) {
        const buf = Buffer.from(overlay.data, "base64");
        const meta = await sharp(buf).metadata();

        if (!meta.width || !meta.height) continue;

        const w = Math.max(1, Math.round(meta.width * overlay.scale));
        const h = Math.max(1, Math.round(meta.height * overlay.scale));
        const resized = await sharp(buf).resize(w, h, { fit: "fill" }).png().toBuffer();

        if (overlay.rotation !== 0) {
          const spun = await sharp(resized)
            .rotate(overlay.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          const spunMeta = await sharp(spun).metadata();
          const sw = spunMeta.width ?? w;
          const sh = spunMeta.height ?? h;

          parts.push({ input: spun, left: Math.round(overlay.x - sw / 2), top: Math.round(overlay.y - sh / 2) });
        } else {
          parts.push({ input: resized, left: Math.round(overlay.x - w / 2), top: Math.round(overlay.y - h / 2) });
        }
      }

      if (parts.length === 0) return framed;

      return sharp(framed).composite(parts).png().toBuffer();
    };

    const deviceLayerByBase = new Map<string, Buffer>();

    for (const base of devicePassBases) {
      const device = deviceByBase.get(base)!;
      const bezel = await loadBezelCached(device);
      const layer = await renderDeviceLayer(workBufferByBase.get(base)!, device, bezel);

      deviceLayerByBase.set(base, layer);
    }

    const gravityFor = (base: string) => {
      const layout = layoutByBase.get(base) ?? "center";

      return layout === "top" ? "north" : layout === "bottom" ? "south" : "centre";
    };

    const shiftDevice = async (base: string, framed: Buffer): Promise<Buffer> => {
      const work = workDimsByBase.get(base)!;
      const gradient = await backgroundFor(work.w, work.h);

      return recompositeShiftedFrame({
        framed,
        work,
        layout: layoutByBase.get(base) ?? "center",
        offset: offsetByBase.get(base) ?? { x: 0, y: 0 },
        titleOffset: titleOffsetByBase.get(base) ?? { x: 0, y: 0 },
        titleScale: titleScaleByBase.get(base) ?? 1,
        deviceScale: deviceScaleByBase.get(base) ?? 1,
        rotation: rotationByBase.get(base) ?? 0,
        titleRotation: titleRotationByBase.get(base) ?? 0,
        titleBoxW: titleBoxByBase.get(base)?.w ?? 0,
        titleBoxH: titleBoxByBase.get(base)?.h ?? 0,
        titleLines: titleLinesByBase.get(base) ?? [],
        title: titleByBase.get(base) ?? " ",
        fontPath: fontSourcePath,
        tmpDir,
        textColor,
        gradient,
        deviceLayer: deviceLayerByBase.get(base),
      });
    };

    const framedImages: Array<{ filename: string; data: string }> = [];

    for (const [base, framed] of framedByBase) {
      const raw = shiftedBases.has(base) ? await shiftDevice(base, framed) : framed;
      const withOverlays = await applyOverlays(base, raw);
      const dims = outputDims.get(base)!;
      const finalBuf = await sharp(withOverlays)
        .resize(dims.w, dims.h, { fit: "cover", position: gravityFor(base) })
        .png()
        .toBuffer();

      framedImages.push({ filename: base + ".png", data: finalBuf.toString("base64") });
    }

    res.json({ ok: true, framedImages, fontUsed: fontSourcePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

frameitRouter.get("/frameit/bezels", async (req: Request, res: Response) => {
  try {
    const { filename, width, height } = req.query as { filename?: unknown; width?: unknown; height?: unknown };

    if (typeof filename !== "string" || filename.length === 0) {
      res.status(400).json({ ok: false, error: "filename is required" });

      return;
    }

    const w = Number(width);
    const h = Number(height);

    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      res.status(400).json({ ok: false, error: "width and height are required" });

      return;
    }

    res.json({ ok: true, ...(await bezelsForDevice(filename, w, h)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

frameitRouter.get("/frameit/bezel-image", async (req: Request, res: Response) => {
  try {
    const { file } = req.query as { file?: unknown };

    if (typeof file !== "string" || file.length === 0 || file.includes("/") || file.includes("\\")) {
      res.status(400).json({ ok: false, error: "file is required" });

      return;
    }

    const allowlist = new Set(await listBezelFiles());

    if (!allowlist.has(file)) {
      res.status(404).json({ ok: false, error: "Unknown bezel file" });

      return;
    }

    res.sendFile(path.join(FRAMEIT_ASSETS_DIR, file));
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
