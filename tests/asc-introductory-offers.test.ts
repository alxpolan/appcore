import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntroductoryOfferBody,
  toIntroductoryOffer,
} from "../src/services/asc-introductory-offers";

describe("introductory offer payload", () => {
  it("defaults to a single-period free trial", () => {
    const body = buildIntroductoryOfferBody({ subscriptionId: "sub1", duration: "ONE_MONTH" }) as any;

    assert.equal(body.data.type, "subscriptionIntroductoryOffers");
    assert.equal(body.data.attributes.offerMode, "FREE_TRIAL");
    assert.equal(body.data.attributes.duration, "ONE_MONTH");
    assert.equal(body.data.attributes.numberOfPeriods, 1);
    assert.equal(body.data.relationships.subscription.data.id, "sub1");
    assert.equal(body.data.relationships.territory, undefined);
    assert.equal(body.data.relationships.subscriptionPricePoint, undefined);
  });

  it("passes territory and date bounds through", () => {
    const body = buildIntroductoryOfferBody({
      subscriptionId: "sub1",
      duration: "ONE_WEEK",
      numberOfPeriods: 2,
      territory: "usa",
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-06-01T00:00:00Z",
    }) as any;

    assert.equal(body.data.relationships.territory.data.id, "USA");
    assert.equal(body.data.attributes.numberOfPeriods, 2);
    assert.equal(body.data.attributes.startDate, "2026-01-01T00:00:00Z");
    assert.equal(body.data.attributes.endDate, "2026-06-01T00:00:00Z");
  });

  it("requires a price point for pay-as-you-go offers", () => {
    assert.throws(
      () =>
        buildIntroductoryOfferBody({ subscriptionId: "sub1", duration: "ONE_MONTH", offerMode: "PAY_AS_YOU_GO" }),
      /pricePointId/,
    );
    const body = buildIntroductoryOfferBody({
      subscriptionId: "sub1",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      pricePointId: "pp1",
    }) as any;

    assert.equal(body.data.relationships.subscriptionPricePoint.data.id, "pp1");
  });

  it("rejects unknown modes, durations and bad period counts", () => {
    assert.throws(
      () => buildIntroductoryOfferBody({ subscriptionId: "s", duration: "ONE_MONTH", offerMode: "NOPE" }),
      /offerMode/,
    );
    assert.throws(() => buildIntroductoryOfferBody({ subscriptionId: "s", duration: "FORTNIGHT" }), /duration/);
    assert.throws(
      () => buildIntroductoryOfferBody({ subscriptionId: "s", duration: "ONE_WEEK", numberOfPeriods: 0 }),
      /numberOfPeriods/,
    );
    assert.throws(
      () => buildIntroductoryOfferBody({ subscriptionId: "s", duration: "ONE_WEEK", numberOfPeriods: 1.5 }),
      /numberOfPeriods/,
    );
  });
});

describe("introductory offer mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const offer = toIntroductoryOffer({
      id: "o1",
      attributes: {
        offerMode: "FREE_TRIAL",
        duration: "ONE_WEEK",
        numberOfPeriods: 2,
        startDate: null,
        endDate: null,
      },
      relationships: { territory: { data: { type: "territories", id: "USA" } } },
    });

    assert.deepEqual(offer, {
      id: "o1",
      offerMode: "FREE_TRIAL",
      duration: "ONE_WEEK",
      numberOfPeriods: 2,
      territory: "USA",
      startDate: null,
      endDate: null,
    });
  });

  it("maps global offers without territory linkage", () => {
    const offer = toIntroductoryOffer({
      id: "o2",
      attributes: { offerMode: "FREE_TRIAL", duration: "ONE_MONTH", numberOfPeriods: 1 },
      relationships: {},
    });

    assert.equal(offer.territory, null);
  });
});
