import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleAdsErrorMessage, parseMutateResourceNames } from "../src/services/google-ads-gateway";

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
