import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStudioDraft } from "../src/services/screenshot-studio/drafts";
import { DEFAULT_STUDIO_STYLE } from "../src/services/screenshot-studio/style";

describe("studio draft normalization", () => {
  it("fills style defaults and keeps valid style values", () => {
    const draft = normalizeStudioDraft({ style: { font: "inter", offsetX: 12 }, styles: {}, titles: {} });

    assert.equal(draft.style.font, "inter");
    assert.equal(draft.style.offsetX, 12);
    assert.equal(draft.style.bgColor1, DEFAULT_STUDIO_STYLE.bgColor1);
    assert.deepEqual(draft.styles, {});
    assert.deepEqual(draft.titles, {});
  });

  it("keeps only known per-shot style keys and drops empty patches", () => {
    const draft = normalizeStudioDraft({
      styles: {
        "shot__a.png": { offsetX: 5, bogus: 1, titleLines: ["x"] },
        "shot__b.png": { bogus: 2 },
        broken: 42,
      },
    });

    assert.deepEqual(draft.styles, { "shot__a.png": { offsetX: 5 } });
  });

  it("keeps only string titles per locale", () => {
    const draft = normalizeStudioDraft({
      titles: { "en-US": { "a.png": "Hello", "b.png": 42 }, broken: [1], "de-DE": "nope" },
    });

    assert.deepEqual(draft.titles, { "en-US": { "a.png": "Hello" } });
  });

  it("handles nullish input", () => {
    const draft = normalizeStudioDraft(null);

    assert.equal(draft.style.textPosition, "top");
    assert.deepEqual(draft.styles, {});
    assert.deepEqual(draft.titles, {});
  });
});
