const COUNTRY_SCREENSHOT_LOCALES: Record<string, string[]> = {
  US: ["en-US"],
  GB: ["en-GB", "en-US"],
  AU: ["en-AU", "en-US"],
  CA: ["en-CA", "en-US"],
  IE: ["en-GB", "en-US"],
  NZ: ["en-AU", "en-US"],
  SG: ["en-US"],
  PH: ["en-US"],
  IN: ["hi", "en-US"],
  PK: ["ur-PK", "en-US"],
  DE: ["de-DE"],
  AT: ["de-DE"],
  CH: ["de-DE"],
  FR: ["fr-FR"],
  BE: ["fr-FR"],
  LU: ["fr-FR"],
  MC: ["fr-FR"],
  ES: ["es-ES"],
  MX: ["es-MX", "es-ES"],
  AR: ["es-ES"],
  CL: ["es-ES"],
  CO: ["es-ES"],
  PE: ["es-ES"],
  VE: ["es-ES"],
  UY: ["es-ES"],
  BO: ["es-ES"],
  CR: ["es-ES"],
  EC: ["es-ES"],
  GT: ["es-ES"],
  HN: ["es-ES"],
  PA: ["es-ES"],
  SV: ["es-ES"],
  IT: ["it"],
  PT: ["pt-PT"],
  BR: ["pt-BR"],
  AO: ["pt-PT"],
  NL: ["nl-NL"],
  SR: ["nl-NL"],
  SE: ["sv"],
  NO: ["no"],
  DK: ["da"],
  FI: ["fi"],
  IS: ["en-US"],
  PL: ["pl"],
  CZ: ["cs"],
  SK: ["sk"],
  HU: ["hu"],
  RO: ["ro"],
  BG: ["en-US"],
  HR: ["hr"],
  SI: ["sl-SI", "en-US"],
  EE: ["en-US"],
  LV: ["en-US"],
  LT: ["en-US"],
  GR: ["el"],
  CY: ["el"],
  TR: ["tr"],
  RU: ["ru"],
  BY: ["ru"],
  KZ: ["ru"],
  UA: ["uk"],
  JP: ["ja"],
  KR: ["ko"],
  CN: ["zh-Hans"],
  TW: ["zh-Hant"],
  HK: ["zh-Hant"],
  MO: ["zh-Hant"],
  TH: ["th"],
  VN: ["vi"],
  ID: ["id"],
  MY: ["ms"],
  BN: ["ms"],
  SA: ["ar-SA"],
  AE: ["ar-SA"],
  QA: ["ar-SA"],
  EG: ["ar-SA"],
  DZ: ["ar-SA"],
  TN: ["ar-SA"],
  MA: ["ar-SA"],
  JO: ["ar-SA"],
  LB: ["ar-SA"],
  KW: ["ar-SA"],
  OM: ["ar-SA"],
  BH: ["ar-SA"],
  YE: ["ar-SA"],
  IL: ["he"],
  AD: ["ca", "es-ES"],
  NG: ["en-US"],
  KE: ["en-US"],
  GH: ["en-US"],
  ZA: ["en-US"],
  LK: ["en-US"],
  MT: ["en-US"],
  TZ: ["en-US"],
  UG: ["en-US"],
  JM: ["en-US"],
  MG: ["fr-FR"],
  ML: ["fr-FR"],
  MU: ["fr-FR"],
  NE: ["fr-FR"],
  SN: ["fr-FR"],
};

export function countryToScreenshotLocales(country: string): string[] {
  return COUNTRY_SCREENSHOT_LOCALES[country.trim().toUpperCase()] ?? [];
}

export function resolveProposalLocales(campaignCountries: string[], sourceLocales: string[]): string[] {
  const supported: string[] = [];
  const optimistic: string[] = [];

  for (const country of campaignCountries) {
    const prefs = countryToScreenshotLocales(country);
    const hit = prefs.find((locale) => sourceLocales.includes(locale));

    if (hit) {
      supported.push(hit);
    } else if (prefs[0]) {
      optimistic.push(prefs[0]);
    }
  }

  const uniqueSupported = [...new Set(supported)];

  if (uniqueSupported.length > 0) return uniqueSupported;
  if (sourceLocales.includes("en-US")) return ["en-US"];
  if (sourceLocales.length > 0) return [sourceLocales[0]];

  return [...new Set(optimistic)];
}
