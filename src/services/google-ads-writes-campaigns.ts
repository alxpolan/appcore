import { ResourceNames, enums, toMicros } from "google-ads-api";
import { googleAdsErrorMessage, googleAdsGateway } from "./google-ads-gateway";
import { getGoogleAdsCampaignBudget } from "./google-ads-reports";
import { createGoogleAdsResponsiveSearchAds } from "./google-ads-writes-ad-groups";
import type {
  GoogleAdsCreateCampaignInput,
  GoogleAdsCreatedCampaign,
  GoogleAdsCredentials,
  GoogleAdsDeviceBidAdjustments,
  GoogleAdsGateway,
  GoogleAdsMinuteOfHour,
  GoogleAdsMutationOperation,
} from "./google-ads-types";

const E: any = enums;

const MINUTE_OF_HOUR_NAMES: Record<GoogleAdsMinuteOfHour, "ZERO" | "FIFTEEN" | "THIRTY" | "FORTY_FIVE"> = {
  0: "ZERO",
  15: "FIFTEEN",
  30: "THIRTY",
  45: "FORTY_FIVE",
};

async function createGoogleAdsCampaignAssets(
  gw: GoogleAdsGateway,
  customerId: string,
  campaignName: string,
  input: GoogleAdsCreateCampaignInput,
): Promise<number> {
  type PendingAsset = { fieldType: string; resource: Record<string, unknown> };
  const pending: PendingAsset[] = [];

  for (const s of input.sitelinks ?? []) {
    pending.push({
      fieldType: "SITELINK",
      resource: {
        final_urls: [s.finalUrl],
        sitelink_asset: {
          link_text: s.linkText,
          ...(s.description1 != null ? { description1: s.description1 } : {}),
          ...(s.description2 != null ? { description2: s.description2 } : {}),
        },
      },
    });
  }
  for (const text of input.callouts ?? []) {
    pending.push({ fieldType: "CALLOUT", resource: { callout_asset: { callout_text: text } } });
  }
  for (const s of input.structuredSnippets ?? []) {
    pending.push({
      fieldType: "STRUCTURED_SNIPPET",
      resource: { structured_snippet_asset: { header: s.header, values: s.values } },
    });
  }
  for (const c of input.calls ?? []) {
    pending.push({
      fieldType: "CALL",
      resource: { call_asset: { phone_number: c.phoneNumber, country_code: c.countryCode } },
    });
  }

  if (pending.length === 0) return 0;

  const assetOps: GoogleAdsMutationOperation[] = pending.map((p, i) => ({
    entity: "asset",
    operation: "create",
    resource: { resource_name: ResourceNames.asset(customerId, String(-1 - i)), ...p.resource },
  }));
  const assetNames = await gw.mutate(assetOps);

  const linkOps: GoogleAdsMutationOperation[] = pending.map((p, i) => ({
    entity: "campaign_asset",
    operation: "create",
    resource: { campaign: campaignName, asset: assetNames[i], field_type: E.AssetFieldType[p.fieldType] },
  }));
  await gw.mutate(linkOps);

  return pending.length;
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
  const cpcBidCeilingMicros = input.cpcBidCeiling != null ? { cpc_bid_ceiling_micros: toMicros(input.cpcBidCeiling) } : {};
  const bidding: Record<string, unknown> =
    biddingStrategy === "MAXIMIZE_CLICKS"
      ? { maximize_clicks: { ...cpcBidCeilingMicros } }
      : biddingStrategy === "MAXIMIZE_CONVERSIONS"
        ? {
            maximize_conversions: {
              ...cpcBidCeilingMicros,
              ...(input.targetCpa != null ? { target_cpa_micros: toMicros(input.targetCpa) } : {}),
            },
          }
        : biddingStrategy === "TARGET_CPA"
          ? { target_cpa: { ...cpcBidCeilingMicros, target_cpa_micros: toMicros(input.targetCpa!) } }
          : biddingStrategy === "TARGET_ROAS"
            ? { target_roas: { ...cpcBidCeilingMicros, target_roas: input.targetRoas! / 100 } }
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
        network_settings: {
          target_google_search: true,
          target_search_network: true,
          target_content_network: false,
          target_partner_search_network: false,
        },
        geo_target_type_setting: {
          positive_geo_target_type: E.PositiveGeoTargetType.PRESENCE,
          negative_geo_target_type: E.NegativeGeoTargetType.PRESENCE,
        },
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
  for (const slot of input.adSchedule ?? []) {
    targeting.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignName,
        ad_schedule: {
          day_of_week: E.DayOfWeek[slot.dayOfWeek],
          start_hour: slot.startHour,
          start_minute: E.MinuteOfHour[MINUTE_OF_HOUR_NAMES[slot.startMinute ?? 0]],
          end_hour: slot.endHour,
          end_minute: E.MinuteOfHour[MINUTE_OF_HOUR_NAMES[slot.endMinute ?? 0]],
        },
      },
    });
  }
  const deviceAdjustments: [GoogleAdsDeviceBidAdjustments["mobile"], string][] = [
    [input.deviceBidAdjustments?.mobile, "MOBILE"],
    [input.deviceBidAdjustments?.desktop, "DESKTOP"],
    [input.deviceBidAdjustments?.tablet, "TABLET"],
  ];

  for (const [percent, deviceType] of deviceAdjustments) {
    if (percent == null) continue;

    targeting.push({
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignName,
        device: { type: E.Device[deviceType] },
        bid_modifier: 1 + percent / 100,
      },
    });
  }
  const targetingNames = await gw.mutate(targeting);

  const assetsCreated = await createGoogleAdsCampaignAssets(gw, customerId, campaignName, input);

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
    adScheduleCount: (input.adSchedule ?? []).length,
    assetsCreated,
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
): Promise<{ id: string; deleted: boolean; budgetRemoved: boolean; budgetWarning?: string }> {
  const gw = googleAdsGateway(creds);
  const budget = await getGoogleAdsCampaignBudget(creds, campaignId).catch(() => null);
  await gw.mutate([
    { entity: "campaign", operation: "remove", resource: ResourceNames.campaign(creds.customerId, campaignId) },
  ]);
  if (!budget) {
    return { id: campaignId, deleted: true, budgetRemoved: false, budgetWarning: "campaign budget not found; left in place" };
  }
  if (budget.explicitlyShared !== false) {
    return { id: campaignId, deleted: true, budgetRemoved: false, budgetWarning: "shared budget left in place" };
  }
  try {
    await gw.mutate([{ entity: "campaign_budget", operation: "remove", resource: budget.resourceName }]);

    return { id: campaignId, deleted: true, budgetRemoved: true };
  } catch (err) {
    return { id: campaignId, deleted: true, budgetRemoved: false, budgetWarning: googleAdsErrorMessage(err, "budget removal") };
  }
}

export async function updateGoogleAdsCampaign(
  creds: GoogleAdsCredentials,
  campaignId: string,
  patch: {
    name?: string;
    status?: "ENABLED" | "PAUSED";
    dailyBudgetAmount?: number;
    startDate?: string;
    endDate?: string;
    displayNetworkEnabled?: boolean;
    presenceOnlyTargeting?: boolean;
  },
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

  if (patch.displayNetworkEnabled != null) {
    resource.network_settings = { target_content_network: patch.displayNetworkEnabled };
  }

  if (patch.presenceOnlyTargeting != null) {
    const geoTargetType = patch.presenceOnlyTargeting
      ? E.PositiveGeoTargetType.PRESENCE
      : E.PositiveGeoTargetType.PRESENCE_OR_INTEREST;

    resource.geo_target_type_setting = {
      positive_geo_target_type: geoTargetType,
      negative_geo_target_type: patch.presenceOnlyTargeting
        ? E.NegativeGeoTargetType.PRESENCE
        : E.NegativeGeoTargetType.PRESENCE_OR_INTEREST,
    };
  }

  if (Object.keys(resource).length > 1) {
    await gw.mutate([{ entity: "campaign", operation: "update", resource }]);
  }

  return { id: campaignId };
}
