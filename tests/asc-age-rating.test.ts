import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_RATING_FIELDS,
  buildAgeRatingDeclarationUpdateBody,
  toAgeRatingDeclaration,
} from "../src/services/asc-age-rating";

describe("age rating mapping", () => {
  it("maps ASC resources to the API shape", () => {
    const declaration = toAgeRatingDeclaration({
      id: "ar1",
      attributes: { gambling: true, contests: "NONE", kidsAgeBand: null },
    });

    assert.deepEqual(declaration, {
      id: "ar1",
      attributes: { gambling: true, contests: "NONE", kidsAgeBand: null },
    });
  });

  it("rejects responses missing attributes or id", () => {
    assert.throws(() => toAgeRatingDeclaration({ id: "ar1" }), /attributes/);
    assert.throws(() => toAgeRatingDeclaration({ attributes: {} }), /id/);
  });

  it("covers every updatable field exactly once", () => {
    const keys = AGE_RATING_FIELDS.map((field) => field.key);

    assert.equal(new Set(keys).size, keys.length);
    assert.ok(!keys.includes("ageRatingOverride"));
    assert.ok(keys.includes("ageRatingOverrideV2"));
  });
});

describe("age rating update payload", () => {
  it("builds a patch body with mixed field kinds", () => {
    const body = buildAgeRatingDeclarationUpdateBody("ar1", {
      gambling: true,
      contests: "INFREQUENT_OR_MILD",
      kidsAgeBand: "SIX_TO_EIGHT",
      ageRatingOverrideV2: "THIRTEEN_PLUS",
      koreaAgeRatingOverride: "TWELVE_PLUS",
      gracRatingClassificationNumber: "CC-NV-260101-001",
      developerAgeRatingInfoUrl: "https://example.com/ratings",
      lootBox: null,
      messagingAndChat: undefined,
    }) as any;

    assert.equal(body.data.type, "ageRatingDeclarations");
    assert.equal(body.data.id, "ar1");
    assert.deepEqual(body.data.attributes, {
      gambling: true,
      contests: "INFREQUENT_OR_MILD",
      kidsAgeBand: "SIX_TO_EIGHT",
      ageRatingOverrideV2: "THIRTEEN_PLUS",
      koreaAgeRatingOverride: "TWELVE_PLUS",
      gracRatingClassificationNumber: "CC-NV-260101-001",
      developerAgeRatingInfoUrl: "https://example.com/ratings",
      lootBox: null,
    });
  });

  it("rejects unknown fields and wrong value kinds", () => {
    assert.throws(() => buildAgeRatingDeclarationUpdateBody("ar1", { nope: true }), /Unknown/);
    assert.throws(() => buildAgeRatingDeclarationUpdateBody("ar1", { gambling: "yes" as any }), /boolean/);
    assert.throws(() => buildAgeRatingDeclarationUpdateBody("ar1", { contests: "SOMETIMES" }), /contests/);
    assert.throws(() => buildAgeRatingDeclarationUpdateBody("ar1", { kidsAgeBand: "TEEN" }), /kidsAgeBand/);
    assert.throws(
      () => buildAgeRatingDeclarationUpdateBody("ar1", { developerAgeRatingInfoUrl: "  " }),
      /non-empty/,
    );
  });
});
