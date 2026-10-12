import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAppleMetricsByCampaign,
  attachCampaignMappings,
  filterCampaignsByApp,
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
});

