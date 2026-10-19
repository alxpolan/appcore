import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import { findFastlane } from "../fastlane-utils";
import { execAsync } from "./shared";
import { copyFrameitFont, pickFrameitFont, STUDIO_FRAMEIT_FONTS } from "./frameit-fonts";
import { recompositeShiftedFrame } from "./frameit-shift";

export const frameitRouter = Router();

const SIZE_REMAP: Record<string, { w: number; h: number }> = {
  "2064x2752": { w: 2048, h: 2732 }, // iPad Pro 13" M4 → 12.9" 4th
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

interface FrameitRequest {
  // `title` lets one request carry a whole locale: each image keeps its own subline,
  // so framing 12 screenshots costs one fastlane boot instead of twelve.
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

interface FramefileSection {
  background?: string;
  padding: number;
  show_complete_frame: boolean;
  stack_title: boolean;
  title_below_image: boolean;
  title: { text: string; color: string; font: string; font_size: number };
}

// Per-screenshot override merged over `default` by frameit, matched via `filter`.
interface FramefileEntry {
  filter: string;
  title_below_image: boolean;
  title: { text: string; color: string; font: string; font_size: number };
  /** Per-image so screenshots of different sizes each get a matching background. */
  background?: string;
}

function buildTitleSection(
  title: string | undefined,
  subtitle: string | undefined,
  textColor: string,
  layoutMode: LayoutMode,
  font: string,
  background?: string,
): FramefileSection {
  return {
    ...(background ? { background } : {}),
    padding: 50,
    show_complete_frame: false,
    stack_title: false,
    title_below_image: layoutMode === "bottom",
    title: {
      text: title ?? subtitle ?? " ",
      color: textColor,
      font,
      font_size: 150,
    },
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
  let tmpDirDevice = "";

  try {
    let maxW = 0;
    let maxH = 0;
    const outputDims = new Map<string, { w: number; h: number }>();
    const layoutByBase = new Map<string, LayoutMode>();
    const titleByBase = new Map<string, string>();
    const offsetByBase = new Map<string, { x: number; y: number }>();
    const titleOffsetByBase = new Map<string, { x: number; y: number }>();
    const titleScaleByBase = new Map<string, number>();
    const deviceScaleByBase = new Map<string, number>();
    const titleBoxByBase = new Map<string, { w: number; h: number }>();
    const titleLinesByBase = new Map<string, string[]>();
    // Dimensions of the file actually handed to frameit, which is what the background
    // has to match exactly.
    const workDimsByBase = new Map<string, { w: number; h: number }>();

    for (const img of images) {
      const buf = Buffer.from(img.data, "base64");
      const basename = img.filename.replace(/\.[^.]+$/, "");
      const tmpPath = path.join(tmpDir, basename + ".png");
      const meta = await sharp(buf).metadata();
      const remapKey = `${meta.width}x${meta.height}`;
      const remap = SIZE_REMAP[remapKey];

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
      titleBoxByBase.set(basename, { w: normalizeBoxSize(img.titleBoxW), h: normalizeBoxSize(img.titleBoxH) });
      titleLinesByBase.set(basename, normalizeTitleLines(img.titleLines));

      let pipeline = sharp(buf);
      let workW = meta.width ?? 1290;
      let workH = meta.height ?? 2796;
      if (remap) {
        pipeline = pipeline.resize(remap.w, remap.h, { fit: "fill" });
        workW = remap.w;
        workH = remap.h;
      }
      workDimsByBase.set(basename, { w: workW, h: workH });
      maxW = Math.max(maxW, workW);
      maxH = Math.max(maxH, workH);
      await pipeline.png().toFile(tmpPath);
    }

    if (!maxW) maxW = 1290;
    if (!maxH) maxH = 2796;

    // One background per distinct screenshot size. A single shared background breaks
    // mixed batches: generate_background (editor.rb) only rebuilds it when its HEIGHT
    // differs from the screenshot, so an iPhone (1290x2796) sharing a background sized
    // for an iPad (2048x2796) keeps the too-wide canvas, and the final cover-crop then
    // eats the background at the edges.
    const sizeKey = (w: number, h: number) => `${w}x${h}`;
    const backgroundFor = (base: string) => {
      const d = workDimsByBase.get(base) ?? { w: maxW, h: maxH };
      return `./background-${sizeKey(d.w, d.h)}.png`;
    };

    const distinctSizes = new Map<string, { w: number; h: number }>();
    for (const d of workDimsByBase.values()) distinctSizes.set(sizeKey(d.w, d.h), d);
    if (distinctSizes.size === 0) distinctSizes.set(sizeKey(maxW, maxH), { w: maxW, h: maxH });

    // Must be a size that is actually generated. maxW/maxH are independent maxima, so
    // their combination can be a size no screenshot has (iPhone 1290x2796 + iPad
    // 2048x2732 would give 2048x2796), and frameit hard-fails on a missing background.
    const fallbackBackgroundKey = [...distinctSizes.entries()].sort((a, b) => b[1].w * b[1].h - a[1].w * a[1].h)[0][0];

    const backgroundSvg = (w: number, h: number) =>
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="${bgColor1}"/>
          <stop offset="100%" stop-color="${bgColor2}"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#bg)"/>
    </svg>`;

    for (const [key, { w, h }] of distinctSizes) {
      // Lossless PNG rather than JPEG: a smooth two-stop gradient is exactly the content
      // where JPEG shows banding, and it is the full-bleed backdrop of every screenshot.
      await sharp(Buffer.from(backgroundSvg(w, h)))
        .png()
        .toFile(path.join(tmpDir, `background-${key}.png`));
    }
    // Font selection has to see every subline in the batch, not just the fallback, or a
    // locale whose script only appears in a per-image title would render in the wrong face.
    const fontSourcePath = pickFrameitFont(
      [title ?? "", subtitle ?? "", ...titleByBase.values()].join(" "),
      familyFontPath,
    );
    const frameitFont = copyFrameitFont(fontSourcePath, tmpDir);
    const fallbackLayout = layoutByBase.values().next().value ?? "center";
    const deviceChanged = new Set([
      ...[...offsetByBase.entries()].filter(([, o]) => o.x !== 0 || o.y !== 0).map(([base]) => base),
      ...[...deviceScaleByBase.entries()].filter(([, k]) => k !== 1).map(([base]) => base),
    ]);

    const titleChanged = new Set([
      ...[...titleOffsetByBase.entries()].filter(([, o]) => o.x !== 0 || o.y !== 0).map(([base]) => base),
      ...[...titleScaleByBase.entries()].filter(([, k]) => k !== 1).map(([base]) => base),
    ]);

    const boxChanged = new Set([...titleBoxByBase.entries()].filter(([, b]) => b.w > 0).map(([base]) => base));

    const shiftedBases = new Set([...deviceChanged, ...titleChanged, ...boxChanged]);
    const devicePassBases = new Set([...deviceChanged, ...boxChanged]);

    // frameit substring-matches `filter` against the full screenshot path and deep-merges
    // every hit in array order (config_parser.rb:29). The trailing dot anchors the match to
    // the filename, and sorting by filter length makes the most specific entry merge last:
    // for "01_home.png" both "home." and "01_home." match, and the longer one has to win.
    const buildEntries = (font: string, withBackground: boolean): FramefileEntry[] =>
      images
        .map((img) => {
          const base = img.filename.replace(/\.[^.]+$/, "");
          return {
            filter: `${base}.`,
            title_below_image: layoutByBase.get(base) === "bottom",
            title: { text: boxChanged.has(base) ? " " : (titleByBase.get(base) ?? " "), color: textColor, font, font_size: 150 },
            ...(withBackground ? { background: backgroundFor(base) } : {}),
          };
        })
        .sort((a, b) => a.filter.length - b.filter.length);

    // Only a fallback: every image carries its own correctly sized background in `data`.
    const defaultSection = buildTitleSection(
      title,
      subtitle,
      textColor,
      fallbackLayout,
      frameitFont,
      `./background-${fallbackBackgroundKey}.png`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "Framefile.json"),
      JSON.stringify(
        { device_frame_version: "latest", default: defaultSection, data: buildEntries(frameitFont, true) },
        null,
        2,
      ),
    );

    if (devicePassBases.size > 0) {
      tmpDirDevice = path.join(os.tmpdir(), `worker-frameit-device-${Date.now()}`);
      fs.mkdirSync(tmpDirDevice, { recursive: true });

      for (const base of devicePassBases) {
        const src = path.join(tmpDir, base + ".png");

        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(tmpDirDevice, base + ".png"));
        }
      }

      const frameitFontDevice = copyFrameitFont(fontSourcePath, tmpDirDevice);
      const defaultSectionDevice = buildTitleSection(
        title,
        subtitle,
        textColor,
        fallbackLayout,
        frameitFontDevice,
      );

      fs.writeFileSync(
        path.join(tmpDirDevice, "Framefile.json"),
        JSON.stringify(
          {
            device_frame_version: "latest",
            default: defaultSectionDevice,
            data: buildEntries(frameitFontDevice, false),
          },
          null,
          2,
        ),
      );
    }

    const fastlaneBin = await findFastlane();
    const frameitTimeoutMs = Math.min(13 * 60_000, Math.max(300_000, images.length * 60_000));

    const runFrameit = async (dir: string) => {
      let output = "";
      try {
        const result = await execAsync(`${fastlaneBin} frameit 2>&1`, {
          cwd: dir,
          timeout: frameitTimeoutMs,
          env: {
            ...process.env,
            FASTLANE_DISABLE_COLORS: "1",
            LANG: "en_US.UTF-8",
            LC_ALL: "en_US.UTF-8",
            LC_CTYPE: "en_US.UTF-8",
          },
          maxBuffer: 10 * 1024 * 1024,
        });
        output = result.stdout ?? "";
      } catch (execErr) {
        const e = execErr as { stdout?: string; stderr?: string; code?: number };
        output = `${e.stdout ?? ""}${e.stderr ?? ""}\n[frameit exited with code ${e.code}]`;
      }
      return output;
    };

    const [combinedOutput] = await Promise.all([
      runFrameit(tmpDir),
      ...(tmpDirDevice ? [runFrameit(tmpDirDevice)] : []),
    ]);

    // frameit also frames our generated background-*.png assets sitting in the same
    // dir - exclude them or every locale ships two content-less "screenshots".
    const isRealFrame = (f: string) => f.endsWith("_framed.png") && !f.startsWith("background-");
    const framedFiles = fs.readdirSync(tmpDir).filter(isRealFrame);
    const producedBases = new Set(framedFiles.map((f) => f.replace(/_framed\.png$/, "")));
    const missing = images
      .map((img) => img.filename.replace(/\.[^.]+$/, ""))
      .filter((base) => !producedBases.has(base));

    if (missing.length > 0) {
      throw new Error(
        `frameit produced ${framedFiles.length}/${images.length} images after ${Math.round(
          frameitTimeoutMs / 1000,
        )}s budget. Missing: ${missing.join(", ")}\n${combinedOutput}`,
      );
    }

    const deviceLayerByBase = new Map<string, Buffer>();

    if (tmpDirDevice) {
      for (const base of devicePassBases) {
        const devicePath = path.join(tmpDirDevice, `${base}_framed.png`);

        if (!fs.existsSync(devicePath)) {
          throw new Error(`frameit device pass produced no image for ${base}\n${combinedOutput}`);
        }

        deviceLayerByBase.set(base, await fs.promises.readFile(devicePath));
      }
    }

    const gravityFor = (base: string) => {
      const layout = layoutByBase.get(base) ?? "center";
      return layout === "top" ? "north" : layout === "bottom" ? "south" : "centre";
    };

    const shiftDevice = async (base: string, framed: Buffer): Promise<Buffer> => {
      const work = workDimsByBase.get(base) ?? { w: maxW, h: maxH };
      const gradient = await sharp(Buffer.from(backgroundSvg(work.w, work.h)))
        .png()
        .toBuffer();

      return recompositeShiftedFrame({
        framed,
        work,
        layout: layoutByBase.get(base) ?? "center",
        offset: offsetByBase.get(base) ?? { x: 0, y: 0 },
        titleOffset: titleOffsetByBase.get(base) ?? { x: 0, y: 0 },
        titleScale: titleScaleByBase.get(base) ?? 1,
        deviceScale: deviceScaleByBase.get(base) ?? 1,
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

    const processFramedFiles = async (
      dir: string,
      files: string[],
    ): Promise<Array<{ filename: string; data: string }>> => {
      const result: Array<{ filename: string; data: string }> = [];
      for (const f of files) {
        const srcBase = f.replace(/_framed\.png$/, "");
        const framed = await fs.promises.readFile(path.join(dir, f));
        const raw = shiftedBases.has(srcBase) ? await shiftDevice(srcBase, framed) : framed;
        const dims = outputDims.get(srcBase) ?? { w: maxW, h: maxH };
        const finalBuf = await sharp(raw)
          .resize(dims.w, dims.h, { fit: "cover", position: gravityFor(srcBase) })
          .png()
          .toBuffer();
        result.push({ filename: srcBase + ".png", data: finalBuf.toString("base64") });
      }
      return result;
    };

    const framedImages = await processFramedFiles(tmpDir, framedFiles);

    res.json({ ok: true, framedImages, fontUsed: fontSourcePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    for (const dir of [tmpDir, tmpDirDevice].filter(Boolean)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
});
