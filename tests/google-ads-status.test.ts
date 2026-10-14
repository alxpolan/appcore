import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeGoogleAdsStatus } from "../src/services/google-ads-reports";

describe("google ads: status normalization", () => {
  it("maps numeric enums to names", () => {
    assert.equal(normalizeGoogleAdsStatus(2), "ENABLED");
    assert.equal(normalizeGoogleAdsStatus(3), "PAUSED");
    assert.equal(normalizeGoogleAdsStatus(4), "REMOVED");
    assert.equal(normalizeGoogleAdsStatus(0), "UNSPECIFIED");
    assert.equal(normalizeGoogleAdsStatus(1), "UNKNOWN");
  });

  it("maps numeric strings to names", () => {
    assert.equal(normalizeGoogleAdsStatus("2"), "ENABLED");
    assert.equal(normalizeGoogleAdsStatus("3"), "PAUSED");
  });

  it("passes names and edge cases through", () => {
    assert.equal(normalizeGoogleAdsStatus("ENABLED"), "ENABLED");
    assert.equal(normalizeGoogleAdsStatus("PAUSED"), "PAUSED");
    assert.equal(normalizeGoogleAdsStatus(undefined), "");
    assert.equal(normalizeGoogleAdsStatus(null), "");
    assert.equal(normalizeGoogleAdsStatus(99), "99");
  });
});
