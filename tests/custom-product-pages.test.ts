import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateLocalizationBody,
  buildCreatePageBody,
  buildCreateScreenshotSetBody,
  buildCreateVersionBody,
  buildReviewSubmissionBody,
  buildReviewSubmissionItemBody,
  buildScreenshotAssetUrl,
  buildSubmitReviewSubmissionBody,
  buildUpdateLocalizationBody,
  buildUpdatePageBody,
  buildUpdateVersionBody,
  cppPageInitialLocale,
  detectDisplayTypeFromDimensions,
  findCppLocalizationsToRemove,
  findEditableCppVersion,
  pendingCppScreenshots,
  isEditableCppVersionState,
} from "../src/services/utils/custom-product-pages";

describe("custom product pages: request bodies", () => {
  it("builds the create-page body with inline version + localization", () => {
    assert.deepEqual(buildCreatePageBody("app1", "Summer", "de-DE"), {
      data: {
        type: "appCustomProductPages",
        attributes: { name: "Summer" },
        relationships: {
          app: { data: { type: "apps", id: "app1" } },
          appCustomProductPageVersions: {
            data: [{ type: "appCustomProductPageVersions", id: "${new-cpp-version}" }],
          },
        },
      },
      included: [
        {
          type: "appCustomProductPageVersions",
          id: "${new-cpp-version}",
          attributes: { deepLink: null },
          relationships: {
            appCustomProductPageLocalizations: {
              data: [{ type: "appCustomProductPageLocalizations", id: "${new-cpp-localization}" }],
            },
          },
        },
        {
          type: "appCustomProductPageLocalizations",
          id: "${new-cpp-localization}",
          attributes: { locale: "de-DE" },
        },
      ],
    });
  });

  it("keeps appCustomProductPageLocalizations on a well-formed inline version", () => {
    const body = buildCreatePageBody("app1", "Summer", "de-DE");
    const version = body.included[0];
    const localization = body.included[1];

    assert.equal(version.type, "appCustomProductPageVersions");
    assert.deepEqual(version.attributes, { deepLink: null });
    assert.deepEqual(version.relationships, {
      appCustomProductPageLocalizations: {
        data: [{ type: "appCustomProductPageLocalizations", id: "${new-cpp-localization}" }],
      },
    });
    assert.equal(localization.type, "appCustomProductPageLocalizations");
    assert.deepEqual(localization.attributes, { locale: "de-DE" });
  });

  it("builds the update-page body with only provided fields", () => {
    assert.deepEqual(buildUpdatePageBody("p1", { name: "X" }), {
      data: { type: "appCustomProductPages", id: "p1", attributes: { name: "X" } },
    });
    assert.deepEqual(buildUpdatePageBody("p1", { visible: false }), {
      data: { type: "appCustomProductPages", id: "p1", attributes: { visible: false } },
    });
  });

  it("builds version bodies", () => {
    assert.deepEqual(buildCreateVersionBody("p1"), {
      data: {
        type: "appCustomProductPageVersions",
        relationships: { appCustomProductPage: { data: { type: "appCustomProductPages", id: "p1" } } },
      },
    });
    assert.deepEqual(buildUpdateVersionBody("v1", "myapp://x"), {
      data: { type: "appCustomProductPageVersions", id: "v1", attributes: { deepLink: "myapp://x" } },
    });
  });

  it("builds localization bodies", () => {
    assert.deepEqual(buildCreateLocalizationBody("v1", "de-DE"), {
      data: {
        type: "appCustomProductPageLocalizations",
        attributes: { locale: "de-DE" },
        relationships: {
          appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: "v1" } },
        },
      },
    });
    assert.deepEqual(buildUpdateLocalizationBody("l1", "Promo"), {
      data: {
        type: "appCustomProductPageLocalizations",
        id: "l1",
        attributes: { promotionalText: "Promo" },
      },
    });
  });

  it("links screenshot sets to the CPP localization, not the version localization", () => {
    const body = buildCreateScreenshotSetBody("l1", "APP_IPHONE_67");

    assert.deepEqual(body.data.relationships, {
      appCustomProductPageLocalization: { data: { type: "appCustomProductPageLocalizations", id: "l1" } },
    });
    assert.equal(body.data.attributes.screenshotDisplayType, "APP_IPHONE_67");
  });

  it("builds the 3-step review submission flow", () => {
    assert.deepEqual(buildReviewSubmissionBody("app1"), {
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: "app1" } } },
      },
    });
    assert.deepEqual(buildReviewSubmissionItemBody("sub1", "v1"), {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: "sub1" } },
          appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: "v1" } },
        },
      },
    });
    assert.deepEqual(buildSubmitReviewSubmissionBody("sub1"), {
      data: { type: "reviewSubmissions", id: "sub1", attributes: { submitted: true } },
    });
  });
});

