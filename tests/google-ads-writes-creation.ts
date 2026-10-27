import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getFakeGoogleAdsCampaign,
  resetFakeGoogleAds,
} from "../src/services/google-ads-fake-gateway";
import {
  createGoogleAdsCampaignFull,
  updateGoogleAdsCampaign,
  validateGoogleAdsCreateCampaignInput,
} from "../src/services/google-ads-writes";
import { getGoogleAdsCampaignBidding } from "../src/services/google-ads-reports";
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

  it("creates geo and language targeting", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Geo campaign",
      dailyBudgetAmount: 5,
      locationIds: [2276, "2040"],
      languageIds: ["1002"],
      adGroups: [
        {
          name: "Group 1",
          defaultBidAmount: 0.5,
          keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
        },
      ],
    });

    const created = await createGoogleAdsCampaignFull(creds, input);

    assert.deepEqual(created.locations, ["2276", "2040"]);
    assert.deepEqual(created.languages, ["1002"]);
    assert.equal(created.targetingResourceNames.length, 3);
  });

  it("creates a campaign with Display Network and broad geo reach", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Display campaign",
      dailyBudgetAmount: 5,
      displayNetworkEnabled: true,
      searchPartnersEnabled: false,
      presenceOnlyTargeting: false,
      adGroups: [
        {
          name: "Group 1",
          defaultBidAmount: 0.5,
          keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
        },
      ],
    });

    assert.equal(input.displayNetworkEnabled, true);
    assert.equal(input.searchPartnersEnabled, false);
    assert.equal(input.presenceOnlyTargeting, false);
    const created = await createGoogleAdsCampaignFull(creds, input);
    const stored = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(stored?.displayNetwork, true);
    assert.equal(stored?.searchPartners, false);
    assert.equal(stored?.presenceOnly, false);
  });

  it("defaults to Search-only and presence-only targeting", async () => {
    const input = validateGoogleAdsCreateCampaignInput({
      name: "Search campaign",
      dailyBudgetAmount: 5,
      adGroups: [
        {
          name: "Group 1",
          defaultBidAmount: 0.5,
          keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
        },
      ],
    });

    assert.equal(input.displayNetworkEnabled, undefined);
    assert.equal(input.searchPartnersEnabled, undefined);
    assert.equal(input.presenceOnlyTargeting, undefined);
    const created = await createGoogleAdsCampaignFull(creds, input);
    const stored = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(stored?.displayNetwork, false);
    assert.equal(stored?.searchPartners, true);
    assert.equal(stored?.presenceOnly, true);
  });

  it("updates network and geo reach of a campaign", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Reach update",
        dailyBudgetAmount: 5,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );

    const before = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(before?.displayNetwork, false);
    assert.equal(before?.searchPartners, true);
    await updateGoogleAdsCampaign(creds, created.id, {
      displayNetworkEnabled: true,
      searchPartnersEnabled: false,
      presenceOnlyTargeting: false,
    });
    const after = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(after?.displayNetwork, true);
    assert.equal(after?.searchPartners, false);
    assert.equal(after?.presenceOnly, false);
  });

  it("switches the bidding strategy with a CPC ceiling", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Bidding switch",
        dailyBudgetAmount: 5,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );

    const before = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(before?.biddingStrategy, "MANUAL_CPC");
    await updateGoogleAdsCampaign(creds, created.id, {
      biddingStrategy: "MAXIMIZE_CLICKS",
      cpcBidCeiling: 2,
    });
    const after = getFakeGoogleAdsCampaign(creds.customerId, created.id);

    assert.equal(after?.biddingStrategy, "MAXIMIZE_CLICKS");
    const reread = await getGoogleAdsCampaignBidding(creds, created.id);

    assert.equal(reread.strategy, "MAXIMIZE_CLICKS");
    assert.equal(reread.cpcBidCeiling, 2);
  });

  it("rejects incomplete bidding updates", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Bidding invalid",
        dailyBudgetAmount: 5,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );

    await assert.rejects(
      updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "TARGET_CPA" }),
      /targetCpa is required for TARGET_CPA/,
    );
    await assert.rejects(
      updateGoogleAdsCampaign(creds, created.id, { targetCpa: 10 }),
      /Pass biddingStrategy together with/,
    );
    await assert.rejects(
      updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "MANUAL_CPC", cpcBidCeiling: 2 }),
      /cpcBidCeiling does not apply to MANUAL_CPC/,
    );
    await assert.rejects(
      updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "TARGET_ROAS" }),
      /targetRoas is required for TARGET_ROAS/,
    );
    await assert.rejects(
      updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "MAXIMIZE_CLICKS", targetRoas: 300 }),
      /targetRoas only applies to TARGET_ROAS/,
    );
  });

  it("switches through every automated strategy", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "All strategies",
        dailyBudgetAmount: 5,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );

    const strategyOf = () => getFakeGoogleAdsCampaign(creds.customerId, created.id)?.biddingStrategy;

    assert.equal(strategyOf(), "MANUAL_CPC");
    await updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "MAXIMIZE_CONVERSIONS" });

    assert.equal(strategyOf(), "MAXIMIZE_CONVERSIONS");
    await updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "TARGET_CPA", targetCpa: 15 });

    assert.equal(strategyOf(), "TARGET_CPA");
    await updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "TARGET_ROAS", targetRoas: 300 });

    assert.equal(strategyOf(), "TARGET_ROAS");
    await updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "MANUAL_CPC" });

    assert.equal(strategyOf(), "MANUAL_CPC");
  });

  it("reads back bidding settings", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Bidding readback",
        dailyBudgetAmount: 5,
        biddingStrategy: "MAXIMIZE_CLICKS",
        cpcBidCeiling: 2,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );

    const bidding = await getGoogleAdsCampaignBidding(creds, created.id);

    assert.equal(bidding.strategy, "MAXIMIZE_CLICKS");
    assert.equal(bidding.cpcBidCeiling, 2);
    assert.equal(bidding.targetCpa, null);
    assert.equal(bidding.targetRoasPercent, null);
    await updateGoogleAdsCampaign(creds, created.id, { biddingStrategy: "TARGET_ROAS", targetRoas: 300 });
    const switched = await getGoogleAdsCampaignBidding(creds, created.id);

    assert.equal(switched.strategy, "TARGET_ROAS");
    assert.equal(switched.targetRoasPercent, 300);
    assert.equal(switched.cpcBidCeiling, null);
  });
});
