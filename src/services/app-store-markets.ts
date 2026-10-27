import { COUNTRY_LANG } from "./utils/country_lang";
import { STOREFRONT_IDS } from "./utils/storefronts";

const SUPPORTED_LANGUAGE_CODES = new Set(Object.values(COUNTRY_LANG));

export function langForCountry(country: string): string {
  return COUNTRY_LANG[country.toLowerCase()] ?? "en";
}

export function localeToCountry(locale: string): string | null {
  const lower = locale.toLowerCase();
  const scriptMap: Record<string, string> = {
    "zh-hans": "cn",
    "zh-hant": "tw",
  };

  if (scriptMap[lower]) return scriptMap[lower];

  const parts = lower.split("-");

  if (parts.length >= 2) {
    const region = parts[parts.length - 1];
    if (region.length === 2) return region;
  }

  const langMap: Record<string, string> = {
    ko: "kr",
    ja: "jp",
    zh: "cn",
  };

  return langMap[parts[0] ?? ""] ?? null;
}

export function normalizeLanguage(language: string | null | undefined, country: string): string {
  const fallback = langForCountry(country);
  if (!language) return fallback;

  const normalized = language.trim().toLowerCase();
  if (!normalized) return fallback;

  const primaryCode = normalized.replace(/-/g, "_").split("_")[0] ?? "";
  if (SUPPORTED_LANGUAGE_CODES.has(primaryCode)) return primaryCode;

  const mappedFromCountry = COUNTRY_LANG[primaryCode];
  if (mappedFromCountry) return mappedFromCountry;

  return fallback;
}

export function storefrontHeaderForCountry(country: string): string {
  const storeId = STOREFRONT_IDS[country.toUpperCase()] ?? STOREFRONT_IDS.US;

  return `${storeId},29`;
}