describe("custom product pages: apply flow decisions", () => {
  it("creates the page with the primary locale, not the ad locale", () => {
    assert.equal(cppPageInitialLocale("en-US", "de-DE"), "en-US");
    assert.equal(cppPageInitialLocale("de-DE", "en-US"), "de-DE");
    assert.equal(cppPageInitialLocale(null, "de-DE"), "de-DE");
    assert.equal(cppPageInitialLocale(undefined, "de-DE"), "de-DE");
    assert.equal(cppPageInitialLocale("", "de-DE"), "de-DE");
  });

  it("reuses an editable version instead of creating an inflight duplicate", () => {
    const versions = [
      { id: "v3", attributes: { state: "APPROVED" } },
      { id: "v2", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
      { id: "v1", attributes: { state: "REJECTED" } },
    ];

    assert.equal(findEditableCppVersion(versions)?.id, "v2");
    assert.equal(findEditableCppVersion([{ id: "v1", attributes: { state: "APPROVED" } }]), null);
    assert.equal(findEditableCppVersion([]), null);
  });
});

describe("custom product pages: apply cleanup and processing", () => {
  it("removes localizations that are not part of the proposal", () => {
    const localizations = [
      { id: "l1", attributes: { locale: "de-DE" } },
      { id: "l2", attributes: { locale: "en-US" } },
    ];

    assert.deepEqual(
      findCppLocalizationsToRemove(localizations, ["de-DE"]).map((l) => l.id),
      ["l2"],
    );
    assert.deepEqual(findCppLocalizationsToRemove(localizations, ["de-DE", "en-US"]), []);
  });

  it("reports screenshots that are not completely processed", () => {
    const shots = [
      { attributes: { fileName: "a.png", assetDeliveryState: { state: "COMPLETE" } } },
      { attributes: { fileName: "b.png", assetDeliveryState: { state: "UPLOAD_COMPLETE" } } },
      { attributes: { fileName: "c.png", assetDeliveryState: null } },
    ];

    assert.deepEqual(pendingCppScreenshots(shots), ["b.png", "c.png"]);
    assert.deepEqual(pendingCppScreenshots([shots[0]]), []);
  });
});

describe("custom product pages: version states", () => {
  it("treats drafts and rejections as editable", () => {
    assert.equal(isEditableCppVersionState("PREPARE_FOR_SUBMISSION"), true);
    assert.equal(isEditableCppVersionState("REJECTED"), true);
  });

  it("treats review/live states as read-only", () => {
    for (const s of [
      "READY_FOR_REVIEW",
      "WAITING_FOR_REVIEW",
      "IN_REVIEW",
      "ACCEPTED",
      "APPROVED",
      "REPLACED_WITH_NEW_VERSION",
    ]) {
      assert.equal(isEditableCppVersionState(s), false, s);
    }
    assert.equal(isEditableCppVersionState(null), false);
    assert.equal(isEditableCppVersionState(undefined), false);
  });
});

describe("custom product pages: screenshots", () => {
  it("detects display types from dimensions", () => {
    assert.equal(detectDisplayTypeFromDimensions(1320, 2868), "APP_IPHONE_67");
    assert.equal(detectDisplayTypeFromDimensions(2868, 1320), "APP_IPHONE_67");
    assert.equal(detectDisplayTypeFromDimensions(2048, 2732), "APP_IPAD_PRO_3GEN_129");
    assert.equal(detectDisplayTypeFromDimensions(750, 1334), "APP_IPHONE_47");
  });

  it("returns null for unknown or missing dimensions", () => {
    assert.equal(detectDisplayTypeFromDimensions(100, 100), null);
    assert.equal(detectDisplayTypeFromDimensions(undefined, 2868), null);
    assert.equal(detectDisplayTypeFromDimensions(1320, undefined), null);
  });

  it("resolves screenshot asset template URLs", () => {
    assert.equal(
      buildScreenshotAssetUrl("https://ex.com/{w}x{h}{c}.{f}", 1320, 2868),
      "https://ex.com/1320x2868bb.jpg",
    );
  });
});
