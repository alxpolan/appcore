import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWinBackOfferBody,
  buildWinBackOfferUpdateBody,
  toWinBackOffer,
} from "../src/services/asc-win-back-offers";

const BASE = {
  subscriptionId: "sub1",
  referenceName: "Come back 50 percent",
  offerId: "winback_50",
  duration: "ONE_MONTH",
  offerMode: "PAY_AS_YOU_GO",
  periodCount: 2,
  customerEligibilityPaidSubscriptionDurationInMonths: 3,
  customerEligibilityTimeSinceLastSubscribedMinMonths: 1,
  customerEligibilityTimeSinceLastSubscribedMaxMonths: 12,
  startDate: "2026-12-01",
  priority: "HIGH",
  priceIds: ["price1"],
} as const;

describe("win-back offer payload", () => {
  it("builds a create body with all required fields", () => {
    const body = buildWinBackOfferBody({ ...BASE }) as any;

    assert.equal(body.data.type, "winBackOffers");
    assert.equal(body.data.attributes.referenceName, "Come back 50 percent");
    assert.deepEqual(body.data.attributes.customerEligibilityTimeSinceLastSubscribedInMonths, {
      minimum: 1,
      maximum: 12,
    });
    assert.equal(body.data.attributes.startDate, "2026-12-01");
    assert.equal(body.data.attributes.priority, "HIGH");
    assert.deepEqual(body.data.relationships.prices.data, [{ type: "winBackOfferPrices", id: "price1" }]);
    assert.equal(body.data.attributes.endDate, undefined);
    assert.equal(body.data.attributes.promotionIntent, undefined);
  });

  it("passes optional scheduling and promotion fields through", () => {
    const body = buildWinBackOfferBody({
      ...BASE,
      endDate: "2027-06-30",
      promotionIntent: "USE_AUTO_GENERATED_ASSETS",
      customerEligibilityWaitBetweenOffersInMonths: 6,
      targetSubscriptionPlanType: "MONTHLY",
    }) as any;

    assert.equal(body.data.attributes.endDate, "2027-06-30");
    assert.equal(body.data.attributes.promotionIntent, "USE_AUTO_GENERATED_ASSETS");
    assert.equal(body.data.attributes.customerEligibilityWaitBetweenOffersInMonths, 6);
    assert.equal(body.data.attributes.targetSubscriptionPlanType, "MONTHLY");
  });

  it("rejects bad ranges, dates, modes and priorities", () => {
    assert.throws(
      () =>
        buildWinBackOfferBody({
          ...BASE,
          customerEligibilityTimeSinceLastSubscribedMinMonths: 12,
          customerEligibilityTimeSinceLastSubscribedMaxMonths: 1,
        }),
      /must not exceed/,
    );
    assert.throws(() => buildWinBackOfferBody({ ...BASE, startDate: "12/01/2026" }), /startDate/);
    assert.throws(() => buildWinBackOfferBody({ ...BASE, offerMode: "NOPE" }), /offerMode/);
    assert.throws(() => buildWinBackOfferBody({ ...BASE, duration: "ONE_DAY" }), /duration/);
    assert.throws(() => buildWinBackOfferBody({ ...BASE, priority: "LOW" }), /priority/);
    assert.throws(() => buildWinBackOfferBody({ ...BASE, priceIds: [] }), /priceIds/);
    assert.throws(
      () =>
        buildWinBackOfferBody({
          ...BASE,
          customerEligibilityTimeSinceLastSubscribedMinMonths: undefined as any,
          customerEligibilityTimeSinceLastSubscribedMaxMonths: undefined as any,
        }),
      /range/,
    );
  });
});

describe("win-back offer update payload", () => {
  it("updates ranges, dates and priority, clearing with null", () => {
    const body = buildWinBackOfferUpdateBody({
      id: "w1",
      customerEligibilityTimeSinceLastSubscribedMinMonths: 3,
      customerEligibilityTimeSinceLastSubscribedMaxMonths: 6,
      endDate: null,
      priority: "NORMAL",
    }) as any;

    assert.deepEqual(body.data.attributes.customerEligibilityTimeSinceLastSubscribedInMonths, {
      minimum: 3,
      maximum: 6,
    });
    assert.equal(body.data.attributes.endDate, null);
    assert.equal(body.data.attributes.priority, "NORMAL");
  });

  it("clears the whole range with null bounds", () => {
    const body = buildWinBackOfferUpdateBody({
      id: "w1",
      customerEligibilityTimeSinceLastSubscribedMinMonths: null,
      customerEligibilityTimeSinceLastSubscribedMaxMonths: null,
    }) as any;

    assert.equal(body.data.attributes.customerEligibilityTimeSinceLastSubscribedInMonths, null);
  });
});

describe("win-back offer mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const offer = toWinBackOffer({
      id: "w1",
      attributes: {
        referenceName: "Come back",
        offerId: "come_back",
        duration: "ONE_MONTH",
        offerMode: "PAY_UP_FRONT",
        periodCount: 1,
        customerEligibilityPaidSubscriptionDurationInMonths: 2,
        customerEligibilityTimeSinceLastSubscribedInMonths: { minimum: 1, maximum: 24 },
        customerEligibilityWaitBetweenOffersInMonths: null,
        targetSubscriptionPlanType: null,
        startDate: "2026-12-01",
        endDate: null,
        priority: "HIGH",
        promotionIntent: null,
      },
      relationships: { prices: { data: [{ type: "winBackOfferPrices", id: "price1" }] } },
    });

    assert.equal(offer.customerEligibilityTimeSinceLastSubscribedMinMonths, 1);
    assert.equal(offer.customerEligibilityTimeSinceLastSubscribedMaxMonths, 24);
    assert.equal(offer.startDate, "2026-12-01");
    assert.equal(offer.priority, "HIGH");
    assert.deepEqual(offer.priceIds, ["price1"]);
  });

  it("rejects responses with invalid ranges", () => {
    assert.throws(
      () =>
        toWinBackOffer({
          id: "w1",
          attributes: {
            referenceName: "Come back",
            offerId: "come_back",
            duration: "ONE_MONTH",
            offerMode: "FREE_TRIAL",
            periodCount: 1,
            customerEligibilityPaidSubscriptionDurationInMonths: 1,
            customerEligibilityTimeSinceLastSubscribedInMonths: { minimum: 1 },
          },
          relationships: {},
        }),
      /range/,
    );
  });
});
