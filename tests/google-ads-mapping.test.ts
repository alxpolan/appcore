import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAppleMetricsByCampaign,
  attachCampaignMappings,
  filterCampaignsByApp,
  mergeCampaignDayMetrics,
  needsCampaignBackfill,
  sumMergedDownloadsPerDay,
  parseCtParam,
  withCtParam,
} from "../src/services/utils/google-ads-mapping";

describe("google ads: campaign mappings", () => {
  const campaigns = [
    { id: "111", name: "Brand iOS", status: "ENABLED" },
    { id: "222", name: "Generic", status: "PAUSED" },
  ];

  it("attaches mappings by campaign id", () => {
    assert.deepEqual(
      attachCampaignMappings(campaigns, [
        { googleCampaignId: "222", appId: "app1", appName: "Calc", ctToken: "abc123" },
      ]),
      [
        { id: "111", name: "Brand iOS", status: "ENABLED", mapping: null },
        {
          id: "222",
          name: "Generic",
          status: "PAUSED",
          mapping: { appId: "app1", appName: "Calc", ctToken: "abc123" },
        },
      ],
    );
  });

  it("returns null mappings when nothing is stored", () => {
    const result = attachCampaignMappings(campaigns, []);
    assert.deepEqual(
      result.map((c) => c.mapping),
      [null, null],
    );
  });

  it("ignores mappings for unknown campaigns", () => {
    const result = attachCampaignMappings(campaigns, [
      { googleCampaignId: "999", appId: "app1", appName: "Calc", ctToken: "zzz" },
    ]);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((c) => c.mapping),
      [null, null],
    );
  });

  it("handles an empty campaign list", () => {
    assert.deepEqual(
      attachCampaignMappings([], [
        { googleCampaignId: "111", appId: "app1", appName: "Calc", ctToken: "abc" },
      ]),
      [],
    );
  });
});

describe("google ads: filter campaigns by app", () => {
  const campaigns = [
    { id: "111", name: "Brand iOS", status: "ENABLED" },
    { id: "222", name: "Generic", status: "PAUSED" },
  ];

  it("keeps only assigned campaigns", () => {
    assert.deepEqual(filterCampaignsByApp(campaigns, ["222"]), [
      { id: "222", name: "Generic", status: "PAUSED" },
    ]);
  });

  it("hides everything when nothing is assigned", () => {
    assert.deepEqual(filterCampaignsByApp(campaigns, []), []);
  });

  it("ignores assigned ids that no longer exist", () => {
    assert.deepEqual(filterCampaignsByApp(campaigns, ["999"]), []);
  });
});

describe("google ads: aggregate apple metrics by campaign", () => {
  const keys = [
    { googleCampaignId: "111", bundleId: "com.example.app", ctToken: "tok1" },
    { googleCampaignId: "222", bundleId: "com.example.app", ctToken: "tok2" },
  ];

  it("sums rows per campaign across days", () => {
    const result = aggregateAppleMetricsByCampaign(
      [
        { bundleId: "com.example.app", campaign: "tok1", downloads: 10, trials: 3, purchases: 1, proceedsUsd: 5 },
        { bundleId: "com.example.app", campaign: "tok1", downloads: 4, trials: 1, purchases: 0, proceedsUsd: 0 },
        { bundleId: "com.example.app", campaign: "tok2", downloads: 2, trials: 0, purchases: 2, proceedsUsd: 12.5 },
      ],
      keys,
    );
    assert.deepEqual(
      [...result.entries()],
      [
        ["111", { downloads: 14, trials: 4, purchases: 1, proceedsUsd: 5 }],
        ["222", { downloads: 2, trials: 0, purchases: 2, proceedsUsd: 12.5 }],
      ],
    );
  });

  it("ignores rows for unknown tokens or bundles", () => {
    const result = aggregateAppleMetricsByCampaign(
      [
        { bundleId: "com.example.app", campaign: "other", downloads: 7, trials: 7, purchases: 7, proceedsUsd: 7 },
        { bundleId: "com.other.app", campaign: "tok1", downloads: 7, trials: 7, purchases: 7, proceedsUsd: 7 },
      ],
      keys,
    );
    assert.equal(result.size, 0);
  });

  it("returns an empty map without rows", () => {
    assert.equal(aggregateAppleMetricsByCampaign([], keys).size, 0);
  });

  it("sums territory split and remainder downloads", () => {
    const result = aggregateAppleMetricsByCampaign(
      [
        { bundleId: "com.example.app", campaign: "tok1", reportDate: new Date("2026-10-03T00:00:00Z"), territory: "DE", downloads: 10, trials: 0, purchases: 0, proceedsUsd: 0 },
        { bundleId: "com.example.app", campaign: "tok1", reportDate: new Date("2026-10-03T00:00:00Z"), territory: "XW", downloads: 2, trials: 1, purchases: 0, proceedsUsd: 0 },
        { bundleId: "com.example.app", campaign: "tok1", reportDate: new Date("2026-10-04T00:00:00Z"), territory: "XW", downloads: 7, trials: 2, purchases: 1, proceedsUsd: 4 },
      ],
      keys,
    );
    assert.deepEqual(result.get("111"), { downloads: 19, trials: 3, purchases: 1, proceedsUsd: 4 });
  });
});

