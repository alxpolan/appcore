import { ResourceNames, enums, toMicros } from "google-ads-api";
import { googleAdsGateway } from "./google-ads-gateway";
import { listGoogleAdsCampaignTargeting, listGoogleAdsKeywords } from "./google-ads-reports";
import type {
  GoogleAdsAddKeywordInput,
  GoogleAdsCreateNegativeInput,
  GoogleAdsCreateRsaInput,
  GoogleAdsCreatedRsa,
  GoogleAdsCredentials,
  GoogleAdsKeywordMatchType,
  GoogleAdsMutationOperation,
  GoogleAdsUpdateKeywordInput,
} from "./google-ads-types";

const E: any = enums;

export function validateRsaInput(ad: any, label: string): GoogleAdsCreateRsaInput {
  if (!ad || typeof ad !== "object") throw new Error(`${label} must be an object`);
  const headlines = Array.isArray(ad.headlines) ? ad.headlines.map((t: any) => String(t ?? "").trim()) : [];
  if (headlines.length < 3 || headlines.length > 15) throw new Error(`${label} needs 3-15 headlines`);
  headlines.forEach((t: string, i: number) => {
    if (!t || t.length > 30) throw new Error(`${label} headline ${i + 1} must be 1-30 characters`);
  });
  const descriptions = Array.isArray(ad.descriptions) ? ad.descriptions.map((t: any) => String(t ?? "").trim()) : [];
  if (descriptions.length < 2 || descriptions.length > 4) throw new Error(`${label} needs 2-4 descriptions`);
  descriptions.forEach((t: string, i: number) => {
    if (!t || t.length > 90) throw new Error(`${label} description ${i + 1} must be 1-90 characters`);
  });
  const finalUrl = String(ad.finalUrl ?? "").trim();
  if (!/^https?:\/\/.+\..+/.test(finalUrl)) throw new Error(`${label} finalUrl must be an http(s) URL`);
  const pathOf = (v: any, name: string): string | undefined => {
    if (v == null) return undefined;
    const p = String(v).trim();
    if (!p || p.length > 15) throw new Error(`${label} ${name} must be 1-15 characters`);

    return p;
  };

  const status = ad.status == null ? "PAUSED" : String(ad.status).toUpperCase();
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error(`${label} status must be "ENABLED" or "PAUSED"`);

  return {
    headlines,
    descriptions,
    finalUrl,
    path1: pathOf(ad.path1, "path1"),
    path2: pathOf(ad.path2, "path2"),
    status: status as "ENABLED" | "PAUSED",
  };
}

export async function createGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  input: { name: string; defaultBidAmount: number; status?: "ENABLED" | "PAUSED" },
): Promise<{ id: string; name: string }> {
  const gw = googleAdsGateway(creds);
  const [name] = await gw.mutate([
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        name: input.name,
        status: E.AdGroupStatus[input.status ?? "ENABLED"],
        campaign: ResourceNames.campaign(creds.customerId, campaignId),
        cpc_bid_micros: toMicros(input.defaultBidAmount),
      },
    },
  ]);

  return { id: name.split("/").pop()!, name: input.name };
}

export async function updateGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  patch: { name?: string; status?: "ENABLED" | "PAUSED"; defaultBidAmount?: number },
): Promise<{ id: string }> {
  if (Object.values(patch).every((v) => v == null)) throw new Error("Nothing to update: pass at least one field");
  const gw = googleAdsGateway(creds);
  const resource: Record<string, any> = { resource_name: ResourceNames.adGroup(creds.customerId, adGroupId) };
  if (patch.name != null) resource.name = patch.name;
  if (patch.status != null) resource.status = E.AdGroupStatus[patch.status];
  if (patch.defaultBidAmount != null) resource.cpc_bid_micros = toMicros(patch.defaultBidAmount);
  await gw.mutate([{ entity: "ad_group", operation: "update", resource }]);

  return { id: adGroupId };
}

export async function deleteGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
): Promise<{ id: string; deleted: boolean }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    { entity: "ad_group", operation: "remove", resource: ResourceNames.adGroup(creds.customerId, adGroupId) },
  ]);

  return { id: adGroupId, deleted: true };
}

export async function addGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywords: GoogleAdsAddKeywordInput[],
): Promise<{ id: string; text: string }[]> {
  const gw = googleAdsGateway(creds);
  const groupName = ResourceNames.adGroup(creds.customerId, adGroupId);
  const names = await gw.mutate(
    keywords.map((k) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: groupName,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        status: E.AdGroupCriterionStatus[k.status ?? "ENABLED"],
        ...(k.bidAmount != null ? { cpc_bid_micros: toMicros(k.bidAmount) } : {}),
      },
    })),
  );

  return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
}

export async function updateGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  updates: GoogleAdsUpdateKeywordInput[],
): Promise<{ id: string; text: string; bidAmount: number | null; status: string | null; previousBidAmount: number | null; previousStatus: string | null }[]> {
  const existing = await listGoogleAdsKeywords(creds, campaignId, adGroupId);
  const byId = new Map(existing.map((k) => [k.id, k]));

  for (const u of updates) {
    if (!byId.has(String(u.keywordId))) throw new Error(`Keyword ${u.keywordId} not found in ad group ${adGroupId}`);
    if (u.bidAmount == null && u.status == null) throw new Error(`Keyword ${u.keywordId}: nothing to update`);
  }

  const gw = googleAdsGateway(creds);
  await gw.mutate(
    updates.map((u) => ({
      entity: "ad_group_criterion" as const,
      operation: "update" as const,
      resource: {
        resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, u.keywordId),
        ...(u.status != null ? { status: E.AdGroupCriterionStatus[u.status] } : {}),
        ...(u.bidAmount != null ? { cpc_bid_micros: toMicros(u.bidAmount) } : {}),
      },
    })),
  );

  return updates.map((u) => {
    const known = byId.get(String(u.keywordId))!;

    return {
      id: String(u.keywordId),
      text: known.text,
      bidAmount: u.bidAmount ?? null,
      status: u.status ?? null,
      previousBidAmount: known.cpcBid,
      previousStatus: known.status,
    };
  });
}

