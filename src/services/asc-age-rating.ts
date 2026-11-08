export const AGE_RATING_LEVELS = [
  "NONE",
  "INFREQUENT_OR_MILD",
  "FREQUENT_OR_INTENSE",
  "INFREQUENT",
  "FREQUENT",
] as const;

export type AgeRatingLevel = (typeof AGE_RATING_LEVELS)[number];

export const AGE_RATING_OVERRIDE_V2_VALUES = [
  "NONE",
  "NINE_PLUS",
  "THIRTEEN_PLUS",
  "SIXTEEN_PLUS",
  "EIGHTEEN_PLUS",
  "UNRATED",
] as const;

export const KOREA_AGE_RATING_VALUES = ["NONE", "ALL", "TWELVE_PLUS", "FIFTEEN_PLUS", "NINETEEN_PLUS"] as const;

export const KIDS_AGE_BAND_VALUES = ["FIVE_AND_UNDER", "SIX_TO_EIGHT", "NINE_TO_ELEVEN"] as const;

export type AgeRatingFieldKind =
  | "boolean"
  | "level"
  | "kidsAgeBand"
  | "overrideV2"
  | "koreaOverride"
  | "text"
  | "url";

export interface AgeRatingField {
  key: string;
  kind: AgeRatingFieldKind;
  label: string;
}

export const AGE_RATING_FIELDS: AgeRatingField[] = [
  { key: "violenceCartoonOrFantasy", kind: "level", label: "Cartoon or fantasy violence" },
  { key: "violenceRealistic", kind: "level", label: "Realistic violence" },
  {
    key: "violenceRealisticProlongedGraphicOrSadistic",
    kind: "level",
    label: "Prolonged graphic or sadistic realistic violence",
  },
  { key: "sexualContentOrNudity", kind: "level", label: "Sexual content or nudity" },
  { key: "sexualContentGraphicAndNudity", kind: "level", label: "Graphic sexual content and nudity" },
  { key: "profanityOrCrudeHumor", kind: "level", label: "Profanity or crude humor" },
  { key: "matureOrSuggestiveThemes", kind: "level", label: "Mature or suggestive themes" },
  { key: "horrorOrFearThemes", kind: "level", label: "Horror or fear themes" },
  { key: "alcoholTobaccoOrDrugUseOrReferences", kind: "level", label: "Alcohol, tobacco or drug use or references" },
  { key: "gamblingSimulated", kind: "level", label: "Simulated gambling" },
  { key: "gunsOrOtherWeapons", kind: "level", label: "Guns or other weapons" },
  { key: "medicalOrTreatmentInformation", kind: "level", label: "Medical or treatment information" },
  { key: "contests", kind: "level", label: "Contests" },
  { key: "gambling", kind: "boolean", label: "Gambling" },
  { key: "lootBox", kind: "boolean", label: "Loot boxes" },
  { key: "userGeneratedContent", kind: "boolean", label: "User-generated content" },
  { key: "messagingAndChat", kind: "boolean", label: "Messaging and chat" },
  { key: "socialMedia", kind: "boolean", label: "Social media" },
  { key: "socialMediaAgeRestricted", kind: "boolean", label: "Age-restricted social media" },
  { key: "unrestrictedWebAccess", kind: "boolean", label: "Unrestricted web access" },
  { key: "advertising", kind: "boolean", label: "Advertising" },
  { key: "parentalControls", kind: "boolean", label: "Parental controls" },
  { key: "healthOrWellnessTopics", kind: "boolean", label: "Health or wellness topics" },
  { key: "ageAssurance", kind: "boolean", label: "Age assurance" },
  { key: "kidsAgeBand", kind: "kidsAgeBand", label: "Kids age band" },
  { key: "ageRatingOverrideV2", kind: "overrideV2", label: "Age rating override" },
  { key: "koreaAgeRatingOverride", kind: "koreaOverride", label: "Korea age rating override" },
  { key: "gracRatingClassificationNumber", kind: "text", label: "GRAC classification number" },
  { key: "developerAgeRatingInfoUrl", kind: "url", label: "Age rating info URL" },
];

const FIELD_BY_KEY = new Map(AGE_RATING_FIELDS.map((field) => [field.key, field]));

export interface AgeRatingDeclaration {
  id: string;
  attributes: Record<string, boolean | string | null>;
}

function isLevel(value: string): value is AgeRatingLevel {
  return (AGE_RATING_LEVELS as readonly string[]).includes(value);
}

export function toAgeRatingDeclaration(raw: any): AgeRatingDeclaration {
  const attributes = raw?.attributes;

  if (!attributes) {
    throw new Error("ASC ageRatingDeclarations response missing required attributes");
  }

  if (typeof raw?.id !== "string") {
    throw new Error("ASC ageRatingDeclarations response missing required id");
  }

  return { id: raw.id, attributes: { ...attributes } };
}

export function buildAgeRatingDeclarationUpdateBody(
  id: string,
  attributes: Record<string, boolean | string | null | undefined>,
) {
  const body: Record<string, boolean | string | null> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const field = FIELD_BY_KEY.get(key);

    if (!field) {
      throw new Error(`Unknown age rating field "${key}"`);
    }

    if (value === undefined) continue;

    if (value === null) {
      body[key] = null;
      continue;
    }

    switch (field.kind) {
      case "boolean":
        if (typeof value !== "boolean") {
          throw new Error(`Age rating field "${key}" must be a boolean, got "${value}"`);
        }
        body[key] = value;
        break;
      case "level":
        if (typeof value !== "string" || !isLevel(value)) {
          throw new Error(
            `Age rating field "${key}" must be one of ${AGE_RATING_LEVELS.join(", ")}, got "${value}"`,
          );
        }
        body[key] = value;
        break;
      case "kidsAgeBand":
        if (!(KIDS_AGE_BAND_VALUES as readonly string[]).includes(value as string)) {
          throw new Error(
            `Age rating field "${key}" must be one of ${KIDS_AGE_BAND_VALUES.join(", ")}, got "${value}"`,
          );
        }
        body[key] = value;
        break;
      case "overrideV2":
        if (!(AGE_RATING_OVERRIDE_V2_VALUES as readonly string[]).includes(value as string)) {
          throw new Error(
            `Age rating field "${key}" must be one of ${AGE_RATING_OVERRIDE_V2_VALUES.join(", ")}, got "${value}"`,
          );
        }
        body[key] = value;
        break;
      case "koreaOverride":
        if (!(KOREA_AGE_RATING_VALUES as readonly string[]).includes(value as string)) {
          throw new Error(
            `Age rating field "${key}" must be one of ${KOREA_AGE_RATING_VALUES.join(", ")}, got "${value}"`,
          );
        }
        body[key] = value;
        break;
      case "text":
      case "url":
        if (typeof value !== "string" || !value.trim()) {
          throw new Error(`Age rating field "${key}" must be a non-empty string`);
        }
        body[key] = value.trim();
        break;
    }
  }

  return {
    data: {
      type: "ageRatingDeclarations",
      id,
      attributes: body,
    },
  };
}
