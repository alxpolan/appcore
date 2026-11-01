import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLocalBezelImage } from "../src/services/screenshot-studio/overlays";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bezels-"));

after(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

describe("readLocalBezelImage", () => {
  it("returns the stored file", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await fs.promises.writeFile(path.join(dir, "Apple iPhone 16 Pro Max Black Titanium.png"), png);

    const found = await readLocalBezelImage("Apple iPhone 16 Pro Max Black Titanium.png", dir);

    assert.ok(found);
    assert.deepEqual([...found], [...png]);
  });

  it("returns null for missing files", async () => {
    assert.equal(await readLocalBezelImage("Apple iPhone 99 Pink.png", dir), null);
  });

  it("returns null for empty files", async () => {
    await fs.promises.writeFile(path.join(dir, "empty.png"), Buffer.alloc(0));

    assert.equal(await readLocalBezelImage("empty.png", dir), null);
  });
});