export async function deleteGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordIds: (string | number)[],
): Promise<number> {
  const gw = googleAdsGateway(creds);
  await gw.mutate(
    keywordIds.map((id) => ({
      entity: "ad_group_criterion" as const,
      operation: "remove" as const,
      resource: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id),
    })),
  );

  return keywordIds.length;
}

export async function addGoogleAdsNegativeKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null,
  keywords: GoogleAdsCreateNegativeInput[],
): Promise<{ id: string; text: string }[]> {
  const gw = googleAdsGateway(creds);

  if (adGroupId) {
    const groupName = ResourceNames.adGroup(creds.customerId, adGroupId);
    const names = await gw.mutate(
      keywords.map((k) => ({
        entity: "ad_group_criterion" as const,
        operation: "create" as const,
        resource: {
          ad_group: groupName,
          negative: true,
          keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        },
      })),
    );

    return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
  }

  const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
  const names = await gw.mutate(
    keywords.map((k) => ({
      entity: "campaign_criterion" as const,
      operation: "create" as const,
      resource: {
        campaign: campaignName,
        negative: true,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
      },
    })),
  );

  return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
}

export async function deleteGoogleAdsNegativeKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null,
  ids: (string | number)[],
): Promise<number> {
  const gw = googleAdsGateway(creds);

  if (adGroupId) {
    await gw.mutate(
      ids.map((id) => ({
        entity: "ad_group_criterion" as const,
        operation: "remove" as const,
        resource: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id),
      })),
    );
  } else {
    const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
    await gw.mutate(
      ids.map((id) => ({
        entity: "campaign_criterion" as const,
        operation: "remove" as const,
        resource: `${campaignName}/campaignCriteria/${campaignId}~${id}`,
      })),
    );
  }

  return ids.length;
}

export async function createGoogleAdsResponsiveSearchAds(
  creds: GoogleAdsCredentials,
  adGroupId: string,
  ads: GoogleAdsCreateRsaInput[],
): Promise<GoogleAdsCreatedRsa[]> {
  const gw = googleAdsGateway(creds);
  const groupName = ResourceNames.adGroup(creds.customerId, adGroupId);
  const names = await gw.mutate(
    ads.map((a, i) => {
      const ad = validateRsaInput(a, `Ad ${i + 1}`);

      return {
        entity: "ad_group_ad" as const,
        operation: "create" as const,
        resource: {
          ad_group: groupName,
          status: E.AdGroupAdStatus[ad.status ?? "PAUSED"],
          ad: {
            final_urls: [ad.finalUrl],
            responsive_search_ad: {
              headlines: ad.headlines.map((text) => ({ text })),
              descriptions: ad.descriptions.map((text) => ({ text })),
              ...(ad.path1 ? { path1: ad.path1 } : {}),
              ...(ad.path2 ? { path2: ad.path2 } : {}),
            },
          },
        },
      };
    }),
  );

  return names.map((n) => ({ id: n.split("~").pop() ?? "", resourceName: n }));
}

export function validateTargetingIds(list: unknown, label: string): string[] {
  if (list == null) throw new Error(`${label} is required`);
  if (!Array.isArray(list)) throw new Error(`${label} must be an array of numeric ids`);

  return list.map((v: any, i: number) => {
    const id = String(v ?? "").trim();
    if (!/^\d+$/.test(id)) throw new Error(`${label} [${i + 1}] must be a numeric id`);

    return id;
  });
}

export async function replaceGoogleAdsCampaignTargeting(
  creds: GoogleAdsCredentials,
  campaignId: string,
  patch: { locationIds?: (string | number)[]; languageIds?: (string | number)[] },
): Promise<{ locations: string[]; languages: string[] }> {
  const gw = googleAdsGateway(creds);
  const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
  const current = await listGoogleAdsCampaignTargeting(creds, campaignId);
  const ops: GoogleAdsMutationOperation[] = [];
  let locations = current.locations.map((l) => l.geoTargetConstant.split("/").pop() ?? "");
  let languages = current.languages.map((l) => l.languageConstant.split("/").pop() ?? "");

  if (patch.locationIds !== undefined) {
    for (const c of current.locations) {
      ops.push({
        entity: "campaign_criterion",
        operation: "remove",
        resource: `${campaignName}/campaignCriteria/${campaignId}~${c.criterionId}`,
      });
    }

    locations = patch.locationIds.map(String);
    for (const id of locations) {
      ops.push({
        entity: "campaign_criterion",
        operation: "create",
        resource: { campaign: campaignName, location: { geo_target_constant: `geoTargetConstants/${id}` } },
      });
    }
  }

  if (patch.languageIds !== undefined) {
    for (const c of current.languages) {
      ops.push({
        entity: "campaign_criterion",
        operation: "remove",
        resource: `${campaignName}/campaignCriteria/${campaignId}~${c.criterionId}`,
      });
    }

    languages = patch.languageIds.map(String);
    for (const id of languages) {
      ops.push({
        entity: "campaign_criterion",
        operation: "create",
        resource: { campaign: campaignName, language: { language_constant: `languageConstants/${id}` } },
      });
    }
  }

  await gw.mutate(ops);

  return { locations, languages };
}
