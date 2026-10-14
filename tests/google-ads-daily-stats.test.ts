import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateGoogleDailyStats } from "../src/services/utils/google-ads-daily";

describe("google ads: daily stats aggregation", () => {
  const row = (campaignId: string, date: string, metrics: any) => ({
    campaign: { id: campaignId },
    segments: { date },
    metrics,
  });
  const m = (costMicros: string, impressions: string, clicks: string, conversions = "0") => ({
    cost_micros: costMicros,
    impressions,
    clicks,
    conversions,
  });

  it("sums per-campaign day rows into sorted day buckets", () => {
    const rows = [
      row("1", "2026-10-02", m("1500000", "100", "10", "2")),
      row("1", "2026-10-01", m("2000000", "50", "5", "1")),
      row("2", "2026-10-01", m("3000000", "70", "7", "3")),
    ];
    assert.deepEqual(aggregateGoogleDailyStats(rows), [
      { date: "2026-10-01", spend: 5, impressions: 120, clicks: 12, conversions: 4 },
      { date: "2026-10-02", spend: 1.5, impressions: 100, clicks: 10, conversions: 2 },
    ]);
  });

  it("filters rows by campaign id when given", () => {
    const rows = [
      row("1", "2026-10-01", m("2000000", "50", "5", "1")),
      row("2", "2026-10-01", m("3000000", "70", "7", "3")),
    ];
    assert.deepEqual(aggregateGoogleDailyStats(rows, ["2"]), [
      { date: "2026-10-01", spend: 3, impressions: 70, clicks: 7, conversions: 3 },
    ]);
  });

  it("skips malformed dates and tolerates missing metrics", () => {
    const rows = [
      row("1", "not-a-date", m("99000000", "999", "999")),
      { campaign: { id: "1" }, segments: { date: "2026-10-01" }, metrics: {} },
      { campaign: { id: "1" }, segments: {} },
    ];
    assert.deepEqual(aggregateGoogleDailyStats(rows), [
      { date: "2026-10-01", spend: 0, impressions: 0, clicks: 0, conversions: 0 },
    ]);
  });
});
