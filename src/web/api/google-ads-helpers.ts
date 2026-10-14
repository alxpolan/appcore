import { decryptNullable } from "../../config/encryption";
import type { GoogleAdsCredentials } from "../../services/google-ads";

export function googleAdsKeyMissing(s: any): boolean {
  return (
    !s?.googleAdsConnectedAt ||
    !s.googleAdsClientId ||
    !s.googleAdsClientSecret ||
    !s.googleAdsRefreshToken ||
    !s.googleAdsCustomerId
  );
}

export function googleAdsCreds(s: any): GoogleAdsCredentials {
  return {
    customerId: String(s.googleAdsCustomerId).replace(/-/g, ""),
    clientId: s.googleAdsClientId,
    clientSecret: decryptNullable(s.googleAdsClientSecret)!,
    refreshToken: decryptNullable(s.googleAdsRefreshToken)!,
    developerToken: decryptNullable(s.googleAdsDeveloperToken) ?? undefined,
  };
}
