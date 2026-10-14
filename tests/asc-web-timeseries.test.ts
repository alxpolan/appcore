import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectUnknownStorefrontKeys,
  downloadRemainderPerDay,
  parseGroupedWebTimeseries,
  parseWebTimeseries,
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
      { dateStr: "2026-10-07", territory: "GB", downloads: 1 },
      { dateStr: "2026-10-07", territory: "US", downloads: 1 },
      { dateStr: "2026-10-07", territory: "ZZ", downloads: 4 },
      { dateStr: "2026-10-08", territory: "US", downloads: 2 },
    ]);
  });

  it("ignores other measures and collects unknown keys", () => {
    assert.deepEqual(parseGroupedWebTimeseries({ results: [{ totals: { key: "units" }, data: [] }] }), []);
    assert.deepEqual(collectUnknownStorefrontKeys(body), ["999999"]);
    assert.deepEqual(collectUnknownStorefrontKeys({}), []);
  });

  it("computes the unattributed remainder per day", () => {
    const remainder = downloadRemainderPerDay({
      unitsByDate: new Map([
        ["2026-10-07", 7],
        ["2026-10-08", 2],
      ]),
      grouped: [
        { dateStr: "2026-10-07", territory: "US", downloads: 3 },
        { dateStr: "2026-10-07", territory: "GB", downloads: 1 },
        { dateStr: "2026-10-08", territory: "US", downloads: 2 },
      ],
      official: [
        { dateStr: "2026-10-07", territory: "GB", downloads: 5 },
        { dateStr: "2026-10-07", territory: "DE", downloads: 2 },
      ],
    });
    // 10-07: 7 units - 4 grouped - 2 uncovered official (DE; GB is covered) = 1
    // 10-08: 2 units - 2 grouped = 0
    assert.deepEqual(
      [...remainder.entries()],
      [
        ["2026-10-07", 1],
        ["2026-10-08", 0],
      ],
    );
  });
});
