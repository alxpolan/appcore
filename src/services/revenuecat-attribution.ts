export interface AppleAdsAttribution {
  campaignId: string;
  orgId: string | null;
  adGroupId: string | null;
  keywordId: string | null;
}

function numericId(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return /^\d+$/.test(s) ? s : null;
}

// RevenueCat's Apple Search Ads integration writes these as reserved
// subscriber attributes ($appleAds*), not as a separate "apple_attribution"
// object on the customer resource (that field was assumed, not verified, by
// an earlier pass — it doesn't actually appear in the live API response).
export function appleAdsCampaignAttribution(
  appleAttribution: unknown,
  attributes: unknown,
): AppleAdsAttribution | null {
  const apple =
    appleAttribution && typeof appleAttribution === "object" && !Array.isArray(appleAttribution)
      ? (appleAttribution as Record<string, unknown>)
      : {};

  const attrs =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? (attributes as Record<string, unknown>)
      : {};

  if (apple.apple_attribution_has_attribution === false) return null;
  const mediaSource = apple.apple_attribution_source ?? attrs.$mediaSource;
  if (typeof mediaSource === "string" && mediaSource !== "Apple Ads" && mediaSource !== "Apple Search Ads") return null;

  const campaignId = numericId(apple.apple_attribution_campaign_id ?? attrs.$appleAdsCampaignId);
  if (!campaignId) return null;

  const orgId = numericId(apple.apple_attribution_org_id ?? attrs.$appleAdsOrgId);
  const adGroupId = numericId(apple.apple_attribution_ad_group_id ?? attrs.$appleAdsAdGroupId);
  const keywordId = numericId(apple.apple_attribution_keyword_id ?? attrs.$appleAdsKeywordId);

  return { campaignId, orgId, adGroupId, keywordId };
}
