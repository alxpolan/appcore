import { ResourceNames, enums, toMicros } from "google-ads-api";
import { asPositiveNumber } from "./utils/ads-validation";
import { googleAdsGateway } from "./google-ads-gateway";
import { listGoogleAdsKeywords } from "./google-ads-reports";
import type {
  GoogleAdsAddKeywordInput,
  GoogleAdsCreateCampaignInput,
  GoogleAdsCreateKeywordInput,
  GoogleAdsCreateNegativeInput,
  GoogleAdsCreatedCampaign,
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

export function validateGoogleAdsCreateCampaignInput(body: any): GoogleAdsCreateCampaignInput {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("name is required");
  if (!Array.isArray(body.adGroups) || body.adGroups.length === 0) throw new Error("At least one ad group is required");
  const status = body.status == null ? "PAUSED" : String(body.status).toUpperCase();
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');

  const keywordsOf = (list: any, label: string): GoogleAdsCreateKeywordInput[] => {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${label} needs at least one keyword`);

    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} keyword ${i + 1}: text is required`);

      return { text, matchType: asMatchType(k?.matchType, `${label} keyword ${i + 1} matchType`), bidAmount: asPositiveNumber(k?.bidAmount, `${label} keyword ${i + 1} bidAmount`) };
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

      return {
        name: groupName,
        defaultBidAmount: asPositiveNumber(g?.defaultBidAmount, `${label} defaultBidAmount`),
        status: groupStatus as "ENABLED" | "PAUSED",
        keywords: keywordsOf(g?.keywords, label),
        negativeKeywords: negativesOf(g?.negativeKeywords, label),
      };
    }),
    negativeKeywords: negativesOf(body.negativeKeywords, "Campaign"),
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
        manual_cpc: { enhanced_cpc_enabled: false },
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
          cpc_bid_micros: toMicros(group.defaultBidAmount),
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
        cpc_bid_micros: toMicros(k.bidAmount),
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

    adGroups.push({
      id: adGroupId,
      name: group.name,
      keywords: keywordNames.map((n, i) => ({ id: n.split("~").pop()!, text: group.keywords[i].text })),
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

  return { id: campaignId, name: input.name, status: input.status, budgetResourceName: budgetName, adGroups };
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
    { entity: "campaign", operation: "remove", resource: { resource_name: ResourceNames.campaign(creds.customerId, campaignId) } },
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
    { entity: "ad_group", operation: "remove", resource: { resource_name: ResourceNames.adGroup(creds.customerId, adGroupId) } },
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
      resource: { resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id) },
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
        resource: { resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id) },
      })),
    );
  } else {
    const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
    await gw.mutate(
      ids.map((id) => ({
        entity: "campaign_criterion" as const,
        operation: "remove" as const,
        resource: { resource_name: `${campaignName}/campaignCriteria/${campaignId}~${id}` },
      })),
    );
  }

  return ids.length;
}
