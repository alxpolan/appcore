import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateDailyStats, mergeDailyStatsLists } from "../src/services/utils/apple-ads-daily";

describe("apple ads: daily stats aggregation", () => {
  const row = (campaignId: string, granularity: any[]) => ({ metadata: { campaignId }, granularity });

  it("sums granularity across campaign rows into sorted day buckets", () => {
    const rows = [
      row("1", [
        { date: "2026-10-02", localSpend: { amount: "1.5" }, impressions: 100, taps: 10, totalInstalls: 2 },
        { date: "2026-10-01", localSpend: { amount: "2" }, impressions: 50, taps: 5, totalInstalls: 1 },
      ]),
      row("2", [{ date: "2026-10-01", localSpend: { amount: "3" }, impressions: 70, taps: 7, totalInstalls: 3 }]),
    ];
    assert.deepEqual(aggregateDailyStats(rows), [
      { date: "2026-10-01", spend: 5, impressions: 120, taps: 12, installs: 4 },
      { date: "2026-10-02", spend: 1.5, impressions: 100, taps: 10, installs: 2 },
    ]);
  });

  it("filters rows by campaignId when given", () => {
    const rows = [
      row("1", [{ date: "2026-10-01", localSpend: { amount: "2" }, impressions: 50, taps: 5, totalInstalls: 1 }]),
      row("2", [{ date: "2026-10-01", localSpend: { amount: "3" }, impressions: 70, taps: 7, totalInstalls: 3 }]),
    ];
    assert.deepEqual(aggregateDailyStats(rows, "2"), [
      { date: "2026-10-01", spend: 3, impressions: 70, taps: 7, installs: 3 },
    ]);
  });

  it("skips malformed dates and tolerates missing metrics", () => {
    const rows = [
      row("1", [
        { date: "not-a-date", localSpend: { amount: "99" }, impressions: 999, taps: 999, totalInstalls: 999 },
        { date: "2026-10-01T00:00:00Z" },
        { granularity: null },
      ]),
      { metadata: { campaignId: "1" } },
    ];
    assert.deepEqual(aggregateDailyStats(rows), [
      { date: "2026-10-01", spend: 0, impressions: 0, taps: 0, installs: 0 },
    ]);
  });

  it("merges per-org lists by summing shared dates", () => {
    assert.deepEqual(
      mergeDailyStatsLists([
        [
          { date: "2026-10-01", spend: 2, impressions: 50, taps: 5, installs: 1 },
          { date: "2026-10-02", spend: 1, impressions: 10, taps: 1, installs: 0 },
        ],
        [{ date: "2026-10-01", spend: 3, impressions: 70, taps: 7, installs: 3 }],
      ]),
      [
        { date: "2026-10-01", spend: 5, impressions: 120, taps: 12, installs: 4 },
        { date: "2026-10-02", spend: 1, impressions: 10, taps: 1, installs: 0 },
      ],
    );
  });

  it("merges to an empty series when every org has no days", () => {
    assert.deepEqual(mergeDailyStatsLists([[], []]), []);
  });
});
