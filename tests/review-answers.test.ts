import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatReviewAnswers, normalizeReviewAnswers } from "../src/services/review-answers";

describe("review answers formatting", () => {
  it("formats answers in the numbered App Review shape", () => {
    const notes = formatReviewAnswers({
      siriShortcuts: "No, it doesn't",
      devicesTested: "iPhone 14 Pro, iOS 26.6.1",
      purposeAudience: "Coinio is a coin identification app for collectors.",
    });

    assert.equal(
      notes,
      "0. Does the app include any Siri Shortcuts functionality?: No, it doesn't\n\n" +
        "2. Devices tested: iPhone 14 Pro, iOS 26.6.1\n\n" +
        "3. Purpose & audience: Coinio is a coin identification app for collectors.",
    );
  });

  it("formats the full Coinio example", () => {
    const notes = formatReviewAnswers({
      siriShortcuts: "No, it doesn't",
      screenRecording: "(Attached)",
      devicesTested: "iPhone 14 Pro, iOS 26.6.1.",
      purposeAudience: "Coin spotting for collectors.",
      setup: "No account needed - open app, scan a coin.",
      externalServices: "Apple In-App Purchase (StoreKit) for subscriptions; RevenueCat; PostHog",
      regionalDifferences: "None - same features and content everywhere",
      regulatedIndustry: "Not applicable.",
    });
    const lines = notes.split("\n\n");

    assert.equal(lines.length, 8);
    assert.ok(lines[0].startsWith("0. "));
    assert.ok(lines[1].startsWith("1. Screen recording: "));
    assert.ok(lines[7].startsWith("7. Regulated industry"));
  });

  it("returns an empty string when nothing is answered", () => {
    assert.equal(formatReviewAnswers({}), "");
    assert.equal(formatReviewAnswers({ siriShortcuts: "   " }), "");
  });
});

describe("review answers normalization", () => {
  it("trims answers and drops blank ones", () => {
    assert.deepEqual(normalizeReviewAnswers({ siriShortcuts: "  No  ", devicesTested: "" }), {
      siriShortcuts: "No",
    });
  });

  it("rejects unknown fields, non-strings and non-objects", () => {
    assert.throws(() => normalizeReviewAnswers({ nope: "x" }), /Unknown/);
    assert.throws(() => normalizeReviewAnswers({ siriShortcuts: 42 }), /must be a string/);
    assert.throws(() => normalizeReviewAnswers(null), /must be an object/);
    assert.throws(() => normalizeReviewAnswers("answers"), /must be an object/);
  });
});
