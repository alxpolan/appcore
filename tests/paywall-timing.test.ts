import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bucketKey,
  buildUserOutcomes,
  summarizeBuckets,
  trialCancelled,
  type UserOutcome,
} from "../src/services/paywall-timing";

describe("bucketKey", () => {
  it("buckets seconds since first start", () => {
    assert.equal(bucketKey(null), "none");
    assert.equal(bucketKey(0), "lt1m");
    assert.equal(bucketKey(59), "lt1m");
    assert.equal(bucketKey(60), "m1_5");
    assert.equal(bucketKey(299), "m1_5");
    assert.equal(bucketKey(300), "m5_15");
    assert.equal(bucketKey(3599), "m15_60");
    assert.equal(bucketKey(3600), "gt60m");
    assert.equal(bucketKey(99999), "gt60m");
  });
});

describe("trialCancelled", () => {
  const now = new Date("2026-11-22T00:00:00Z");
  const old = new Date("2026-10-01T00:00:00Z");
  const recent = new Date("2026-11-20T00:00:00Z");

  it("counts matured unconverted trials as cancelled", () => {
    assert.equal(trialCancelled({ trialStarted: true, converted: false, trialStartAt: old }, now), true);
  });

  it("does not count converted trials", () => {
    assert.equal(trialCancelled({ trialStarted: true, converted: true, trialStartAt: old }, now), false);
  });

  it("does not count recent trials as cancelled", () => {
    assert.equal(trialCancelled({ trialStarted: true, converted: false, trialStartAt: recent }, now), false);
  });

  it("ignores users without trials", () => {
    assert.equal(trialCancelled({ trialStarted: false, converted: false, trialStartAt: null }, now), false);
  });
});

describe("buildUserOutcomes anchor", () => {
  it("skips users without an anchor event", () => {
    const firstSeen = new Date("2026-11-20T10:00:00Z");
    const [only] = buildUserOutcomes(
      new Map([
        ["a", firstSeen],
        ["b", null],
      ]),
      new Map(),
      new Map(),
    );

    assert.equal(only.distinctId, "a");
  });
});

describe("summarizeBuckets", () => {
  const now = new Date("2026-11-22T00:00:00Z");
  const old = new Date("2026-10-01T00:00:00Z");
  const outcomes: UserOutcome[] = [
    { distinctId: "a", secondsToPaywall: 30, trialStarted: true, converted: true, trialStartAt: old },
    { distinctId: "b", secondsToPaywall: 120, trialStarted: true, converted: false, trialStartAt: old },
    { distinctId: "c", secondsToPaywall: 45, trialStarted: false, converted: false, trialStartAt: null },
  ];

  it("aggregates per bucket with conversion and cancel rates", () => {
    const rows = summarizeBuckets(outcomes, now);
    const byKey = new Map(rows.map((r) => [r.key, r]));

    assert.equal(byKey.get("lt1m")?.users, 2);
    assert.equal(byKey.get("lt1m")?.subscribed, 1);
    assert.equal(byKey.get("lt1m")?.conversionRate, 0.5);
    assert.equal(byKey.get("lt1m")?.trialsStarted, 1);
    assert.equal(byKey.get("lt1m")?.cancelled, 0);
    assert.equal(byKey.get("m1_5")?.users, 1);
    assert.equal(byKey.get("m1_5")?.cancelled, 1);
    assert.equal(byKey.get("m1_5")?.cancelRate, 1);
    assert.ok(!byKey.has("m5_15"));
  });
});

describe("buildUserOutcomes", () => {
  it("maps first seen, paywall delay and transactions", () => {
    const firstSeen = new Date("2026-11-20T10:00:00Z");
    const paywall = new Date("2026-11-20T10:04:00Z");
    const txDate = new Date("2026-11-20T10:05:00Z");

    const [outcome] = buildUserOutcomes(
      new Map([["a", firstSeen]]),
      new Map([["a", paywall]]),
      new Map([
        ["a", [{ customerId: "a", eventType: "INITIAL_PURCHASE", periodType: "TRIAL", proceedsUsd: 0, isTrialConversion: false, occurredAt: txDate }]],
      ]),
    );

    assert.equal(outcome.secondsToPaywall, 240);
    assert.equal(outcome.trialStarted, true);
    assert.equal(outcome.converted, false);
    assert.deepEqual(outcome.trialStartAt, txDate);
  });

  it("marks direct purchases as converted without trial", () => {
    const firstSeen = new Date("2026-11-20T10:00:00Z");

    const [outcome] = buildUserOutcomes(
      new Map([["a", firstSeen]]),
      new Map(),
      new Map([
        ["a", [{ customerId: "a", eventType: "INITIAL_PURCHASE", periodType: "NORMAL", proceedsUsd: 9, isTrialConversion: false, occurredAt: firstSeen }]],
      ]),
    );

    assert.equal(outcome.converted, true);
    assert.equal(outcome.trialStarted, false);
  });
});
