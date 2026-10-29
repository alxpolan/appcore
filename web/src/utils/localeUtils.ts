const LOCALE_FLAG_OVERRIDES: Record<string, string> = {
  ar: "sa",
  ca: "es",
  cs: "cz",
  da: "dk",
  el: "gr",
  en: "us",
  he: "il",
  hi: "in",
  ja: "jp",
  ko: "kr",
  ms: "my",
  no: "no",
  sl: "si",
  sv: "se",
  uk: "ua",
  vi: "vn",
  zh: "cn",
  "zh-Hant": "tw",
  "pt-PT": "pt",
  "pt-BR": "br",
  "es-MX": "mx",
  "es-ES": "es",
  "fr-CA": "ca",
  "fr-FR": "fr",
  "en-AU": "au",
  "en-CA": "ca",
  "en-GB": "gb",
  "en-US": "us",
  "de-DE": "de",
  "nl-NL": "nl",
  "ar-SA": "sa",
  "zh-Hans": "cn",
};

export function getLocaleFlag(locale: string): string {
  if (LOCALE_FLAG_OVERRIDES[locale]) return LOCALE_FLAG_OVERRIDES[locale];
  const parts = locale.split("-");
  if (parts.length > 1) return parts[1].toLowerCase();
  const lang = parts[0];
  if (LOCALE_FLAG_OVERRIDES[lang]) return LOCALE_FLAG_OVERRIDES[lang];
  return lang.toLowerCase();
}

export function sortStudioLocales(locales: string[]): string[] {
  return [...locales].sort((a, b) => {
    if (a === "en-US") return -1;
    if (b === "en-US") return 1;

    return a.localeCompare(b);
  });
}

const displayNames = new Intl.DisplayNames(["en"], { type: "language" });

export const getLocaleName = (locale: string) => {
  try {
    return displayNames.of(locale)?.replace(/\s*\(.*\)$/, "") ?? locale;
  } catch {
    return locale;
  }
};
