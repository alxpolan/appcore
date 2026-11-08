import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRetentionOfferBody,
  buildRetentionOfferUpdateBody,
  toRetentionOffer,
} from "../src/services/asc-retention-offers";

describe("retention offer payload", () => {
  it("builds a create body with all required fields", () => {
    const body = buildRetentionOfferBody({
      subscriptionId: "sub1",
      referenceName: "Cancel save 20 percent",
      offerId: "retention_save_20",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      periodCount: 3,
      customerEligibilityPaidSubscriptionDurationInMonths: 2,
      priceIds: ["price1", "price2"],
    }) as any;

    assert.equal(body.data.type, "retentionOffers");
    assert.equal(body.data.attributes.referenceName, "Cancel save 20 percent");
    assert.equal(body.data.attributes.offerId, "retention_save_20");
    assert.equal(body.data.attributes.duration, "ONE_MONTH");
    assert.equal(body.data.attributes.offerMode, "PAY_AS_YOU_GO");
    assert.equal(body.data.attributes.periodCount, 3);
    assert.equal(body.data.attributes.customerEligibilityPaidSubscriptionDurationInMonths, 2);
    assert.equal(body.data.relationships.subscription.data.id, "sub1");
    assert.deepEqual(body.data.relationships.prices.data, [
      { type: "retentionOfferPrices", id: "price1" },
      { type: "retentionOfferPrices", id: "price2" },
    ]);
    assert.equal(body.included, undefined);
  });

  it("passes optional eligibility wait and plan type through", () => {
    const body = buildRetentionOfferBody({
      subscriptionId: "sub1",
      referenceName: "Save offer",
      offerId: "save_offer",
      duration: "ONE_YEAR",
      offerMode: "FREE_TRIAL",
      periodCount: 1,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      customerEligibilityWaitBetweenOffersInMonths: 6,
      targetSubscriptionPlanType: "MONTHLY",
      priceIds: ["price1"],
    }) as any;

    assert.equal(body.data.attributes.customerEligibilityWaitBetweenOffersInMonths, 6);
    assert.equal(body.data.attributes.targetSubscriptionPlanType, "MONTHLY");
  });

  it("rejects unknown modes, durations and plan types", () => {
    const base = {
      subscriptionId: "s",
      referenceName: "Save offer",
      offerId: "save_offer",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      periodCount: 1,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      priceIds: ["price1"],
    } as const;

    assert.throws(() => buildRetentionOfferBody({ ...base, offerMode: "NOPE" }), /offerMode/);
    assert.throws(() => buildRetentionOfferBody({ ...base, duration: "ONE_DAY" }), /duration/);
    assert.throws(() => buildRetentionOfferBody({ ...base, duration: "FORTNIGHT" }), /duration/);
    assert.throws(
      () => buildRetentionOfferBody({ ...base, targetSubscriptionPlanType: "WEEKLY" }),
      /targetSubscriptionPlanType/,
    );
  });

  it("rejects missing required fields and bad counts", () => {
    const base = {
      subscriptionId: "s",
      referenceName: "Save offer",
      offerId: "save_offer",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      periodCount: 1,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      priceIds: ["price1"],
    } as const;

    assert.throws(() => buildRetentionOfferBody({ ...base, referenceName: "  " }), /referenceName/);
    assert.throws(() => buildRetentionOfferBody({ ...base, offerId: "" }), /offerId/);
    assert.throws(() => buildRetentionOfferBody({ ...base, priceIds: [] }), /priceIds/);
    assert.throws(() => buildRetentionOfferBody({ ...base, periodCount: 0 }), /periodCount/);
    assert.throws(() => buildRetentionOfferBody({ ...base, periodCount: 1.5 }), /periodCount/);
    assert.throws(
      () => buildRetentionOfferBody({ ...base, customerEligibilityPaidSubscriptionDurationInMonths: 0 }),
      /customerEligibilityPaidSubscriptionDurationInMonths/,
    );
  });
});

describe("retention offer update payload", () => {
  it("updates eligibility fields and clears them with null", () => {
    const body = buildRetentionOfferUpdateBody({
      id: "o1",
      customerEligibilityPaidSubscriptionDurationInMonths: 3,
      customerEligibilityWaitBetweenOffersInMonths: null,
    }) as any;

    assert.equal(body.data.type, "retentionOffers");
    assert.equal(body.data.id, "o1");
    assert.equal(body.data.attributes.customerEligibilityPaidSubscriptionDurationInMonths, 3);
    assert.equal(body.data.attributes.customerEligibilityWaitBetweenOffersInMonths, null);
  });

  it("rejects non-integer eligibility values", () => {
    assert.throws(
      () => buildRetentionOfferUpdateBody({ id: "o1", customerEligibilityPaidSubscriptionDurationInMonths: 1.5 }),
      /customerEligibilityPaidSubscriptionDurationInMonths/,
    );
  });
});

describe("retention offer mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const offer = toRetentionOffer({
      id: "o1",
      attributes: {
        referenceName: "Cancel save",
        offerId: "cancel_save",
        duration: "ONE_MONTH",
        offerMode: "PAY_UP_FRONT",
        periodCount: 2,
        customerEligibilityPaidSubscriptionDurationInMonths: 1,
        customerEligibilityWaitBetweenOffersInMonths: null,
        targetSubscriptionPlanType: "UPFRONT",
      },
      relationships: {
        prices: { data: [{ type: "retentionOfferPrices", id: "price1" }] },
      },
    });

    assert.deepEqual(offer, {
      id: "o1",
      referenceName: "Cancel save",
      offerId: "cancel_save",
      duration: "ONE_MONTH",
      offerMode: "PAY_UP_FRONT",
      periodCount: 2,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      customerEligibilityWaitBetweenOffersInMonths: null,
      targetSubscriptionPlanType: "UPFRONT",
      priceIds: ["price1"],
    });
  });

  it("maps offers without optional fields or prices", () => {
    const offer = toRetentionOffer({
      id: "o2",
      attributes: {
        referenceName: "Save",
        offerId: "save",
        duration: "ONE_WEEK",
        offerMode: "FREE_TRIAL",
        periodCount: 1,
        customerEligibilityPaidSubscriptionDurationInMonths: 1,
      },
      relationships: {},
    });

    assert.equal(offer.customerEligibilityWaitBetweenOffersInMonths, null);
    assert.equal(offer.targetSubscriptionPlanType, null);
    assert.deepEqual(offer.priceIds, []);
  });

  it("rejects responses missing required attributes", () => {
    assert.throws(() => toRetentionOffer({ id: "o1" }), /attributes/);
    assert.throws(
      () => toRetentionOffer({ id: "o1", attributes: { referenceName: "Save" }, relationships: {} }),
      /offerId/,
    );
  });
});
