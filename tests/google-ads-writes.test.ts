import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  FakeGoogleAdsGateway,
  resetFakeGoogleAds,
} from "../src/services/google-ads-fake-gateway";
import {
  addGoogleAdsNegativeKeywords,
  createGoogleAdsCampaignFull,
  deleteGoogleAdsKeywords,
  deleteGoogleAdsNegativeKeywords,
  validateGoogleAdsCreateCampaignInput,
} from "../src/services/google-ads-writes";
import { googleAdsErrorMessage, googleAdsGateway, parseMutateResourceNames } from "../src/services/google-ads-gateway";
import { listGoogleAdsKeywords, listGoogleAdsNegativeKeywords } from "../src/services/google-ads-reports";
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

  it("deletes keywords by id", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Delete me",
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
    const adGroupId = created.adGroups[0].id;
    const before = await listGoogleAdsKeywords(creds, created.id, adGroupId);
    assert.equal(before.length, 1);
    const deleted = await deleteGoogleAdsKeywords(creds, created.id, adGroupId, [before[0].id]);
    assert.equal(deleted, 1);
    assert.deepEqual(await listGoogleAdsKeywords(creds, created.id, adGroupId), []);
  });

  it("adds and deletes campaign-level negatives", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Negatives",
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
    const added = await addGoogleAdsNegativeKeywords(creds, created.id, null, [{ text: "free", matchType: "BROAD" }]);
    assert.equal(added.length, 1);
    assert.ok(added[0].id);
    const listed = await listGoogleAdsNegativeKeywords(creds, created.id, null);
    assert.equal(listed.length, 1);
    const deleted = await deleteGoogleAdsNegativeKeywords(creds, created.id, null, [listed[0].id]);
    assert.equal(deleted, 1);
    assert.deepEqual(await listGoogleAdsNegativeKeywords(creds, created.id, null), []);
  });

  it("empty mutate is a no-op without an API call", async () => {
    delete process.env.GOOGLE_ADS_FAKE;
    try {
      assert.deepEqual(await googleAdsGateway(creds).mutate([]), []);
    } finally {
      process.env.GOOGLE_ADS_FAKE = "1";
    }
  });
});

describe("google ads: mutate responses", () => {
  it("reads camelCase resource names", () => {
    assert.deepEqual(
      parseMutateResourceNames({ mutateOperationResponses: [{ resourceName: "customers/1/campaigns/2" }] }),
      ["customers/1/campaigns/2"],
    );
  });

  it("reads snake_case resource names", () => {
    assert.deepEqual(
      parseMutateResourceNames({ mutate_operation_responses: [{ resource_name: "customers/1/campaigns/2" }] }),
      ["customers/1/campaigns/2"],
    );
  });

  it("reads per-type result wrappers", () => {
    assert.deepEqual(
      parseMutateResourceNames({
        mutate_operation_responses: [
          { campaign_budget_result: { resource_name: "customers/1/campaignBudgets/2" } },
          { campaign_result: { resource_name: "customers/1/campaigns/3" } },
          { ad_group_criterion_result: { resource_name: "customers/1/adGroupCriteria/4~5" } },
        ],
      }),
      ["customers/1/campaignBudgets/2", "customers/1/campaigns/3", "customers/1/adGroupCriteria/4~5"],
    );
  });

  it("returns no ids for empty responses", () => {
    assert.deepEqual(parseMutateResourceNames({}), []);
    assert.deepEqual(parseMutateResourceNames(null), []);
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
