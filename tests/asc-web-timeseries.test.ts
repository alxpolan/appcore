import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWebTimeseries } from "../src/services/utils/asc-web-timeseries";

describe("asc web analytics: timeseries parsing", () => {
  const body = {
    meta: { adjustedForPrivacy: false },
    size: 3,
    results: [
      {
        adamId: "6761712226",
        group: null,
        data: [
          { "subscription-events-offerStarts-freeTrial": 1.0, date: "2026-10-03T00:00:00Z" },
          { "subscription-events-offerStarts-freeTrial": 0.0, date: "2026-10-04T00:00:00Z" },
        ],
        totals: { value: 1.0, type: "COUNT", key: "subscription-events-offerStarts-freeTrial" },
        meetsThreshold: true,
      },
      {
        adamId: "6761712226",
        group: null,
        data: [
          { "subscription-events-paidStarts": 2.0, date: "2026-10-03T00:00:00Z" },
          { "subscription-events-paidStarts": 0.0, date: "2026-10-04T00:00:00Z" },
        ],
        totals: { value: 2.0, type: "COUNT", key: "subscription-events-paidStarts" },
        meetsThreshold: true,
      },
      {
        adamId: "6761712226",
        group: null,
        data: [
          { proceeds: 4.0, date: "2026-10-03T00:00:00Z" },
          { proceeds: 0.0, date: "2026-10-04T00:00:00Z" },
        ],
        totals: { value: 4.0, type: "COUNT", key: "proceeds" },
        meetsThreshold: true,
      },
    ],
  };

  it("merges multi-measure results into day rows", () => {
    assert.deepEqual(parseWebTimeseries(body), [
      { dateStr: "2026-10-03", trials: 1, purchases: 2, proceedsUsd: 4, downloads: 0 },
      { dateStr: "2026-10-04", trials: 0, purchases: 0, proceedsUsd: 0, downloads: 0 },
    ]);
  });

  it("parses units into download day rows", () => {
    assert.deepEqual(
      parseWebTimeseries({
        results: [
          {
            totals: { key: "units" },
            data: [
              { units: 5, date: "2026-10-03T00:00:00Z" },
              { units: 0, date: "2026-10-04T00:00:00Z" },
            ],
          },
        ],
      }),
      [
        { dateStr: "2026-10-03", trials: 0, purchases: 0, proceedsUsd: 0, downloads: 5 },
        { dateStr: "2026-10-04", trials: 0, purchases: 0, proceedsUsd: 0, downloads: 0 },
      ],
    );
  });

  it("ignores unknown measures and malformed dates", () => {
    assert.deepEqual(
      parseWebTimeseries({
        results: [
          {
            totals: { key: "subscription-state-plans-active" },
            data: [{ "subscription-state-plans-active": 5, date: "2026-10-03T00:00:00Z" }],
          },
          {
            totals: { key: "proceeds" },
            data: [{ proceeds: 2, date: "not-a-date" }],
          },
        ],
      }),
      [],
    );
  });

  it("returns no rows for empty results", () => {
    assert.deepEqual(parseWebTimeseries({}), []);
    assert.deepEqual(parseWebTimeseries(null), []);
  });
});
