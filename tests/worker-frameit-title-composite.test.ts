import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { composeTitleLines, renderBaseFrame } from "../worker/src/routes/frameit-native";

const png = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

async function opaquePixels(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] === 255) opaque++;
  return opaque;
}

describe("native caption composition", () => {
  it("retains a glyph raster taller than its nominal line height", async () => {
    const ink = { buf: await png(80, 190, "#ffffff"), w: 80, h: 190 };
    const title = await composeTitleLines([{ ink, lineIndex: 0 }], 1, 180);
    assert.ok(title);
    assert.equal(title.w, 80);
    assert.equal(title.h, 190);
    assert.equal(await opaquePixels(title.buf), 80 * 190);
  });

  it("retains the original geometry of lines that fit their slots", async () => {
    const ink = { buf: await png(80, 100, "#ffffff"), w: 80, h: 100 };
    const title = await composeTitleLines([{ ink, lineIndex: 0 }], 1, 180);
    assert.ok(title);
    assert.equal(title.h, 180);
    const { data, info } = await sharp(title.buf).raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[(39 * info.width) * info.channels + 3], 0);
    assert.equal(data[(40 * info.width) * info.channels + 3], 255);
    assert.equal(await opaquePixels(title.buf), 80 * 100);
  });

  it("preserves line spacing and both edges when first and last lines overflow", async () => {
    const first = { buf: await png(40, 190, "#ff0000"), w: 40, h: 190 };
    const last = { buf: await png(60, 200, "#0000ff"), w: 60, h: 200 };
    const title = await composeTitleLines([{ ink: first, lineIndex: 0 }, { ink: last, lineIndex: 2 }], 3, 180);
    assert.ok(title);
    assert.equal(title.w, 60);
    assert.equal(title.h, 555);
    assert.equal(await opaquePixels(title.buf), 40 * 190 + 60 * 200);
    const { data, info } = await sharp(title.buf).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.deepEqual(pixel(10, 0), [255, 0, 0, 255]);
    assert.deepEqual(pixel(0, 554), [0, 0, 255, 255]);
  });

  it("handles fractional line spacing and empty captions", async () => {
    assert.equal(await composeTitleLines([], 0, 180), null);
    const ink = { buf: await png(25, 70, "#ffffff"), w: 25, h: 70 };
    const title = await composeTitleLines([{ ink, lineIndex: 0 }], 1, 52.5);
    assert.ok(title);
    assert.equal(title.h, 70);
    assert.equal(await opaquePixels(title.buf), 25 * 70);
  });
});

const thaiFont = "/System/Library/Fonts/Supplemental/Krungthep.ttf";
const canRenderThai = fs.existsSync(thaiFont) && spawnSync("magick", ["-version"]).status === 0;
it("renders a full Thai iPad frame whose ink exceeds the nominal line height", { skip: !canRenderThai }, async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frameit-thai-test-"));
  try {
    const [screenshot, bezel, background] = await Promise.all([
      png(2048, 2732, "#dddddd"), png(2240, 2936, "#00000000"), png(2048, 2732, "#667eea"),
    ]);
    const output = await renderBaseFrame({
      screenshot, bezel, background, work: { w: 2048, h: 2732 }, layout: "top",
      title: "ติดตามโปรเจกต์ของคุณ", textColor: "#ffffff", fontPath: thaiFont,
      device: { bezelFile: "test.png", width: 2048, offsetX: 96, offsetY: 102, roundedScreenCorners: false }, tmpDir,
    });
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, 2048);
    assert.equal(meta.height, 2732);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});
