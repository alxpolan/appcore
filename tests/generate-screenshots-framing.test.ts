import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { screenshotFrameStyle } from "../src/services/generate-screenshots-framing";

describe("shared screenshot framing: style", () => {
  it("prefers the saved app standard over the frame config", () => {
    const result = screenshotFrameStyle(
      { bgColor1: "#999999", bgColor2: "#888888", textColor: "#000000", textPosition: "bottom" },
      { bgColor1: "#111111", bgColor2: "#222222", titleLines: ["Leftover"] },
    );

    assert.equal(result.usedPinnedDefault, true);
    assert.equal(result.style.bgColor1, "#111111");
    assert.equal(result.style.bgColor2, "#222222");
    assert.deepEqual(result.style.titleLines, []);
  });

  it("uses the frame config without a saved standard", () => {
    const result = screenshotFrameStyle(
      { bgColor1: "#999999", bgColor2: "#888888", textColor: "#000000", textPosition: "bottom" },
      null,
    );

    assert.equal(result.usedPinnedDefault, false);
    assert.equal(result.style.bgColor1, "#999999");
    assert.equal(result.style.textPosition, "bottom");
  });
});
