import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  FakeGoogleAdsGateway,
  resetFakeGoogleAds,
} from "../src/services/google-ads-fake-gateway";
import {
  createGoogleAdsCampaignFull,
  validateGoogleAdsCreateCampaignInput,
} from "../src/services/google-ads-writes";
import { googleAdsErrorMessage } from "../src/services/google-ads-gateway";
import type { GoogleAdsCredentials } from "../src/services/google-ads-types";

const creds: GoogleAdsCredentials = { customerId: "999", clientId: "", clientSecret: "", refreshToken: "" };

describe("google ads: campaign creation", () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_FAKE = "1";
    resetFakeGoogleAds(creds.customerId);
  });

  it("creates a minimal campaign (declares no EU political advertising)", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Test campaign",
      dailyBudgetAmount: 5,
      adGroups: [
        {
          name: "Group 1",
          defaultBidAmount: 0.5,
          keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
        },
      ],
    });
    const created = await createGoogleAdsCampaignFull(creds, input);
    assert.ok(created.id);
    assert.equal(created.adGroups.length, 1);
    assert.equal(created.adGroups[0].keywords.length, 1);
  });

  it("fake gateway rejects campaign creates without the EU declaration", async () => {
    const gw = new FakeGoogleAdsGateway(creds);
    await assert.rejects(
      gw.mutate([{ entity: "campaign", operation: "create", resource: { resource_name: "x", name: "y" } }]),
      /EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED/,
    );
  });
});

describe("google ads: error messages", () => {
  it("serializes API error objects instead of [object Object]", () => {
    const msg = googleAdsErrorMessage({ errors: [{ message: "boom", code: 17 }] }, "campaign creation");
    assert.match(msg, /boom/);
    assert.doesNotMatch(msg, /\[object Object\]/);
  });

  it("passes Error messages through", () => {
    assert.equal(googleAdsErrorMessage(new Error("nope"), "campaign creation"), "Google Ads campaign creation failed: nope");
  });
});
