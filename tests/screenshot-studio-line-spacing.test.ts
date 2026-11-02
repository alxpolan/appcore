import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStudioStyle } from "../src/services/screenshot-studio/style";
import { normalizeStudioDraft } from "../src/services/screenshot-studio/drafts";
import { fitTitleBlock } from "../web/src/components/screenshots/studioPreview";
import { applyStudioGeometry } from "../web/src/components/screenshots/studioApply";
import type { StudioItem } from "../web/src/components/screenshots/studioApi";

describe("caption line spacing", () => {
  it("preserves the existing default and bounds invalid input", () => {
    assert.equal(normalizeStudioStyle({}).titleLineHeight, 1.2);
    assert.equal(normalizeStudioStyle({ titleLineHeight: NaN }).titleLineHeight, 1.2);
    assert.equal(normalizeStudioStyle({ titleLineHeight: 0 }).titleLineHeight, 1);
    assert.equal(normalizeStudioStyle({ titleLineHeight: 10 }).titleLineHeight, 2.5);
    assert.equal(normalizeStudioStyle({ titleLineHeight: 1.456 }).titleLineHeight, 1.46);
  });

  it("fits taller line spacing within the caption box", () => {
    const ctx = { font: "", measureText: (text: string) => ({ width: text.length * 20 }) } as CanvasRenderingContext2D;
    const normal = fitTitleBlock(ctx, "alpha beta", "Test", 140, 260, 100);
    const wider = fitTitleBlock(ctx, "alpha beta", "Test", 140, 260, 100, 1.8);
    assert.equal(normal.lines.length, 2);
    assert.equal(normal.size, 100);
    assert.ok(wider.size < normal.size);
    assert.ok(wider.lines.length * wider.size * 1.8 <= 260);
    assert.deepEqual(normal, fitTitleBlock(ctx, "alpha beta", "Test", 140, 260, 100, 1.2));
  });

  it("persists per-language line spacing in drafts and includes it in Apply", () => {
    const selected: StudioItem = { basename: "shot.png", deviceLabel: "iPhone", title: "Caption", url: "", rawUrl: null, descKey: null, hasRaw: true };
    const overrides = { "en-US": { "shot.png": { titleLineHeight: 1.8 } }, "de-DE": {} };
    const draft = normalizeStudioDraft({ styles: overrides });
    assert.deepEqual(draft.styles, overrides);
    const applied = applyStudioGeometry(overrides, [
      { locale: "en-US", items: [selected], styles: {} },
      { locale: "de-DE", items: [selected], styles: {} },
    ], "en-US", selected, normalizeStudioStyle({ titleLineHeight: 1.8 }), "screen-all");
    assert.equal(applied["de-DE"]["shot.png"].titleLineHeight, 1.8);
  });
});
