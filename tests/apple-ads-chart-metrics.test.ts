import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FUNNEL_METRICS, funnelMetricsForDay } from "../web/src/utils/appleAdsChartMetrics";

describe("apple ads chart: funnel metrics", () => {
  it("derives ratios and unit costs from a normal day", () => {
    assert.deepEqual(funnelMetricsForDay({ spend: 100, impressions: 1000, taps: 50, installs: 10 }), {
      impressions: 1000,
      taps: 50,
      installs: 10,
      ttr: 5,
      cpt: 2,
      cpa: 10,
      convRate: 20,
    });
  });

  it("falls back to zero instead of dividing by zero", () => {
    assert.deepEqual(funnelMetricsForDay({ spend: 100, impressions: 0, taps: 0, installs: 0 }), {
      impressions: 0,
      taps: 0,
      installs: 0,
      ttr: 0,
      cpt: 0,
      cpa: 0,
      convRate: 0,
    });
  });

  it("exposes one definition per chart button", () => {
    assert.deepEqual(
      FUNNEL_METRICS.map((metric) => metric.key),
      ["impressions", "taps", "installs", "ttr", "cpt", "cpa", "convRate"],
    );

    for (const metric of FUNNEL_METRICS) {
      assert.ok(metric.label.length > 0);
      assert.ok(metric.hint.length > 0);
      assert.ok(metric.color.startsWith("#"));
    }
  });
});
