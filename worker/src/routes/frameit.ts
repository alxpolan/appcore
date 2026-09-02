import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import sharp from "sharp";
import { findFastlane } from "../fastlane-utils";
import { execAsync } from "./shared";

export const frameitRouter = Router();

const SIZE_REMAP: Record<string, { w: number; h: number }> = {
  "2064x2752": { w: 2048, h: 2732 }, // iPad Pro 13" M4 → 12.9" 4th
};

type LayoutMode = "center" | "top" | "bottom";
type FontCandidate = {
  test: RegExp;
  paths: string[];
};

interface FrameitRequest {
  // `title` lets one request carry a whole locale: each image keeps its own subline,
  // so framing 12 screenshots costs one fastlane boot instead of twelve.
  images: Array<{ filename: string; data: string; title?: string }>;
  options: {
    subtitle?: string;
    title?: string;
    bgColor1?: string;
    bgColor2?: string;
    textColor?: string;
    layoutMode?: LayoutMode | "random";
    /**
     * Run frameit a second time without a background to also produce unframed images.
     * Doubles the ImageMagick work, so it stays off unless the caller asks for it.
     */
    includeUnframed?: boolean;
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

const BUNDLED_FRAMEIT_FONT = path.join(__dirname, "ArialRoundedBold.ttf");
const FRAMEIT_FONT_NAME = "FrameitTextFont";

const FONT_CANDIDATES: FontCandidate[] = [
  {
    // Devanagari (Hindi, Marathi, Nepali, Sanskrit)
    test: /[\u0900-\u097F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
      "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
      "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
      "/System/Library/Fonts/Kohinoor.ttc",
      "/System/Library/Fonts/SFIndia.ttc",
    ],
  },
  {
    // Bengali
    test: /[\u0980-\u09FF]/u,
    paths: ["/System/Library/Fonts/KohinoorBangla.ttc", "/System/Library/Fonts/Supplemental/Bangla Sangam MN.ttc"],
  },
  {
    // Gurmukhi (Punjabi)
    test: /[\u0A00-\u0A7F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Gurmukhi MN.ttc",
      "/System/Library/Fonts/Supplemental/Gurmukhi Sangam MN.ttc",
    ],
  },
  {
    // Gujarati
    test: /[\u0A80-\u0AFF]/u,
    paths: ["/System/Library/Fonts/KohinoorGujarati.ttc"],
  },
  {
    // Oriya (Odia)
    test: /[\u0B00-\u0B7F]/u,
    paths: ["/System/Library/Fonts/NotoSansOriya.ttc"],
  },
  {
    // Tamil
    test: /[\u0B80-\u0BFF]/u,
    paths: ["/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc"],
  },
  {
    // Telugu
    test: /[\u0C00-\u0C7F]/u,
    paths: ["/System/Library/Fonts/KohinoorTelugu.ttc"],
  },
  {
    // Kannada
    test: /[\u0C80-\u0CFF]/u,
    paths: ["/System/Library/Fonts/NotoSansKannada.ttc"],
  },
  {
    // Malayalam
    test: /[\u0D00-\u0D7F]/u,
    paths: ["/System/Library/Fonts/Supplemental/Malayalam Sangam MN.ttc"],
  },
  {
    // Sinhala
    test: /[\u0D80-\u0DFF]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Sinhala Sangam MN.ttc",
      "/System/Library/Fonts/Supplemental/Sinhala MN.ttc",
    ],
  },
  {
    test: /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF]/u,
    paths: [
      "/System/Library/Fonts/STHeiti Medium.ttc",
      "/System/Library/Fonts/Hiragino Sans GB.ttc",
      "/System/Library/Fonts/CJKSymbolsFallback.ttc",
    ],
  },
  {
    test: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u,
    paths: ["/System/Library/Fonts/AppleSDGothicNeo.ttc"],
  },
  {
    test: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u,
    paths: [
      "/System/Library/Fonts/SFArabicRounded.ttf",
      "/System/Library/Fonts/SFArabic.ttf",
      "/System/Library/Fonts/GeezaPro.ttc",
    ],
  },
  {
    test: /[\u0E00-\u0E7F]/u,
    paths: ["/System/Library/Fonts/Supplemental/Krungthep.ttf"],
  },
  {
    test: /[\u0590-\u05FF]/u,
    paths: ["/System/Library/Fonts/Supplemental/Raanana.ttc", "/System/Library/Fonts/ArialHB.ttc"],
  },
  {
    // Cyrillic (Russian, Ukrainian, Bulgarian, Serbian, etc.)
    test: /[\u0400-\u04FF\u0500-\u052F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/PTSans.ttc",
      "/System/Library/Fonts/Supplemental/PTSerif.ttc",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
    ],
  },
];

