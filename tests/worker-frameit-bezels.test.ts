import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bezelColorLabel, groupBezelFiles } from "../worker/src/routes/frameit-devices";

describe("frameit bezels: color labels", () => {
  it("strips the brand and device family", () => {
    assert.equal(bezelColorLabel("Apple iPhone 16 Pro Max Natural Titanium.png", "iPhone 16 Pro Max"), "Natural Titanium");
    assert.equal(bezelColorLabel("Apple iPhone 16 Black.png", "iPhone 16"), "Black");
    assert.equal(bezelColorLabel("Apple iPad Pro Space Gray.png", "iPad Pro"), "Space Gray");
  });

  it("falls back to the file name without extension", () => {
    assert.equal(bezelColorLabel("Apple iPhone 8 Space Gray.png", "iPhone SE"), "iPhone 8 Space Gray");
  });
});

describe("frameit bezels: family grouping", () => {
  it("groups by the most specific device first", () => {
    const groups = groupBezelFiles([
      "Apple iPhone 16 Black.png",
      "Apple iPhone 16 Pro Max Natural Titanium.png",
      "Apple iPhone 16 Pro Max White.png",
      "Apple Watch Ultra.png",
    ]);

    assert.deepEqual(
      groups.map((group) => group.match),
      ["iPhone 16 Pro Max", "iPhone 16", "Other"],
    );
    assert.deepEqual(
      groups[0].options.map((option) => option.color),
      ["Natural Titanium", "White"],
    );
  });
});
