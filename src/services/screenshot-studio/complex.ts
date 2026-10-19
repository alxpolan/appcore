import fs from "fs";
import path from "path";
import { workerClient } from "../worker-client";
import type { StudioStyle } from "./style";

export interface ComplexShot {
  filename: string;
  base: string;
}

export async function frameComplexBatch(args: {
  srcDir: string;
  outDir: string;
  shots: ComplexShot[];
  titles: Map<string, string>;
  style: StudioStyle;
  log?: (msg: string) => void;
}): Promise<void> {
  const images = args.shots.map((shot) => ({
    filename: shot.filename,
    data: fs.readFileSync(path.join(args.srcDir, shot.filename)).toString("base64"),
    title: args.titles.get(shot.base) ?? "",
    offsetX: args.style.offsetX,
    offsetY: args.style.offsetY,
    titleOffsetX: args.style.titleOffsetX,
    titleOffsetY: args.style.titleOffsetY,
    titleScale: args.style.titleScale,
    deviceScale: args.style.deviceScale,
    titleBoxW: args.style.titleBoxW,
    titleBoxH: args.style.titleBoxH,
    titleLines: args.style.titleLines,
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
    throw new Error(`Worker frameit failed: ${result.error ?? "unknown error"}`);
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
