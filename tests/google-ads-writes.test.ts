import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  FakeGoogleAdsGateway,
  getFakeGoogleAdsCampaign,
  resetFakeGoogleAds,
} from "../src/services/google-ads-fake-gateway";
import {
  addGoogleAdsNegativeKeywords,
  createGoogleAdsCampaignFull,
  createGoogleAdsResponsiveSearchAds,
  deleteGoogleAdsCampaign,
  deleteGoogleAdsKeywords,
  deleteGoogleAdsNegativeKeywords,
  replaceGoogleAdsCampaignTargeting,
  updateGoogleAdsCampaign,
  validateGoogleAdsCreateCampaignInput,
  validateRsaInput,
  validateTargetingIds,
} from "../src/services/google-ads-writes";
import { googleAdsErrorMessage, googleAdsGateway, parseMutateResourceNames } from "../src/services/google-ads-gateway";
import {
  getGoogleAdsCampaignBidding,
  getGoogleAdsCampaignBudget,
  listGoogleAdsCampaignTargeting,
  listGoogleAdsKeywords,
  listGoogleAdsNegativeKeywords,
} from "../src/services/google-ads-reports";
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

  it("rejects non-boolean network flags", () => {
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Bad flags",
          dailyBudgetAmount: 5,
          displayNetworkEnabled: "yes",
          adGroups: [
            {
              name: "Group 1",
              defaultBidAmount: 0.5,
              keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            },
          ],
        }),
      /displayNetworkEnabled must be true or false/,
    );
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Bad flags",
          dailyBudgetAmount: 5,
          presenceOnlyTargeting: 1,
          adGroups: [
            {
              name: "Group 1",
              defaultBidAmount: 0.5,
              keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            },
          ],
        }),
      /presenceOnlyTargeting must be true or false/,
    );
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Bad flags",
          dailyBudgetAmount: 5,
          searchPartnersEnabled: "yes",
          adGroups: [
            {
              name: "Group 1",
              defaultBidAmount: 0.5,
              keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            },
          ],
        }),
      /searchPartnersEnabled must be true or false/,
    );
  });

  it("rejects non-numeric targeting ids", () => {
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Bad geo",
          dailyBudgetAmount: 5,
          locationIds: ["germany"],
          adGroups: [
            {
              name: "Group 1",
              defaultBidAmount: 0.5,
              keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            },
          ],
        }),
      /locationIds \[1\] must be a numeric id/,
    );
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

  it("lists and replaces campaign targeting", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Targeting",
        dailyBudgetAmount: 5,
        locationIds: ["2276"],
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );
    const before = await listGoogleAdsCampaignTargeting(creds, created.id);
    assert.deepEqual(
      before.locations.map((l) => l.geoTargetConstant),
      ["geoTargetConstants/2276"],
    );
    assert.deepEqual(before.languages, []);
    const after = await replaceGoogleAdsCampaignTargeting(creds, created.id, {
      locationIds: ["2040", "2756"],
      languageIds: ["1002"],
    });
    assert.deepEqual(after, { locations: ["2040", "2756"], languages: ["1002"] });
    const relisted = await listGoogleAdsCampaignTargeting(creds, created.id);
    assert.equal(relisted.locations.length, 2);
    assert.equal(relisted.languages.length, 1);
  });

  it("replace leaves omitted dimensions untouched", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Targeting keep",
        dailyBudgetAmount: 5,
        locationIds: ["2276"],
        languageIds: ["1002"],
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
          },
        ],
      }),
    );
    const after = await replaceGoogleAdsCampaignTargeting(creds, created.id, { languageIds: ["1001"] });
    assert.deepEqual(after, { locations: ["2276"], languages: ["1001"] });
  });

  it("validates targeting ids", () => {
    assert.deepEqual(validateTargetingIds(["2276", 2040], "locationIds"), ["2276", "2040"]);
    assert.throws(() => validateTargetingIds(null, "locationIds"), /locationIds is required/);
    assert.throws(() => validateTargetingIds(["xx"], "locationIds"), /locationIds \[1\] must be a numeric id/);
  });

  it("creates responsive search ads in the create flow", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Ads",
        dailyBudgetAmount: 5,
        adGroups: [
          {
            name: "Group 1",
            defaultBidAmount: 0.5,
            keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            ads: [
              {
                headlines: ["Habit Tracker", "Track Habits Daily", "Build Streaks"],
                descriptions: ["Track your habits every day.", "Simple streaks and reminders."],
                finalUrl: "https://apps.apple.com/app/id123?ct=test",
              },
            ],
          },
        ],
      }),
    );
    assert.equal(created.adGroups[0].ads.length, 1);
    assert.ok(created.adGroups[0].ads[0].id);
    assert.match(created.adGroups[0].ads[0].resourceName, /adGroupAds\//);
  });

  it("creates responsive search ads directly", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Ads direct",
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
    const ads = await createGoogleAdsResponsiveSearchAds(creds, created.adGroups[0].id, [
      {
        headlines: ["Habit Tracker", "Track Habits Daily", "Build Streaks"],
        descriptions: ["Track your habits every day.", "Simple streaks and reminders."],
        finalUrl: "https://apps.apple.com/app/id123?ct=test",
        path1: "habits",
        status: "PAUSED",
      },
    ]);
    assert.equal(ads.length, 1);
    assert.ok(ads[0].id);
  });

  it("creates maximize-clicks campaigns without bids", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Max clicks",
        dailyBudgetAmount: 5,
        biddingStrategy: "MAXIMIZE_CLICKS",
        cpcBidCeiling: 2,
        adGroups: [
          { name: "Group 1", keywords: [{ text: "habit tracker", matchType: "EXACT" }] },
        ],
      }),
    );
    assert.equal(created.biddingStrategy, "MAXIMIZE_CLICKS");
    assert.ok(created.id);
  });

  it("requires bids for manual cpc", () => {
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Manual",
          dailyBudgetAmount: 5,
          adGroups: [{ name: "Group 1", keywords: [{ text: "habit tracker", matchType: "EXACT" }] }],
        }),
      /defaultBidAmount is required for MANUAL_CPC/,
    );
  });

  it("rejects ceiling on manual cpc", () => {
    assert.throws(
      () =>
        validateGoogleAdsCreateCampaignInput({
          name: "Manual",
          dailyBudgetAmount: 5,
          cpcBidCeiling: 2,
          adGroups: [
            {
              name: "Group 1",
              defaultBidAmount: 0.5,
              keywords: [{ text: "habit tracker", matchType: "EXACT", bidAmount: 0.5 }],
            },
          ],
        }),
      /cpcBidCeiling does not apply to MANUAL_CPC/,
    );
  });

  it("deletes campaigns and reports budget cleanup", async () => {
    const created = await createGoogleAdsCampaignFull(
      creds,
      validateGoogleAdsCreateCampaignInput({
        name: "Delete me",
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
    const budget = await getGoogleAdsCampaignBudget(creds, created.id);
    assert.ok(budget?.resourceName.includes("campaignBudgets"));
    assert.equal(budget?.explicitlyShared, false);
    const deleted = await deleteGoogleAdsCampaign(creds, created.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.budgetRemoved, false);
    assert.match(deleted.budgetWarning ?? "", /budget/);
  });

  it("validates responsive search ads", () => {
    const good = {
      headlines: ["a", "b", "c"],
      descriptions: ["d1", "d2"],
      finalUrl: "https://example.com/x",
    };
    assert.equal(validateRsaInput(good, "Ad").status, "PAUSED");
    assert.throws(() => validateRsaInput({ ...good, headlines: ["a", "b"] }, "Ad"), /needs 3-15 headlines/);
    assert.throws(() => validateRsaInput({ ...good, descriptions: ["d1"] }, "Ad"), /needs 2-4 descriptions/);
    assert.throws(() => validateRsaInput({ ...good, finalUrl: "notaurl" }, "Ad"), /must be an http\(s\) URL/);
    assert.throws(
      () => validateRsaInput({ ...good, headlines: ["x".repeat(31), "b", "c"] }, "Ad"),
      /headline 1 must be 1-30 characters/,
    );
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
