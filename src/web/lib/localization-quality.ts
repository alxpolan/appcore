export const VERSION_LOCALIZATION_FIELDS = [
  "name",
  "subtitle",
  "keywords",
  "description",
  "promotionalText",
  "whatsNew",
  "supportUrl",
  "privacyPolicyUrl",
  "marketingUrl",
] as const;

export type LocalizationField = (typeof VERSION_LOCALIZATION_FIELDS)[number];

export const KEYWORD_MAX = 100;
export const KEYWORD_MIN_OPTIMAL = 92;

type LocLike = Record<string, string | null | undefined>;

export function isFirstVersionLocalizationSet(localizations: Array<{ whatsNew?: string | null }>): boolean {
  return localizations.every((l) => !(typeof l.whatsNew === "string" && l.whatsNew.trim().length > 0));
}

export function missingLocalizationFields(loc: LocLike, isFirstVersion: boolean): LocalizationField[] {
  return VERSION_LOCALIZATION_FIELDS.filter((field) => {
    if (isFirstVersion && field === "whatsNew") return false;
    const value = loc[field];

    return !(typeof value === "string" && value.trim().length > 0);
  });
}

export function isLocalizationComplete(loc: LocLike, isFirstVersion: boolean): boolean {
  return missingLocalizationFields(loc, isFirstVersion).length === 0;
}

export interface KeywordAnalysis {
  used: number;
  max: number;
  overLimitBy: number;
  unusedBudget: number;
  underutilized: boolean;
  duplicates: string[];
  overlaps: string[];
  hasWeakness: boolean;
}

export function analyzeKeywords(keywords: string, title: string, subtitle: string): KeywordAnalysis {
  const used = keywords.length;
  const overLimitBy = Math.max(0, used - KEYWORD_MAX);
  const unusedBudget = Math.max(0, KEYWORD_MAX - used);
  const underutilized = used < KEYWORD_MIN_OPTIMAL;

  const norm = (s: string) => s.toLowerCase().trim();
  const rawTokens = keywords
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const indexedWords = new Set(
    `${title} ${subtitle}`
      .toLowerCase()
      .split(/[\s,]+/)
      .map((w) => w.trim())
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const overlaps: string[] = [];
  for (const tok of rawTokens) {
    const key = norm(tok);

    if (seen.has(key)) {
      duplicates.push(tok);
      continue;
    }

    seen.add(key);
    const words = key.split(/\s+/).filter(Boolean);

    if (words.length > 0 && words.every((w) => indexedWords.has(w))) {
      overlaps.push(tok);
    }
  }

  const hasWeakness = overLimitBy > 0 || underutilized || duplicates.length > 0 || overlaps.length > 0;

  return { used, max: KEYWORD_MAX, overLimitBy, unusedBudget, underutilized, duplicates, overlaps, hasWeakness };
}

export function hasKeywordWeakness(keywords: string, title: string, subtitle: string): boolean {
  return analyzeKeywords(keywords, title, subtitle).hasWeakness;
}

export function isLocalizationOptimal(loc: LocLike): boolean {
  const keywords = typeof loc.keywords === "string" ? loc.keywords : "";
  if (keywords.trim().length === 0) return false;

  return !hasKeywordWeakness(keywords, loc.name ?? "", loc.subtitle ?? "");
}

export function keywordWeaknessReasons(analysis: KeywordAnalysis): string[] {
  const reasons: string[] = [];

  if (analysis.overLimitBy > 0) {
    reasons.push(
      `Keyword field is ${analysis.overLimitBy} char(s) over the ${analysis.max} limit — trim before submitting.`,
    );
  }

  if (analysis.underutilized) {
    reasons.push(
      `Only ${analysis.used}/${analysis.max} keyword chars used — ${analysis.unusedBudget} chars of reach left unused.`,
    );
  }

  if (analysis.overlaps.length > 0) {
    reasons.push(`Keywords already indexed via title/subtitle (redundant): ${analysis.overlaps.join(", ")}.`);
  }

  if (analysis.duplicates.length > 0) {
    reasons.push(`Duplicate keywords in the field: ${analysis.duplicates.join(", ")}.`);
  }

  return reasons;
}

export type LocalizationQualityStatus = "optimal" | "non_optimal" | "incomplete";

export interface LocalizationQuality {
  locale: string;
  status: LocalizationQualityStatus;
  isComplete: boolean;
  isOptimal: boolean;
  missingFields: LocalizationField[];
  keywords: KeywordAnalysis;
  reasons: string[];
}

export function evaluateLocalizationQuality(loc: LocLike, isFirstVersion: boolean): LocalizationQuality {
  const missingFields = missingLocalizationFields(loc, isFirstVersion);
  const isComplete = missingFields.length === 0;
  const keywords = analyzeKeywords(
    typeof loc.keywords === "string" ? loc.keywords : "",
    loc.name ?? "",
    loc.subtitle ?? "",
  );

  if (!isComplete) {
    return {
      locale: loc.locale ?? "",
      status: "incomplete",
      isComplete: false,
      isOptimal: false,
      missingFields,
      keywords,
      reasons: [`Not submittable — missing required field(s): ${missingFields.join(", ")}.`],
    };
  }

  const isOptimal = !keywords.hasWeakness;

  return {
    locale: loc.locale ?? "",
    status: isOptimal ? "optimal" : "non_optimal",
    isComplete: true,
    isOptimal,
    missingFields: [],
    keywords,
    reasons: isOptimal ? [] : keywordWeaknessReasons(keywords),
  };
}
