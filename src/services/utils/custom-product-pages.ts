/**
 * Pure helpers for App Store Connect Custom Product Pages.
 *
 * This module is intentionally dependency-free so the JSON:API request shapes
 * and mapping logic can be unit-tested without ASC credentials.
 *
 * Resource hierarchy (verified against Apple docs):
 * appCustomProductPages (attrs: name, url[ro], visible)
 *  └─ appCustomProductPageVersions (attrs: deepLink, state[ro], version[ro])
 *      └─ appCustomProductPageLocalizations (attrs: locale, promotionalText)
 *          └─ appScreenshotSets → appScreenshots (standard screenshot model)
 */

export const CPP_VERSION_EDITABLE_STATES = new Set(["PREPARE_FOR_SUBMISSION", "REJECTED"]);

export function isEditableCppVersionState(state: string | null | undefined): boolean {
  return !!state && CPP_VERSION_EDITABLE_STATES.has(state);
}

// Apple requires an inline version + localization when creating a page (JSON:API
// compound document): a bare create fails with 409 ENTITY_ERROR.RELATIONSHIP.REQUIRED.
export function buildCreatePageBody(appId: string, name: string, locale: string) {
  // Apple requires local ids in the literal '${...}' format for inline creation.
  const versionId = "${new-cpp-version}";
  const localizationId = "${new-cpp-localization}";
  return {
    data: {
      type: "appCustomProductPages",
      attributes: { name },
      relationships: {
        app: { data: { type: "apps", id: appId } },
        appCustomProductPageVersions: {
          data: [{ type: "appCustomProductPageVersions", id: versionId }],
        },
      },
    },
    included: [
      {
        type: "appCustomProductPageVersions",
        id: versionId,
        relationships: {
          appCustomProductPage: {},
          appCustomProductPageLocalizations: {
            data: [{ type: "appCustomProductPageLocalizations", id: localizationId }],
          },
        },
      },
      {
        type: "appCustomProductPageLocalizations",
        id: localizationId,
        attributes: { locale },
      },
    ],
  };
}

export function buildUpdatePageBody(pageId: string, updates: { name?: string; visible?: boolean }) {
  const attributes: { name?: string; visible?: boolean } = {};
  if (updates.name !== undefined) attributes.name = updates.name;
  if (updates.visible !== undefined) attributes.visible = updates.visible;
  return { data: { type: "appCustomProductPages", id: pageId, attributes } };
}

export function buildCreateVersionBody(pageId: string) {
  return {
    data: {
      type: "appCustomProductPageVersions",
      relationships: { appCustomProductPage: { data: { type: "appCustomProductPages", id: pageId } } },
    },
  };
}

export function buildUpdateVersionBody(versionId: string, deepLink: string) {
  return {
    data: {
      type: "appCustomProductPageVersions",
      id: versionId,
      attributes: { deepLink },
    },
  };
}

export function buildCreateLocalizationBody(versionId: string, locale: string) {
  return {
    data: {
      type: "appCustomProductPageLocalizations",
      attributes: { locale },
      relationships: {
        appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: versionId } },
      },
    },
  };
}

export function buildUpdateLocalizationBody(localizationId: string, promotionalText: string) {
  return {
    data: {
      type: "appCustomProductPageLocalizations",
      id: localizationId,
      attributes: { promotionalText },
    },
  };
}

export function buildCreateScreenshotSetBody(localizationId: string, displayType: string) {
  return {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appCustomProductPageLocalization: {
          data: { type: "appCustomProductPageLocalizations", id: localizationId },
        },
      },
    },
  };
}

export function buildReviewSubmissionBody(appId: string, platform = "IOS") {
  return {
    data: {
      type: "reviewSubmissions",
      attributes: { platform },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  };
}

export function buildReviewSubmissionItemBody(submissionId: string, versionId: string) {
  return {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } },
        appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: versionId } },
      },
    },
  };
}

export function buildSubmitReviewSubmissionBody(submissionId: string) {
  return {
    data: {
      type: "reviewSubmissions",
      id: submissionId,
      attributes: { submitted: true },
    },
  };
}

/** Image dimensions (WxH, portrait or landscape) → ASC screenshotDisplayType. */
export const DIMENSION_TO_DISPLAY_TYPE: Record<string, string> = {
  "1320x2868": "APP_IPHONE_67",
  "2868x1320": "APP_IPHONE_67",
  "1290x2796": "APP_IPHONE_67",
  "2796x1290": "APP_IPHONE_67",
  "1206x2622": "APP_IPHONE_61",
  "2622x1206": "APP_IPHONE_61",
  "1284x2778": "APP_IPHONE_65",
  "2778x1284": "APP_IPHONE_65",
  "1242x2688": "APP_IPHONE_65",
  "2688x1242": "APP_IPHONE_65",
  "1179x2556": "APP_IPHONE_61",
  "2556x1179": "APP_IPHONE_61",
  "1170x2532": "APP_IPHONE_61",
  "2532x1170": "APP_IPHONE_61",
  "1125x2436": "APP_IPHONE_58",
  "2436x1125": "APP_IPHONE_58",
  "1242x2208": "APP_IPHONE_55",
  "2208x1242": "APP_IPHONE_55",
  "750x1334": "APP_IPHONE_47",
  "1334x750": "APP_IPHONE_47",
  "2064x2752": "APP_IPAD_PRO_3GEN_129",
  "2752x2064": "APP_IPAD_PRO_3GEN_129",
  "2048x2732": "APP_IPAD_PRO_3GEN_129",
  "2732x2048": "APP_IPAD_PRO_3GEN_129",
  "1668x2388": "APP_IPAD_PRO_3GEN_11",
  "2388x1668": "APP_IPAD_PRO_3GEN_11",
  "1668x2224": "APP_IPAD_105",
  "2224x1668": "APP_IPAD_105",
  "1536x2048": "APP_IPAD_97",
  "2048x1536": "APP_IPAD_97",
};

export function detectDisplayTypeFromDimensions(
  width: number | undefined,
  height: number | undefined,
): string | null {
  if (!width || !height) return null;
  return DIMENSION_TO_DISPLAY_TYPE[`${width}x${height}`] ?? null;
}

/** Resolves an ASC imageAsset templateUrl ({w}/{h}/{c}/{f}) to a concrete URL. */
export function buildScreenshotAssetUrl(templateUrl: string, w: number, h: number): string {
  return templateUrl
    .replace("{w}", String(w))
    .replace("{h}", String(h))
    .replace("{c}", "bb")
    .replace("{f}", "jpg");
}
