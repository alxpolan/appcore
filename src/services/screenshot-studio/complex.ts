import fs from "fs";
import path from "path";
import { workerClient } from "../worker-client";
import type { StudioStyle } from "./style";

export interface ComplexShot {
  filename: string;
  base: string;
  style: StudioStyle;
}

function overlayFileForJob(jobId: string, url: string): string | null {
  const prefix = `/screenshots/${jobId}/overlays/`;

  if (!url.startsWith(prefix)) return null;

  const file = url.slice(prefix.length);

  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/i.test(file) || file.includes("..")) return null;

  return file;
}

function readOverlayPayloads(
  jobId: string | undefined,
  overlays: StudioStyle["overlays"],
): Array<{ data: string; x: number; y: number; scale: number; rotation: number }> {
  if (!jobId || !Array.isArray(overlays) || overlays.length === 0) return [];

  const out: Array<{ data: string; x: number; y: number; scale: number; rotation: number }> = [];

  for (const overlay of overlays) {
    const file = overlayFileForJob(jobId, overlay.url);

    if (!file) continue;

    try {
      const data = fs.readFileSync(path.join(process.cwd(), "screenshots", jobId, "overlays", file));

      out.push({
        data: data.toString("base64"),
        x: overlay.x,
        y: overlay.y,
        scale: overlay.scale,
        rotation: overlay.rotation ?? 0,
      });
    } catch {
      continue;
    }
  }

  return out;
}

export async function frameComplexBatch(args: {
  srcDir: string;
  outDir: string;
  shots: ComplexShot[];
  titles: Map<string, string>;
  style: StudioStyle;
  jobId?: string;
  log?: (msg: string) => void;
}): Promise<void> {
  const images = args.shots.map((shot) => ({
    filename: shot.filename,
    data: fs.readFileSync(path.join(args.srcDir, shot.filename)).toString("base64"),
    title: args.titles.get(shot.base) ?? "",
    offsetX: shot.style.offsetX,
    offsetY: shot.style.offsetY,
    titleOffsetX: shot.style.titleOffsetX,
    titleOffsetY: shot.style.titleOffsetY,
    titleScale: shot.style.titleScale,
    deviceScale: shot.style.deviceScale,
    titleBoxW: shot.style.titleBoxW,
    titleBoxH: shot.style.titleBoxH,
    titleLines: shot.style.titleLines,
    bezelFile: shot.style.deviceFrame || undefined,
    rotation: shot.style.rotation ?? 0,
    titleRotation: shot.style.titleRotation ?? 0,
    overlays: readOverlayPayloads(args.jobId, shot.style.overlays),
  }));

  const result = await workerClient.frameit({
    images,
    options: {
      title: " ",
      bgColor1: args.style.bgColor1,
      bgColor2: args.style.bgColor2,
      textColor: args.style.textColor,
      layoutMode: args.style.textPosition === "bottom" ? "bottom" : "top",
      fontFamily: args.style.font,
    },
  });

  if (!result.ok) {
    const where = `${path.basename(args.outDir)} (${args.shots.map((shot) => shot.base).join(", ")})`;

    throw new Error(`Worker frameit failed for ${where}: ${result.error ?? "unknown error"}`);
  }

  args.log?.(`[framing] Worker frames: ${result.fontUsed ?? "font not reported"}`);

  const framedByBase = new Map(result.framedImages.map((img) => [img.filename.replace(/\.[^.]+$/, ""), img.data]));

  fs.mkdirSync(args.outDir, { recursive: true });

  for (const shot of args.shots) {
    const data = framedByBase.get(shot.base);

    if (!data) throw new Error(`Worker returned no image for ${shot.base}`);

    await fs.promises.writeFile(path.join(args.outDir, `${shot.base}.png`), Buffer.from(data, "base64"));
  }
}