function pickFrameitFont(text: string): string {
  for (const candidate of FONT_CANDIDATES) {
    if (!candidate.test.test(text)) continue;
    const found = candidate.paths.find((fontPath) => fs.existsSync(fontPath));
    if (found) return found;
  }

  return BUNDLED_FRAMEIT_FONT;
}

function copyFrameitFont(sourcePath: string, targetDir: string): string {
  const ext = path.extname(sourcePath) || ".ttf";
  const localName = `${FRAMEIT_FONT_NAME}${ext}`;
  fs.copyFileSync(sourcePath, path.join(targetDir, localName));
  return `./${localName}`;
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
    includeUnframed = false,
  } = options || {};

  const LAYOUT_MODES: LayoutMode[] = ["center", "top", "bottom"];
  // Resolved per screenshot rather than per request, so batching a whole locale keeps
  // the previous behaviour of every image getting its own random layout.
  const resolveLayout = (): LayoutMode =>
    !layoutModeInput || layoutModeInput === "random"
      ? LAYOUT_MODES[Math.floor(Math.random() * LAYOUT_MODES.length)]
      : layoutModeInput;

  const tmpDir = path.join(os.tmpdir(), `worker-frameit-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  let tmpDirNoBg = "";

  try {
    let maxW = 0;
    let maxH = 0;
    const outputDims = new Map<string, { w: number; h: number }>();
    const layoutByBase = new Map<string, LayoutMode>();
    const titleByBase = new Map<string, string>();
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

    for (const [key, { w, h }] of distinctSizes) {
      const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stop-color="${bgColor1}"/>
          <stop offset="100%" stop-color="${bgColor2}"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#bg)"/>
    </svg>`;

      // Lossless PNG rather than JPEG: a smooth two-stop gradient is exactly the content
      // where JPEG shows banding, and it is the full-bleed backdrop of every screenshot.
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(tmpDir, `background-${key}.png`));
    }
    // Font selection has to see every subline in the batch, not just the fallback, or a
    // locale whose script only appears in a per-image title would render in the wrong face.
    const fontSourcePath = pickFrameitFont([title ?? "", subtitle ?? "", ...titleByBase.values()].join(" "));
    const frameitFont = copyFrameitFont(fontSourcePath, tmpDir);
    const fallbackLayout = layoutByBase.values().next().value ?? "center";

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
            title: { text: titleByBase.get(base) ?? " ", color: textColor, font, font_size: 150 },
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

    if (includeUnframed) {
      tmpDirNoBg = path.join(os.tmpdir(), `worker-frameit-nobg-${Date.now()}`);
      fs.mkdirSync(tmpDirNoBg, { recursive: true });

      for (const img of images) {
        const basename = img.filename.replace(/\.[^.]+$/, "");
        const src = path.join(tmpDir, basename + ".png");
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(tmpDirNoBg, basename + ".png"));
        }
      }

      const frameitFontNoBg = copyFrameitFont(fontSourcePath, tmpDirNoBg);
      const defaultSectionNoBg = buildTitleSection(title, subtitle, textColor, fallbackLayout, frameitFontNoBg);

      fs.writeFileSync(
        path.join(tmpDirNoBg, "Framefile.json"),
        JSON.stringify(
          { device_frame_version: "latest", default: defaultSectionNoBg, data: buildEntries(frameitFontNoBg, false) },
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

    const [combinedOutput] = await Promise.all([runFrameit(tmpDir), ...(tmpDirNoBg ? [runFrameit(tmpDirNoBg)] : [])]);

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

    const gravityFor = (base: string) => {
      const layout = layoutByBase.get(base) ?? "center";
      return layout === "top" ? "north" : layout === "bottom" ? "south" : "centre";
    };

    const processFramedFiles = async (
      dir: string,
      files: string[],
    ): Promise<Array<{ filename: string; data: string }>> => {
      const result: Array<{ filename: string; data: string }> = [];
      for (const f of files) {
        const raw = await fs.promises.readFile(path.join(dir, f));
        const srcBase = f.replace(/_framed\.png$/, "");
        const dims = outputDims.get(srcBase) ?? { w: maxW, h: maxH };
        const finalBuf = await sharp(raw)
          .resize(dims.w, dims.h, { fit: "cover", position: gravityFor(srcBase) })
          .png()
          .toBuffer();
        result.push({ filename: srcBase + ".png", data: finalBuf.toString("base64") });
      }
      return result;
    };

    const noBgFiles = tmpDirNoBg ? fs.readdirSync(tmpDirNoBg).filter(isRealFrame) : [];
    const [framedImages, unframedImages] = await Promise.all([
      processFramedFiles(tmpDir, framedFiles),
      tmpDirNoBg ? processFramedFiles(tmpDirNoBg, noBgFiles) : Promise.resolve([]),
    ]);

    res.json({ ok: true, framedImages, unframedImages });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    for (const dir of [tmpDir, tmpDirNoBg].filter(Boolean)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
});
