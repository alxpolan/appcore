import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectUnknownStorefrontKeys,
  parseGroupedWebTimeseries,
  parseWebTimeseries,
  splitRemainderPerDay,
} from "../src/services/utils/asc-web-timeseries";

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

describe("asc web analytics: grouped timeseries parsing", () => {
  const body = {
    size: 3,
    results: [
      {
        group: { key: "143441", title: "United States" },
        data: [
          { totalDownloads: 1, date: "2026-10-07T00:00:00Z" },
          { totalDownloads: 2, date: "2026-10-08T00:00:00Z" },
        ],
        totals: { value: 3, type: "COUNT", key: "totalDownloads" },
        meetsThreshold: true,
      },
      {
        group: { key: "143444", title: "United Kingdom" },
        data: [{ totalDownloads: 1, date: "2026-10-07T00:00:00Z" }],
        totals: { value: 1, type: "COUNT", key: "totalDownloads" },
        meetsThreshold: true,
      },
      {
        group: { key: "999999", title: "Mystery Land" },
        data: [{ totalDownloads: 4, date: "2026-10-07T00:00:00Z" }],
        totals: { value: 4, type: "COUNT", key: "totalDownloads" },
        meetsThreshold: true,
      },
    ],
  };

  it("maps storefront groups to territories", () => {
    assert.deepEqual(parseGroupedWebTimeseries(body), [
      { dateStr: "2026-10-07", territory: "GB", downloads: 1, trials: 0, proceedsUsd: 0 },
      { dateStr: "2026-10-07", territory: "US", downloads: 1, trials: 0, proceedsUsd: 0 },
      { dateStr: "2026-10-07", territory: "ZZ", downloads: 4, trials: 0, proceedsUsd: 0 },
      { dateStr: "2026-10-08", territory: "US", downloads: 2, trials: 0, proceedsUsd: 0 },
    ]);
  });

  it("fills only the field matching the measure key", () => {
    const rows = parseGroupedWebTimeseries({
      results: [
        {
          group: { key: "143441", title: "United States" },
          data: [{ "subscription-events-offerStarts-freeTrial": 2, date: "2026-10-07T00:00:00Z" }],
          totals: { value: 2, type: "COUNT", key: "subscription-events-offerStarts-freeTrial" },
        },
        {
          group: { key: "143441", title: "United States" },
          data: [{ proceeds: 9.5, date: "2026-10-07T00:00:00Z" }],
          totals: { value: 9.5, type: "COUNT", key: "proceeds" },
        },
      ],
    });
    assert.deepEqual(rows, [{ dateStr: "2026-10-07", territory: "US", downloads: 0, trials: 2, proceedsUsd: 9.5 }]);
  });

  it("ignores other measures and collects unknown keys", () => {
    assert.deepEqual(parseGroupedWebTimeseries({ results: [{ totals: { key: "units" }, data: [] }] }), []);
    assert.deepEqual(collectUnknownStorefrontKeys(body), ["999999"]);
    assert.deepEqual(collectUnknownStorefrontKeys({}), []);
  });

  it("computes the unattributed remainder per day", () => {
    const remainder = splitRemainderPerDay({
      totalsByDate: new Map([
        ["2026-10-07", 7],
        ["2026-10-08", 2],
      ]),
      split: [
        { dateStr: "2026-10-07", territory: "US", value: 3 },
        { dateStr: "2026-10-07", territory: "GB", value: 1 },
        { dateStr: "2026-10-08", territory: "US", value: 2 },
      ],
      legacy: [
        { dateStr: "2026-10-07", territory: "GB", value: 5 },
        { dateStr: "2026-10-07", territory: "DE", value: 2 },
      ],
    });
    // 10-07: 7 total - 4 split - 2 uncovered legacy (DE; GB is covered) = 1
    // 10-08: 2 total - 2 split = 0
    assert.deepEqual(
      [...remainder.entries()],
      [
        ["2026-10-07", 1],
        ["2026-10-08", 0],
      ],
    );
  });
});
