import { ResourceNames, enums, toMicros } from "google-ads-api";
import { asPositiveNumber } from "./utils/ads-validation";
import { googleAdsGateway } from "./google-ads-gateway";
import { listGoogleAdsCampaignTargeting, listGoogleAdsKeywords } from "./google-ads-reports";
import type {
  GoogleAdsAddKeywordInput,
  GoogleAdsCreateCampaignInput,
  GoogleAdsCreateKeywordInput,
  GoogleAdsCreateNegativeInput,
  GoogleAdsCreateRsaInput,
  GoogleAdsCreatedCampaign,
  GoogleAdsCreatedRsa,
  GoogleAdsCredentials,
  GoogleAdsKeywordMatchType,
  GoogleAdsMutationOperation,
  GoogleAdsUpdateKeywordInput,
} from "./google-ads-types";

const E: any = enums;

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;

function asMatchType(value: unknown, label: string): GoogleAdsKeywordMatchType {
  const upper = String(value ?? "").toUpperCase();

  if (!(MATCH_TYPES as readonly string[]).includes(upper)) {
    throw new Error(`${label} must be one of EXACT, PHRASE, BROAD`);
  }

  return upper as GoogleAdsKeywordMatchType;
}

function asDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }

  return value;
}

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

export function validateGoogleAdsCreateCampaignInput(body: any): GoogleAdsCreateCampaignInput {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("name is required");
  if (!Array.isArray(body.adGroups) || body.adGroups.length === 0) throw new Error("At least one ad group is required");
  const status = body.status == null ? "PAUSED" : String(body.status).toUpperCase();
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');
  const biddingStrategy = body.biddingStrategy == null ? "MANUAL_CPC" : String(body.biddingStrategy).toUpperCase();
  if (biddingStrategy !== "MANUAL_CPC" && biddingStrategy !== "MAXIMIZE_CLICKS") {
    throw new Error('biddingStrategy must be "MANUAL_CPC" or "MAXIMIZE_CLICKS"');
  }
  const manualBids = biddingStrategy === "MANUAL_CPC";
  const cpcBidCeiling = body.cpcBidCeiling == null ? undefined : asPositiveNumber(body.cpcBidCeiling, "cpcBidCeiling");
  if (cpcBidCeiling != null && biddingStrategy !== "MAXIMIZE_CLICKS") {
    throw new Error("cpcBidCeiling only applies to MAXIMIZE_CLICKS");
  }

  const keywordsOf = (list: any, label: string): GoogleAdsCreateKeywordInput[] => {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${label} needs at least one keyword`);

    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} keyword ${i + 1}: text is required`);
      const bidAmount =
        k?.bidAmount == null
          ? undefined
          : asPositiveNumber(k.bidAmount, `${label} keyword ${i + 1} bidAmount`);
      if (manualBids && bidAmount == null) throw new Error(`${label} keyword ${i + 1}: bidAmount is required for MANUAL_CPC`);

      return { text, matchType: asMatchType(k?.matchType, `${label} keyword ${i + 1} matchType`), bidAmount };
    });
  };
  const negativesOf = (list: any, label: string): GoogleAdsCreateNegativeInput[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`${label} negativeKeywords must be an array`);

    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} negative keyword ${i + 1}: text is required`);

      return { text, matchType: asMatchType(k?.matchType, `${label} negative keyword ${i + 1} matchType`) };
    });
  };
  const idsOf = (list: any, label: string): (string | number)[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`${label} must be an array of numeric ids`);

    return list.map((v: any, i: number) => {
      const id = String(v ?? "").trim();
      if (!/^\d+$/.test(id)) throw new Error(`${label} [${i + 1}] must be a numeric id`);
      return id;
    });
  };

  return {
    name,
    dailyBudgetAmount: asPositiveNumber(body.dailyBudgetAmount, "dailyBudgetAmount"),
    currency: body.currency != null ? String(body.currency).toUpperCase() : undefined,
    status: status as "ENABLED" | "PAUSED",
    startDate: body.startDate != null ? asDate(body.startDate, "startDate") : undefined,
    endDate: body.endDate != null ? asDate(body.endDate, "endDate") : undefined,
    adGroups: body.adGroups.map((g: any, i: number) => {
      const label = `Ad group ${i + 1}`;
      const groupName = String(g?.name ?? "").trim();
      if (!groupName) throw new Error(`${label}: name is required`);
      const groupStatus = g?.status == null ? "ENABLED" : String(g.status).toUpperCase();

      if (groupStatus !== "ENABLED" && groupStatus !== "PAUSED") {
        throw new Error(`${label}: status must be "ENABLED" or "PAUSED"`);
      }

      if (g?.ads != null && !Array.isArray(g.ads)) throw new Error(`${label}: ads must be an array`);
      const ads = (g?.ads ?? []).map((a: any, i: number) => validateRsaInput(a, `${label} ad ${i + 1}`));
      const defaultBidAmount =
        g?.defaultBidAmount == null ? undefined : asPositiveNumber(g.defaultBidAmount, `${label} defaultBidAmount`);
      if (manualBids && defaultBidAmount == null) throw new Error(`${label}: defaultBidAmount is required for MANUAL_CPC`);

      return {
        name: groupName,
        defaultBidAmount,
        status: groupStatus as "ENABLED" | "PAUSED",
        keywords: keywordsOf(g?.keywords, label),
        negativeKeywords: negativesOf(g?.negativeKeywords, label),
        ads,
      };
    }),
    negativeKeywords: negativesOf(body.negativeKeywords, "Campaign"),
    locationIds: idsOf(body.locationIds, "locationIds"),
    languageIds: idsOf(body.languageIds, "languageIds"),
    biddingStrategy: biddingStrategy as "MANUAL_CPC" | "MAXIMIZE_CLICKS",
    cpcBidCeiling,
  };
}

export async function createGoogleAdsCampaignFull(
  creds: GoogleAdsCredentials,
  input: GoogleAdsCreateCampaignInput,
): Promise<GoogleAdsCreatedCampaign> {
  const gw = googleAdsGateway(creds);
  const customerId = creds.customerId;
  const budgetTemp = ResourceNames.campaignBudget(customerId, "-1");
  const campaignTemp = ResourceNames.campaign(customerId, "-2");
  const biddingStrategy = input.biddingStrategy ?? "MANUAL_CPC";
  const bidding =
    biddingStrategy === "MAXIMIZE_CLICKS"
      ? {
          maximize_clicks: {
            ...(input.cpcBidCeiling != null ? { cpc_bid_ceiling_micros: toMicros(input.cpcBidCeiling) } : {}),
          },
        }
      : { manual_cpc: { enhanced_cpc_enabled: false } };

  const header: GoogleAdsMutationOperation[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTemp,
        name: `${input.name} budget`,
        delivery_method: E.BudgetDeliveryMethod.STANDARD,
        amount_micros: toMicros(input.dailyBudgetAmount),
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignTemp,
        name: input.name,
        advertising_channel_type: E.AdvertisingChannelType.SEARCH,
        status: E.CampaignStatus[input.status],
        ...bidding,
        campaign_budget: budgetTemp,
        network_settings: { target_google_search: true, target_search_network: true },
        contains_eu_political_advertising:
          E.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
        ...(input.startDate ? { start_date: input.startDate.replace(/-/g, "") } : {}),
        ...(input.endDate ? { end_date: input.endDate.replace(/-/g, "") } : {}),
      },
    },
  ];

  const [budgetName, campaignName] = await gw.mutate(header);
  const campaignId = campaignName.split("/").pop()!;

  const adGroups: GoogleAdsCreatedCampaign["adGroups"] = [];
  let tempCounter = -3;
  for (const group of input.adGroups) {
    const groupTemp = ResourceNames.adGroup(customerId, String(tempCounter--));
    const [groupName] = await gw.mutate([
      {
        entity: "ad_group",
        operation: "create",
        resource: {
          resource_name: groupTemp,
          name: group.name,
          status: E.AdGroupStatus[group.status ?? "ENABLED"],
          campaign: campaignName,
          ...(biddingStrategy === "MANUAL_CPC" && group.defaultBidAmount != null
            ? { cpc_bid_micros: toMicros(group.defaultBidAmount) }
            : {}),
        },
      },
    ]);

    const adGroupId = groupName.split("/").pop()!;
    const keywordOps: GoogleAdsMutationOperation[] = group.keywords.map((k) => ({
      entity: "ad_group_criterion",
      operation: "create",
      resource: {
        ad_group: groupName,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        status: E.AdGroupCriterionStatus.ENABLED,
        ...(biddingStrategy === "MANUAL_CPC" && k.bidAmount != null ? { cpc_bid_micros: toMicros(k.bidAmount) } : {}),
      },
    }));
    const keywordNames = keywordOps.length > 0 ? await gw.mutate(keywordOps) : [];

    if ((group.negativeKeywords ?? []).length > 0) {
      await gw.mutate(
        group.negativeKeywords!.map((k) => ({
          entity: "ad_group_criterion",
          operation: "create",
          resource: {
            ad_group: groupName,
            negative: true,
            keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
          },
        })),
      );
    }

    const createdAds = await createGoogleAdsResponsiveSearchAds(creds, adGroupId, group.ads ?? []);

    adGroups.push({
      id: adGroupId,
      name: group.name,
      keywords: keywordNames.map((n, i) => ({ id: n.split("~").pop()!, text: group.keywords[i].text })),
      ads: createdAds,
    });
  }

  if ((input.negativeKeywords ?? []).length > 0) {
    await gw.mutate(
      input.negativeKeywords!.map((k) => ({
        entity: "campaign_criterion",
        operation: "create",
        resource: {
          campaign: campaignName,
          negative: true,
          keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        },
      })),
    );
  }

  const targeting: GoogleAdsMutationOperation[] = [];
  for (const raw of input.locationIds ?? []) {
    const id = String(raw);
    targeting.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: { campaign: campaignName, location: { geo_target_constant: `geoTargetConstants/${id}` } },
    });
  }
  for (const raw of input.languageIds ?? []) {
    const id = String(raw);
    targeting.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: { campaign: campaignName, language: { language_constant: `languageConstants/${id}` } },
    });
  }
  const targetingNames = await gw.mutate(targeting);

  return {
    id: campaignId,
    name: input.name,
    status: input.status,
    biddingStrategy,
    budgetResourceName: budgetName,
    adGroups,
    locations: (input.locationIds ?? []).map(String),
    languages: (input.languageIds ?? []).map(String),
    targetingResourceNames: targetingNames,
  };
}

export async function updateGoogleAdsCampaignStatus(
  creds: GoogleAdsCredentials,
  campaignId: string,
  status: "ENABLED" | "PAUSED",
): Promise<{ id: string; status: string }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    {
      entity: "campaign",
      operation: "update",
      resource: {
        resource_name: ResourceNames.campaign(creds.customerId, campaignId),
        status: E.CampaignStatus[status],
      },
    },
  ]);

  return { id: campaignId, status };
}

export async function deleteGoogleAdsCampaign(
  creds: GoogleAdsCredentials,
  campaignId: string,
): Promise<{ id: string; deleted: boolean }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    { entity: "campaign", operation: "remove", resource: ResourceNames.campaign(creds.customerId, campaignId) },
  ]);

  return { id: campaignId, deleted: true };
}

export async function updateGoogleAdsCampaign(
  creds: GoogleAdsCredentials,
  campaignId: string,
  patch: { name?: string; status?: "ENABLED" | "PAUSED"; dailyBudgetAmount?: number; startDate?: string; endDate?: string },
): Promise<{ id: string }> {
  if (Object.values(patch).every((v) => v == null)) throw new Error("Nothing to update: pass at least one field");
  const gw = googleAdsGateway(creds);
  const campaignName = ResourceNames.campaign(creds.customerId, campaignId);

  if (patch.dailyBudgetAmount != null) {
    const rows = await gw.query(
      `SELECT campaign.id, campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
    );

    const budgetName = String(rows[0]?.campaign?.campaign_budget ?? "");
    if (!budgetName) throw new Error(`Campaign ${campaignId} has no budget to update`);
    await gw.mutate([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: { resource_name: budgetName, amount_micros: toMicros(patch.dailyBudgetAmount) },
      },
    ]);
  }

  const resource: Record<string, any> = { resource_name: campaignName };
  if (patch.name != null) resource.name = patch.name;
  if (patch.status != null) resource.status = E.CampaignStatus[patch.status];
  if (patch.startDate != null) resource.start_date = patch.startDate.replace(/-/g, "");
  if (patch.endDate != null) resource.end_date = patch.endDate.replace(/-/g, "");

  if (Object.keys(resource).length > 1) {
    await gw.mutate([{ entity: "campaign", operation: "update", resource }]);
  }

  return { id: campaignId };
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
