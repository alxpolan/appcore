import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveStudioDeleteTarget } from "../web/src/components/screenshots/studioApi";

describe("resolveStudioDeleteTarget", () => {
  it("targets the selected overlay", () => {
    assert.deepEqual(resolveStudioDeleteTarget("overlay-1", null, "Some title"), {
      kind: "overlay",
      id: "overlay-1",
    });
  });

  it("prefers the overlay over a selected layer", () => {
    assert.deepEqual(resolveStudioDeleteTarget("overlay-2", "caption", "Some title"), {
      kind: "overlay",
      id: "overlay-2",
    });
  });

  it("clears the caption when the caption layer holds text", () => {
    assert.deepEqual(resolveStudioDeleteTarget(null, "caption", "Some title"), { kind: "caption" });
  });

  it("does nothing for an empty caption", () => {
    assert.equal(resolveStudioDeleteTarget(null, "caption", "   "), null);
  });

  it("does nothing for structural layers", () => {
    assert.equal(resolveStudioDeleteTarget(null, "device", "Some title"), null);
    assert.equal(resolveStudioDeleteTarget(null, "image", "Some title"), null);
    assert.equal(resolveStudioDeleteTarget(null, "background", "Some title"), null);
  });

  it("does nothing without a selection", () => {
    assert.equal(resolveStudioDeleteTarget(null, null, "Some title"), null);
  });
});