describe("google ads: merge campaign day metrics", () => {
  it("collapses territories to one row per day with download source", () => {
    assert.deepEqual(
      mergeCampaignDayMetrics([
        { date: "2026-10-03", territory: "DE", downloads: 10, trials: 0, purchases: 0, proceedsUsd: 0 },
        { date: "2026-10-03", territory: "XW", downloads: 2, trials: 1, purchases: 0, proceedsUsd: 0 },
        { date: "2026-10-04", territory: "XW", downloads: 7, trials: 2, purchases: 1, proceedsUsd: 4 },
        { date: "2026-10-05", territory: "DE", downloads: 0, trials: 0, purchases: 0, proceedsUsd: 0 },
        { date: "2026-10-06", territory: "DE", downloads: 3, trials: 0, purchases: 0, proceedsUsd: 0 },
      ]),
      [
        { date: "2026-10-03", downloads: 12, trials: 1, purchases: 0, proceedsUsd: 0, downloadsSource: "web" },
        { date: "2026-10-04", downloads: 7, trials: 2, purchases: 1, proceedsUsd: 4, downloadsSource: "web" },
        { date: "2026-10-05", downloads: 0, trials: 0, purchases: 0, proceedsUsd: 0, downloadsSource: "none" },
        { date: "2026-10-06", downloads: 3, trials: 0, purchases: 0, proceedsUsd: 0, downloadsSource: "official" },
      ],
    );
  });

  it("sums merged downloads per day across campaigns", () => {
    const result = sumMergedDownloadsPerDay([
      { bundleId: "b", campaign: "tok1", reportDate: new Date("2026-10-03T00:00:00Z"), territory: "DE", downloads: 10, trials: 0, purchases: 0, proceedsUsd: 0 },
      { bundleId: "b", campaign: "tok1", reportDate: new Date("2026-10-03T00:00:00Z"), territory: "XW", downloads: 2, trials: 1, purchases: 0, proceedsUsd: 0 },
      { bundleId: "b", campaign: "tok2", reportDate: new Date("2026-10-03T00:00:00Z"), territory: "XW", downloads: 7, trials: 0, purchases: 0, proceedsUsd: 0 },
      { bundleId: "b", campaign: "tok2", reportDate: new Date("2026-10-04T00:00:00Z"), territory: "XW", downloads: 3, trials: 0, purchases: 0, proceedsUsd: 0 },
      { bundleId: "b", campaign: "tok1", downloads: 99, trials: 0, purchases: 0, proceedsUsd: 0 },
    ]);
    assert.deepEqual([...result.entries()], [
      ["2026-10-03", 19],
      ["2026-10-04", 3],
    ]);
  });
});

describe("google ads: campaign backfill trigger", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("never backfills without mappings", () => {
    assert.equal(needsCampaignBackfill({ mappingCount: 0, oldestReportDate: null, now }), false);
    assert.equal(
      needsCampaignBackfill({ mappingCount: 0, oldestReportDate: daysAgo(5), now }),
      false,
    );
  });

  it("backfills when mappings exist but no rows do", () => {
    assert.equal(needsCampaignBackfill({ mappingCount: 2, oldestReportDate: null, now }), true);
  });

  it("backfills shallow history and stops once history is deep", () => {
    assert.equal(
      needsCampaignBackfill({ mappingCount: 1, oldestReportDate: daysAgo(3), now }),
      true,
    );
    assert.equal(
      needsCampaignBackfill({ mappingCount: 1, oldestReportDate: daysAgo(200), now }),
      false,
    );
  });

  it("parses ct params from final URLs", () => {
    assert.equal(parseCtParam("https://apps.apple.com/app/id1?ct=gads_x"), "gads_x");
    assert.equal(parseCtParam("https://apps.apple.com/app/id1"), null);
    assert.equal(parseCtParam("notaurl"), null);
  });

  it("appends ct params without clobbering", () => {
    assert.equal(
      withCtParam("https://apps.apple.com/app/id1", "gads_x"),
      "https://apps.apple.com/app/id1?ct=gads_x",
    );
    assert.equal(
      withCtParam("https://apps.apple.com/app/id1?ct=keep", "gads_x"),
      "https://apps.apple.com/app/id1?ct=keep",
    );
    assert.equal(withCtParam("notaurl", "gads_x"), "notaurl");
  });
});
