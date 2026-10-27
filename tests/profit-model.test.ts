import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyBump, economics, parseNum } from "../web/src/utils/profitModel";

describe("profit model: economics", () => {
  const base = {
    taps: 1000,
    cpt: 2,
    convRate: 0.1,
    trialRate: 0.5,
    trialConvRate: 0.4,
    proceedsPerConverted: 25,
    directBase: 0,
  };

  it("computes the full funnel from drivers", () => {
    assert.deepEqual(economics(base), {
      spend: 2000,
      installs: 100,
      trials: 50,
      converted: 20,
      proceeds: 500,
      profit: -1500,
      roas: 0.25,
      cpa: 20,
    });
  });

  it("moves profit when trial conversion rises 10%", () => {
    const lifted = economics({ ...base, trialConvRate: 0.44 });

    assert.equal(lifted.converted, 22);
    assert.equal(lifted.proceeds, 550);
    assert.equal(lifted.profit, -1450);
    assert.equal(lifted.spend, 2000);
  });

  it("moves profit when trial rate rises 10%", () => {
    const lifted = economics({ ...base, trialRate: 0.55 });

    assert.ok(Math.abs(lifted.trials - 55) < 1e-9);
    assert.ok(Math.abs(lifted.converted - 22) < 1e-9);
    assert.ok(Math.abs(lifted.proceeds - 550) < 1e-9);
    assert.ok(Math.abs(lifted.profit + 1450) < 1e-9);
  });

  it("keeps fixed direct proceeds on top of trial proceeds", () => {
    const withDirect = economics({ ...base, directBase: 100 });

    assert.equal(withDirect.proceeds, 600);
    assert.equal(withDirect.profit, -1400);
  });

  it("guards division by zero with nulls and zeros", () => {
    assert.deepEqual(
      economics({ taps: 0, cpt: 2, convRate: 0.1, trialRate: 0.5, trialConvRate: 0.4, proceedsPerConverted: 25, directBase: 0 }),
      {
        spend: 0,
        installs: 0,
        trials: 0,
        converted: 0,
        proceeds: 0,
        profit: 0,
        roas: null,
        cpa: null,
      },
    );
  });
});

describe("profit model: input parsing", () => {
  it("parses decimals with dot and comma", () => {
    assert.equal(parseNum("12.5"), 12.5);
    assert.equal(parseNum("12,5"), 12.5);
    assert.equal(parseNum("100"), 100);
  });

  it("falls back to zero for empty or invalid input", () => {
    assert.equal(parseNum(""), 0);
    assert.equal(parseNum("abc"), 0);
  });

  it("bumps values by a factor with fixed decimals", () => {
    assert.equal(applyBump("100", "100", 1.1, 0), "110");
    assert.equal(applyBump("2.50", "2.50", 0.9, 2), "2.25");
    assert.equal(applyBump("10.00", "10.00", 1.1, 2), "11.00");
  });

  it("bumps from the fallback when input is empty or invalid", () => {
    assert.equal(applyBump("", "10.00", 1.1, 2), "11.00");
    assert.equal(applyBump("abc", "10.00", 1.1, 2), "11.00");
  });
});
