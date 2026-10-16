import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGoogleAdsMatchType,
  normalizeGoogleAdsSearchTermStatus,
  normalizeGoogleAdsStatus,
} from "../src/services/google-ads-reports";

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

describe("google ads: match type normalization", () => {
  it("maps numeric enums to names", () => {
    assert.equal(normalizeGoogleAdsMatchType(2), "EXACT");
    assert.equal(normalizeGoogleAdsMatchType(3), "PHRASE");
    assert.equal(normalizeGoogleAdsMatchType(4), "BROAD");
    assert.equal(normalizeGoogleAdsMatchType("4"), "BROAD");
  });

  it("passes names and edge cases through", () => {
    assert.equal(normalizeGoogleAdsMatchType("EXACT"), "EXACT");
    assert.equal(normalizeGoogleAdsMatchType(undefined), "");
    assert.equal(normalizeGoogleAdsMatchType(null), "");
    assert.equal(normalizeGoogleAdsMatchType(""), "");
  });
});

describe("google ads: search term status normalization", () => {
  it("maps numeric enums to names", () => {
    assert.equal(normalizeGoogleAdsSearchTermStatus(2), "ADDED");
    assert.equal(normalizeGoogleAdsSearchTermStatus(3), "EXCLUDED");
    assert.equal(normalizeGoogleAdsSearchTermStatus(4), "ADDED_EXCLUDED");
    assert.equal(normalizeGoogleAdsSearchTermStatus(5), "NONE");
    assert.equal(normalizeGoogleAdsSearchTermStatus("3"), "EXCLUDED");
  });

  it("passes names and edge cases through", () => {
    assert.equal(normalizeGoogleAdsSearchTermStatus("ADDED"), "ADDED");
    assert.equal(normalizeGoogleAdsSearchTermStatus(undefined), "");
    assert.equal(normalizeGoogleAdsSearchTermStatus(null), "");
  });
});
