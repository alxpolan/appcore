import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBreakdowns,
  funnelRates,
  normalizeFlagValue,
  pickVariantUsers,
  splitUnassigned,
} from "../src/services/posthog-milestones";

describe("normalizeFlagValue", () => {
  it("stringifies and trims flag values", () => {
    assert.equal(normalizeFlagValue(" v1 "), "v1");
    assert.equal(normalizeFlagValue(true), "true");
    assert.equal(normalizeFlagValue(undefined), "");
    assert.equal(normalizeFlagValue(null), "");
  });
});

describe("pickVariantUsers", () => {
  it("matches users by their most frequent flag response", () => {
    const rows = [
      { distinctId: "a", response: "v1" },
      { distinctId: "a", response: "v1" },
      { distinctId: "a", response: "v2" },
      { distinctId: "b", response: "v2" },
      { distinctId: "c", response: true },
    ];

    assert.deepEqual(pickVariantUsers(rows, "v1"), ["a"]);
    assert.deepEqual(pickVariantUsers(rows, "v2"), ["b"]);
    assert.deepEqual(pickVariantUsers(rows, "true"), ["c"]);
  });

  it("ignores rows without a distinct id", () => {
    assert.deepEqual(pickVariantUsers([{ distinctId: "", response: "v1" }], "v1"), []);
  });

  it("ignores empty responses in favor of real flag values", () => {
    const rows = [
      { distinctId: "a", response: null },
      { distinctId: "a", response: null },
      { distinctId: "a", response: "v1" },
      { distinctId: "b", response: null },
    ];

    assert.deepEqual(pickVariantUsers(rows, "v1"), ["a"]);
    assert.deepEqual(pickVariantUsers(rows, ""), []);
  });
});

describe("splitUnassigned", () => {
  it("separates other-variant users from users without any flag event", () => {
    assert.deepEqual(splitUnassigned(["a", "b", "c", "d"], ["a", "b", "c"], new Set(["a"])), {
      other: ["b", "c"],
      none: ["d"],
    });
  });

  it("returns empty groups when everyone is assigned", () => {
    assert.deepEqual(splitUnassigned(["a"], ["a"], new Set(["a"])), { other: [], none: [] });
  });
});

describe("funnelRates", () => {
  it("computes step-to-step conversion", () => {
    assert.deepEqual(funnelRates([10, 5, 5, 0]), [null, 0.5, 1, 0]);
  });

  it("returns null when the previous step is zero", () => {
    assert.deepEqual(funnelRates([0, 5]), [null, null]);
  });

  it("handles empty input", () => {
    assert.deepEqual(funnelRates([]), []);
  });
});

describe("buildBreakdowns", () => {
  const milestones = [
    { eventName: "shown", minCount: 1, label: "Shown" },
    { eventName: "bought", minCount: 1, label: "Bought" },
  ];
  const countsByEvent = new Map([
    ["shown", new Map([["a", 1], ["b", 1], ["c", 1]])],
    ["bought", new Map([["a", 1]])],
  ]);

  it("counts completions per group and derives the funnel", () => {
    const [all, variant] = buildBreakdowns(milestones, countsByEvent, [
      { key: "all", label: "All", distinctIds: ["a", "b", "c"] },
      { key: "v1", label: "V1", distinctIds: ["a", "b"] },
    ]);

    assert.deepEqual(all, {
      key: "all",
      label: "All",
      totalInstalls: 3,
      completed: [3, 1],
      funnel: [null, 1 / 3],
    });
    assert.deepEqual(variant, {
      key: "v1",
      label: "V1",
      totalInstalls: 2,
      completed: [2, 1],
      funnel: [null, 0.5],
    });
  });
});
