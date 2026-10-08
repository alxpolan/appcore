export function appleAdsCampaignAttribution(
  appleAttribution: unknown,
  attributes: unknown,
): { campaignId: string; orgId: string | null } | null {
  const apple =
    appleAttribution && typeof appleAttribution === "object" && !Array.isArray(appleAttribution)
      ? (appleAttribution as Record<string, unknown>)
      : {};
      
  const attrs =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? (attributes as Record<string, unknown>)
      : {};

  if (apple.apple_attribution_has_attribution === false) return null;
  if (typeof apple.apple_attribution_source === "string" && apple.apple_attribution_source !== "Apple Ads") return null;

  const rawId = apple.apple_attribution_campaign_id ?? attrs.$appleAdsCampaignId;
  const campaignId = rawId == null ? "" : String(rawId).trim();
  if (!/^\d+$/.test(campaignId)) return null;

  const rawOrgId = apple.apple_attribution_org_id;
  const orgId = rawOrgId == null ? null : String(rawOrgId).trim();
  return { campaignId, orgId: orgId || null };
}
