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
  validateGoogleAdsCreateCampaignInput,
  validateRsaInput,
  validateTargetingIds,
} from "../src/services/google-ads-writes";
import { googleAdsGateway } from "../src/services/google-ads-gateway";
import {
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
