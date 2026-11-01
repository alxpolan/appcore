import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewFrameOverride } from "../web/src/components/screenshots/studioPreview";

describe("buildPreviewFrameOverride", () => {
  it("maps option and device geometry into a frame entry", () => {
    assert.deepEqual(
      buildPreviewFrameOverride(
        "1320x2868",
        true,
        { frameW: 1470, frameH: 3000 },
        { offsetX: 75, offsetY: 66, width: 1320, rounded: true },
        "blob:preview-bezel",
      ),
      {
        key: "1320x2868",
        entry: {
          file: "blob:preview-bezel",
          frameW: 1470,
          frameH: 3000,
          offX: 75,
          offY: 66,
          shotW: 1320,
          triple: true,
          rounded: true,
        },
      },
    );
  });

  it("keeps key, triple flag and blob file as given", () => {
    const override = buildPreviewFrameOverride(
      "750x1334",
      false,
      { frameW: 871, frameH: 1776 },
      { offsetX: 61, offsetY: 219, width: 750, rounded: false },
      "blob:other",
    );

    assert.equal(override.key, "750x1334");
    assert.equal(override.entry.triple, false);
    assert.equal(override.entry.rounded, false);
    assert.equal(override.entry.file, "blob:other");
  });
});
