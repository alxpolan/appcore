import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  createAppleAdsAdGroup,
  createAppleAdsKeywordsBulk,
  createAppleAdsNegativeKeywordsBulk,
  deleteAppleAdsAdGroup,
  deleteAppleAdsKeywordsBulk,
  deleteAppleAdsNegativeKeywordsBulk,
  listAppleAdsAdGroups,
  listAppleAdsNegativeKeywords,
  updateAppleAdsAdGroup,
  updateAppleAdsKeywords,
} from "../../../services/apple-ads";
import { isTeamAdmin, jsonResult, textResult } from "./shared";
import {
  adsError,
  getAppleAdsContext,
  getCampaignAppleAdsContext,
  negativeKeywordSchema,
  registerAdsMutatingTool,
  registerAdsReadTool,
  targetingKeywordSchema,
} from "./ads-tools-shared";
import {
  previousAdGroup,
  previousKeywordTexts,
  previousNegativeTexts,
  summarizeAddKeywords,
  summarizeCreateAdGroup,
  summarizeDeleteAdGroup,
  summarizeDeleteKeywords,
  summarizeUpdateAdGroup,
  summarizeUpdateKeywords,
  summarizeUpdateNegatives,
} from "./ads-tools-summaries";

export function registerAppleAdsAdGroupTools(server: McpServer, userId: string) {
  registerAdsMutatingTool(
    server,
    userId,
    "create_ads_ad_group",
    {
      description:
        "Create an ad group with optional keywords and negative keywords in an existing Apple Search Ads campaign. " +
        "Requires team admin rights. Use get_ads_campaign_detail first to see the campaign's current ad groups.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        name: z.string().min(1).describe("Ad group name, e.g. 'Brand Exact'."),
        defaultBidAmount: z.number().positive().describe("Default bid per tap (CPC) or per 1k impressions (CPM)."),
        currency: z.string().describe("Three-letter currency code, e.g. USD, EUR."),
        cpaGoal: z.number().positive().optional().describe("Optional target cost per acquisition."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .default("ENABLED")
          .describe("ENABLED (default) or PAUSED."),
        pricingModel: z
          .enum(["CPC", "CPM"])
          .default("CPC")
          .describe("Must match the campaign's placements: CPC for Search Results, CPM for Search Tab / Today Tab."),
        keywords: z
          .array(targetingKeywordSchema)
          .max(500)
          .optional()
          .describe("Keywords for the new ad group (Search Results placements only)."),
        negativeKeywords: z
          .array(negativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Negative keywords for the new ad group."),
      },
    },
    async ({ campaignId, name, defaultBidAmount, currency, cpaGoal, status, pricingModel, keywords, negativeKeywords }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Creating ad groups requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!/^[A-Z]{3}$/i.test(currency)) return textResult("currency must be a three-letter code like USD or EUR.");
      try {
        const adGroup = await createAppleAdsAdGroup(ctx.creds, campaignId, currency.toUpperCase(), pricingModel, undefined, {
          name,
          defaultBidAmount,
          cpaGoal,
          status,
        });

        const keywordCount = await createAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroup.id, currency.toUpperCase(), keywords ?? []);
        const negatives = await createAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroup.id, negativeKeywords ?? []);

        return jsonResult({ adGroup: { ...adGroup, keywordCount, negativeKeywordCount: negatives.length } });
      } catch (err) {
        return adsError("create_ads_ad_group", err);
      }
    },
    { summarize: summarizeCreateAdGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "update_ads_ad_group",
    {
      description:
        "Update an Apple Search Ads ad group: default bid, CPA goal, status and/or name. " +
        "Only the passed fields change. Requires team admin rights. " +
        "Use get_ads_campaign_detail first to find the ad group ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        name: z.string().optional().describe("New ad group name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("ENABLED or PAUSED."),
        defaultBidAmount: z.number().positive().optional().describe("New default bid."),
        cpaGoal: z.number().positive().optional().describe("New target cost per acquisition."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when setting defaultBidAmount or cpaGoal."),
      },
    },
    async ({ campaignId, adGroupId, name, status, defaultBidAmount, cpaGoal, currency }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Updating ad groups requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      const previous = await previousAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const adGroup = await updateAppleAdsAdGroup(ctx.creds, campaignId, adGroupId, {
          name,
          status,
          defaultBidAmount,
          cpaGoal,
          currency,
        });

        return jsonResult({ adGroup, previous: previous ?? null });
      } catch (err: any) {
        if (err?.response == null) return textResult(`Invalid ad group update: ${err.message}`);

        return adsError("update_ads_ad_group", err);
      }
    },
    { summarize: summarizeUpdateAdGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "delete_ads_ad_group",
    {
      description:
        "Permanently delete an Apple Search Ads ad group with all its keywords. " +
        "This cannot be undone — prefer update_ads_ad_group with PAUSED when the ad group might be needed again. " +
        "Only delete when the user explicitly asks for deletion. Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
      },
    },
    async ({ campaignId, adGroupId }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Deleting ad groups requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      const previous = await previousAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const adGroup = await deleteAppleAdsAdGroup(ctx.creds, campaignId, adGroupId);

        return jsonResult({ adGroup, previous: previous ? { name: previous.name } : null });
      } catch (err) {
        return adsError("delete_ads_ad_group", err);
      }
    },
    { summarize: summarizeDeleteAdGroup },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "add_ads_keywords",
    {
      description:
        "Add targeting keywords to an existing Apple Search Ads ad group. " +
        "Keywords only take effect for the APPSTORE_SEARCH_RESULTS placement. " +
        "Requires team admin rights. Use get_ads_campaign_detail first to find campaign and ad group IDs.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when any keyword sets a bidAmount."),
        keywords: z
          .array(targetingKeywordSchema)
          .min(1)
          .max(500)
          .describe("Keywords to add."),
      },
    },
    async ({ campaignId, adGroupId, currency, keywords }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Adding keywords requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      if (keywords.some((k: any) => k.bidAmount != null) && !/^[A-Z]{3}$/i.test(currency ?? "")) {
        return textResult("currency (e.g. USD, EUR) is required when setting keyword bids.");
      }

      try {
        const count = await createAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroupId, (currency ?? "USD").toUpperCase(), keywords);

        return jsonResult({ campaignId, adGroupId, added: count });
      } catch (err) {
        return adsError("add_ads_keywords", err);
      }
    },
    { summarize: summarizeAddKeywords },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "update_ads_keywords",
    {
      description:
        "Update bids and/or status of targeting keywords in an Apple Search Ads ad group, by keyword ID. " +
        "Only the passed fields change per keyword. Requires team admin rights. " +
        "Use get_ads_campaign_detail first to find keyword IDs and current bids.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when setting bids."),
        updates: z
          .array(
            z.object({
              keywordId: z.string().describe("Keyword ID (numeric string)."),
              bidAmount: z.number().positive().optional().describe("New keyword-level bid."),
              status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("ACTIVE or PAUSED."),
            }),
          )
          .min(1)
          .max(500)
          .describe("At least one keyword update with bidAmount and/or status each."),
      },
    },
    async ({ campaignId, adGroupId, currency, updates }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Updating keywords requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      try {
        const updated = await updateAppleAdsKeywords(ctx.creds, campaignId, adGroupId, currency, updates);

        return jsonResult({ campaignId, adGroupId, updated });
      } catch (err: any) {
        if (err?.response == null) return textResult(`Invalid keyword update: ${err.message}`);

        return adsError("update_ads_keywords", err);
      }
    },
    { summarize: summarizeUpdateKeywords },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "delete_ads_keywords",
    {
      description:
        "Permanently delete targeting keywords from an Apple Search Ads ad group, by keyword ID. " +
        "This cannot be undone — prefer update_ads_keywords with PAUSED when a keyword might be needed again. " +
        "Only delete when the user explicitly asks for deletion. Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        keywordIds: z
          .array(z.string())
          .min(1)
          .max(500)
          .describe("IDs of the keywords to delete (numeric strings)."),
      },
    },
    async ({ campaignId, adGroupId, keywordIds }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Deleting keywords requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      const previous = await previousKeywordTexts(ctx.creds, campaignId, adGroupId, keywordIds);
      try {
        const deleted = await deleteAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroupId, keywordIds);

        return jsonResult({ campaignId, adGroupId, deleted, previous });
      } catch (err) {
        return adsError("delete_ads_keywords", err);
      }
    },
    { summarize: summarizeDeleteKeywords },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_negative_keywords",
    {
      description:
        "List negative keywords for one Apple Search Ads campaign: campaign-level negatives plus per-ad-group negatives. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
      },
    },
    async ({ campaignId }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      try {
        const [campaign, adGroups] = await Promise.all([
          listAppleAdsNegativeKeywords(ctx.creds, campaignId, null),
          listAppleAdsAdGroups(ctx.creds, campaignId),
        ]);

        const byAdGroup = await Promise.all(
          adGroups.map(async (g) => ({
            id: g.id,
            name: g.name,
            negatives: await listAppleAdsNegativeKeywords(ctx.creds, campaignId, g.id),
          })),
        );

        return jsonResult({ campaignId, campaign, adGroups: byAdGroup });
      } catch (err) {
        return adsError("get_ads_negative_keywords", err);
      }
    },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "update_ads_negative_keywords",
    {
      description:
        "Add and/or remove negative keywords on an Apple Search Ads campaign or one of its ad groups. " +
        "Omit adGroupId for campaign-level negatives (they apply to all ad groups). " +
        "Requires team admin rights. Use get_ads_negative_keywords first to find IDs for removal.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z
          .string()
          .optional()
          .describe("Ad group ID for ad-group-level negatives. Omit for campaign-level negatives."),
        add: z.array(negativeKeywordSchema).max(500).optional().describe("Negative keywords to add."),
        removeIds: z.array(z.string()).max(500).optional().describe("IDs of negative keywords to delete."),
      },
    },
    async ({ campaignId, adGroupId, add, removeIds }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Editing negative keywords requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      if ((!add || add.length === 0) && (!removeIds || removeIds.length === 0)) {
        return textResult("Nothing to do: pass add and/or removeIds.");
      }

      const removedTexts =
        removeIds?.length ? await previousNegativeTexts(ctx.creds, campaignId, adGroupId, removeIds) : [];

      try {
        const added = await createAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroupId ?? null, add ?? []);
        const removed = await deleteAppleAdsNegativeKeywordsBulk(
          ctx.creds,
          campaignId,
          adGroupId ?? null,
          removeIds ?? [],
        );

        return jsonResult({ campaignId, adGroupId: adGroupId ?? null, added, removed, previous: { removedTexts } });
      } catch (err) {
        return adsError("update_ads_negative_keywords", err);
      }
    },
    { summarize: summarizeUpdateNegatives },
  );
}
