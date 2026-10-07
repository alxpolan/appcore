import { ALPHA3_TO_ALPHA2 } from "../../../src/services/utils/territory-codes";

export function territoryFlagSrc(territory: string | null | undefined): string | null {
  if (!territory) return null;
  const alpha2 = ALPHA3_TO_ALPHA2[territory.toUpperCase()];
  return alpha2 ? `/country-flags/${alpha2.toLowerCase()}.svg` : null;
}
