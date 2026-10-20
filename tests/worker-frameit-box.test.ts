import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { clipLineToBox } from "../worker/src/routes/frameit-shift";
import { frameComplexBatch } from "../src/services/screenshot-studio/complex";
import { workerClient } from "../src/services/worker-client";
import { DEFAULT_STUDIO_STYLE } from "../src/services/screenshot-studio/style";

describe("worker shift: line clip stays inside the ink", () => {
  it("keeps a fully visible line intact", () => {
    assert.deepEqual(clipLineToBox(500, 100, 100, 50, 0, 0, 1290, 320), { left: 0, top: 0, width: 500, height: 100 });
  });

  it("clips overhanging ink to the box", () => {
    assert.deepEqual(clipLineToBox(900, 120, 0, 40, 100, 0, 700, 320), {
      left: 100,
      top: 0,
      width: 700,
      height: 120,
    });
  });

  it("drops sub-pixel slivers instead of throwing", () => {
    assert.equal(clipLineToBox(900, 120, 0, 40, 899.7, 0, 500, 320), null);
  });

  it("clamps rounding overflow back into the ink", () => {
    assert.deepEqual(clipLineToBox(900, 120, 0, 40, 100.5, 0, 2000, 320), {
      left: 101,
      top: 0,
      width: 799,
      height: 120,
    });
  });

  it("drops lines fully outside the box", () => {
    assert.equal(clipLineToBox(500, 100, 0, 40, 1000, 0, 100, 320), null);
  });
});

describe("studio complex: failed batches name their shots", () => {
  const realFrameit = workerClient.frameit.bind(workerClient);
  let tmpDir = "";

  afterEach(() => {
    workerClient.frameit = realFrameit;

    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("includes locale and basenames in worker errors", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "studio-complex-"));
    const srcDir = path.join(tmpDir, "raw", "en-US");
    await fs.promises.mkdir(srcDir, { recursive: true });
    await fs.promises.writeFile(path.join(srcDir, "01_home.png"), "raw-bytes");

    workerClient.frameit = (async () => ({ ok: false, framedImages: [], error: "extract_area: bad extract area" })) as typeof workerClient.frameit;

    await assert.rejects(
      frameComplexBatch({
        srcDir,
        outDir: path.join(tmpDir, "rev1", "de-DE"),
        shots: [{ filename: "01_home.png", base: "01_home", style: DEFAULT_STUDIO_STYLE }],
        titles: new Map([["01_home", "Home"]]),
        style: DEFAULT_STUDIO_STYLE,
      }),
      /Worker frameit failed for de-DE \(01_home\): extract_area: bad extract area/,
    );
  });
});
