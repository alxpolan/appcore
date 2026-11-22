import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectTargetBundles,
  extractBundleIdsFromPbxproj,
  normalizeSerial,
  profileUsable,
  upsertStoredProfile,
} from "../src/services/asc-provisioning";

describe("normalizeSerial", () => {
  it("strips prefixes, separators and leading zeros", () => {
    assert.equal(normalizeSerial("serial=0DE45BF0B1B60CA5DC4AD7E34DD5B984"), "DE45BF0B1B60CA5DC4AD7E34DD5B984");
    assert.equal(normalizeSerial("de:45:bf:0b"), "DE45BF0B");
    assert.equal(normalizeSerial("1046D767357FEC6A9720F790066CB549"), "1046D767357FEC6A9720F790066CB549");
  });
});

describe("profileUsable", () => {
  it("requires more than 30 days of validity", () => {
    const now = new Date("2026-11-22T00:00:00Z");

    assert.equal(profileUsable("2027-07-19T12:51:41.000+00:00", now), true);
    assert.equal(profileUsable("2026-11-23T00:00:00Z", now), false);
    assert.equal(profileUsable("2026-01-01T00:00:00Z", now), false);
    assert.equal(profileUsable(undefined, now), false);
    assert.equal(profileUsable("not-a-date", now), false);
  });
});

describe("collectTargetBundles", () => {
  const bundleIdOf = (raw: string) => (raw.startsWith("BUNDLE:") ? raw.slice("BUNDLE:".length) : null);

  it("covers the main bundle plus every bundle found in stored profiles", () => {
    assert.deepEqual(
      collectTargetBundles("com.a.App", ["BUNDLE:com.a.App.Widget", "BUNDLE:com.a.App", "BUNDLE:com.a.App.Watch"], bundleIdOf),
      ["com.a.App", "com.a.App.Widget", "com.a.App.Watch"],
    );
  });

  it("falls back to the main bundle when nothing is stored", () => {
    assert.deepEqual(collectTargetBundles("com.a.App", [], bundleIdOf), ["com.a.App"]);
  });

  it("ignores unparseable stored profiles", () => {
    assert.deepEqual(collectTargetBundles("com.a.App", ["GARBAGE"], bundleIdOf), ["com.a.App"]);
  });
});

describe("extractBundleIdsFromPbxproj", () => {
  const pbxproj = `
    buildSettings = {
      PRODUCT_BUNDLE_IDENTIFIER = com.fringelo.dartly.Dartly;
    };
    buildSettings = {
      PRODUCT_BUNDLE_IDENTIFIER = com.fringelo.dartly.Dartly.widgets;
    };
    buildSettings = {
      PRODUCT_BUNDLE_IDENTIFIER = "$(PRODUCT_BUNDLE_IDENTIFIER).watchapp";
    };
    buildSettings = {
      PRODUCT_BUNDLE_IDENTIFIER = com.other.Unrelated;
    };
    buildSettings = {
      PRODUCT_BUNDLE_IDENTIFIER = "$(CUSTOM_VAR).weird";
    };
  `;

  it("finds literal, variable-resolved and nested bundle ids", () => {
    assert.deepEqual(extractBundleIdsFromPbxproj(pbxproj, "com.fringelo.dartly.Dartly"), [
      "com.fringelo.dartly.Dartly",
      "com.fringelo.dartly.Dartly.watchapp",
      "com.fringelo.dartly.Dartly.widgets",
    ]);
  });

  it("returns empty for projects without bundle ids", () => {
    assert.deepEqual(extractBundleIdsFromPbxproj("buildSettings = {};", "com.a.App"), []);
  });
});

describe("upsertStoredProfile", () => {
  const bundleIdOf = (raw: string) => (raw.startsWith("BUNDLE:") ? raw.slice("BUNDLE:".length) : null);

  it("replaces the stored profile for the same bundle id", () => {
    const next = upsertStoredProfile(["BUNDLE:com.a.App", "BUNDLE:com.a.Ext"], "com.a.App", "NEW", bundleIdOf);

    assert.deepEqual(next, ["NEW", "BUNDLE:com.a.Ext"]);
  });

  it("appends when no stored profile matches", () => {
    const next = upsertStoredProfile(["BUNDLE:com.a.App"], "com.b.App", "NEW", bundleIdOf);

    assert.deepEqual(next, ["BUNDLE:com.a.App", "NEW"]);
  });

  it("keeps unparseable stored profiles untouched", () => {
    const next = upsertStoredProfile(["GARBAGE", "BUNDLE:com.a.App"], "com.a.App", "NEW", bundleIdOf);

    assert.deepEqual(next, ["GARBAGE", "NEW"]);
  });

  it("replaces only the first match", () => {
    const next = upsertStoredProfile(["BUNDLE:com.a.App", "BUNDLE:com.a.App"], "com.a.App", "NEW", bundleIdOf);

    assert.deepEqual(next, ["NEW", "BUNDLE:com.a.App"]);
  });
});
