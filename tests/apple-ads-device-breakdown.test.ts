import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deviceStatsFromRows } from "../src/services/apple-ads-breakdowns";

describe("apple ads device breakdown: rows", () => {
  it("maps deviceClass metadata to stats sorted by spend", () => {
    const rows = [
      {
        metadata: { deviceClass: "iPad" },
        total: { localSpend: { amount: "2.50" }, impressions: 100, taps: 20, totalInstalls: 10 },
      },
      {
        metadata: { deviceClass: "iPhone" },
        total: { localSpend: { amount: "10.00" }, impressions: 1000, taps: 100, totalInstalls: 5 },
      },
    ];

    const devices = deviceStatsFromRows(rows);

    assert.deepEqual(
      devices.map((d) => d.deviceClass),
      ["iPhone", "iPad"],
    );
    assert.equal(devices[0].spend, 10);
    assert.equal(devices[0].conversionRate, 0.05);
    assert.equal(devices[1].spend, 2.5);
    assert.equal(devices[1].conversionRate, 0.5);
  });

  it("drops rows without a deviceClass and handles empty input", () => {
    assert.deepEqual(deviceStatsFromRows([]), []);
    assert.deepEqual(deviceStatsFromRows([{ metadata: {}, total: {} }, { total: {} }]), []);
  });
});
