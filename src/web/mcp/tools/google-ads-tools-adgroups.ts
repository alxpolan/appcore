import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  addGoogleAdsKeywords,
  addGoogleAdsNegativeKeywords,
  createGoogleAdsAdGroup,
  deleteGoogleAdsAdGroup,
  deleteGoogleAdsKeywords,
  deleteGoogleAdsNegativeKeywords,
  listGoogleAdsAdGroups,
  listGoogleAdsNegativeKeywords,
  updateGoogleAdsAdGroup,
  updateGoogleAdsKeywords,
} from "../../../services/google-ads";
import { isTeamAdmin, jsonResult, registerMutatingTool, textResult } from "./shared";
import { getGoogleAdsContext, googleAdsError, googleNegativeKeywordSchema, googleTargetingKeywordSchema } from "./google-ads-tools-shared";
import {
  previousGoogleAdGroup,
  previousGoogleKeywordTexts,
  previousGoogleNegativeTexts,
  summarizeGoogleAddKeywords,
  summarizeGoogleCreateAdGroup,
  summarizeGoogleDeleteAdGroup,
  summarizeGoogleDeleteKeywords,
  summarizeGoogleUpdateAdGroup,
  summarizeGoogleUpdateKeywords,
  summarizeGoogleUpdateNegatives,
} from "./google-ads-tools-summaries";

export function registerGoogleAdsAdGroupTools(server: McpServer, userId: string) {
  registerMutatingTool(
    server,
    userId,
    "create_google_ads_ad_group",
    {
      description:
        "Create an ad group with optional keywords and negative keywords in an existing Google Ads campaign. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to see the campaign's current ad groups.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        name: z.string().describe("Ad group name, e.g. 'Brand Exact'."),
        defaultBidAmount: z.number().positive().describe("Default max CPC bid."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .optional()
          .describe("Ad group status. Defaults to ENABLED."),
        keywords: z
          .array(googleTargetingKeywordSchema)
          .max(500)
          .optional()
          .describe("Targeting keywords for this ad group."),
        negativeKeywords: z
          .array(googleNegativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Negative keywords for this ad group only."),
      },
    },
    async ({ campaignId, name, defaultBidAmount, status, keywords, negativeKeywords }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Creating ad groups requires the team admin role.");
      }

      try {
        const group = await createGoogleAdsAdGroup(ctx.creds, campaignId, { name, defaultBidAmount, status });
        const addedKeywords =
          keywords?.length
            ? await addGoogleAdsKeywords(ctx.creds, campaignId, group.id, keywords)
            : [];

        const addedNegatives =
          negativeKeywords?.length
            ? await addGoogleAdsNegativeKeywords(ctx.creds, campaignId, group.id, negativeKeywords)
            : [];

        return jsonResult({ adGroup: group, addedKeywords, addedNegatives });
      } catch (err) {
        return googleAdsError("create_google_ads_ad_group", err);
      }
    },
    { summarize: summarizeGoogleCreateAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "update_google_ads_ad_group",
    {
      description:
        "Update a Google Ads ad group: default bid, status and/or name. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to find the ad group ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        name: z.string().optional().describe("New ad group name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New ad group status."),
        defaultBidAmount: z.number().positive().optional().describe("New default max CPC bid."),
      },
    },
    async ({ campaignId, adGroupId, name, status, defaultBidAmount }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating ad groups requires the team admin role.");
      }

      const previous = await previousGoogleAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const group = await updateGoogleAdsAdGroup(ctx.creds, campaignId, adGroupId, {
          name,
          status,
          defaultBidAmount,
        });

        return jsonResult({ adGroup: group, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("update_google_ads_ad_group", err);
      }
    },
    { summarize: summarizeGoogleUpdateAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_google_ads_ad_group",
    {
      description:
        "Permanently delete a Google Ads ad group with all its keywords. " +
        "This cannot be undone — prefer update_google_ads_ad_group with PAUSED when the ad group might be needed again. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to find the ad group ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
      },
    },
    async ({ campaignId, adGroupId }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting ad groups requires the team admin role.");
      }

      const previous = await previousGoogleAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const group = await deleteGoogleAdsAdGroup(ctx.creds, campaignId, adGroupId);

        return jsonResult({ adGroup: group, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("delete_google_ads_ad_group", err);
      }
    },
    { summarize: summarizeGoogleDeleteAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "add_google_ads_keywords",
    {
      description:
        "Add targeting keywords to an existing Google Ads ad group. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to find campaign and ad group IDs.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        keywords: z
          .array(googleTargetingKeywordSchema)
          .min(1)
          .max(500)
          .describe("Keywords to add."),
      },
    },
    async ({ campaignId, adGroupId, keywords }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Adding keywords requires the team admin role.");
      }

      try {
        const added = await addGoogleAdsKeywords(ctx.creds, campaignId, adGroupId, keywords);

        return jsonResult({ campaignId, adGroupId, added });
      } catch (err) {
        return googleAdsError("add_google_ads_keywords", err);
      }
    },
    { summarize: summarizeGoogleAddKeywords },
  );

  registerMutatingTool(
    server,
    userId,
    "update_google_ads_keywords",
    {
      description:
        "Update bids and/or status of targeting keywords in a Google Ads ad group. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to find keyword IDs.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        updates: z
          .array(
            z.object({
              keywordId: z.string().describe("Keyword criterion ID (numeric string)."),
              bidAmount: z.number().positive().optional().describe("New max CPC bid."),
              status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New keyword status."),
            }),
          )
          .min(1)
          .max(500)
          .describe("At least one keyword update is required."),
      },
    },
    async ({ campaignId, adGroupId, updates }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating keywords requires the team admin role.");
      }

      try {
        const updated = await updateGoogleAdsKeywords(ctx.creds, campaignId, adGroupId, updates);

        return jsonResult({ campaignId, adGroupId, updated });
      } catch (err) {
        return googleAdsError("update_google_ads_keywords", err);
      }
    },
    { summarize: summarizeGoogleUpdateKeywords },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_google_ads_keywords",
    {
      description:
        "Permanently delete targeting keywords from a Google Ads ad group. " +
        "Requires team admin rights. Use get_google_ads_campaign_detail first to find keyword IDs.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        keywordIds: z
          .array(z.string())
          .min(1)
          .max(500)
          .describe("IDs of the keywords to delete."),
      },
    },
    async ({ campaignId, adGroupId, keywordIds }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting keywords requires the team admin role.");
      }

      const previous = await previousGoogleKeywordTexts(ctx.creds, campaignId, adGroupId, keywordIds);
      try {
        const deleted = await deleteGoogleAdsKeywords(ctx.creds, campaignId, adGroupId, keywordIds);

        return jsonResult({ campaignId, adGroupId, deleted, previous });
      } catch (err) {
        return googleAdsError("delete_google_ads_keywords", err);
      }
    },
    { summarize: summarizeGoogleDeleteKeywords },
  );

  server.registerTool(
    "get_google_ads_negative_keywords",
    {
      description:
        "List negative keywords for one Google Ads campaign: campaign-level negatives plus per-ad-group negatives. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
      },
    },
    async ({ campaignId }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      try {
        const [campaign, adGroups] = await Promise.all([
          listGoogleAdsNegativeKeywords(ctx.creds, campaignId, null),
          listGoogleAdsAdGroups(ctx.creds, campaignId),
        ]);

        const byAdGroup = await Promise.all(
          adGroups.map(async (g) => ({
            id: g.id,
            name: g.name,
            negatives: await listGoogleAdsNegativeKeywords(ctx.creds, campaignId, g.id),
          })),
        );

        return jsonResult({ campaignId, campaign, adGroups: byAdGroup });
      } catch (err) {
        return googleAdsError("get_google_ads_negative_keywords", err);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "update_google_ads_negative_keywords",
    {
      description:
        "Add and/or remove negative keywords on a Google Ads campaign or one of its ad groups. " +
        "Omit adGroupId for campaign-level negatives (they apply to all ad groups). " +
        "Requires team admin rights. Use get_google_ads_negative_keywords first to find IDs for removal.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        adGroupId: z
          .string()
          .optional()
          .describe("Ad group ID for ad-group-level negatives. Omit for campaign-level negatives."),
        add: z.array(googleNegativeKeywordSchema).max(500).optional().describe("Negative keywords to add."),
        removeIds: z.array(z.string()).max(500).optional().describe("IDs of negative keywords to delete."),
      },
    },
    async ({ campaignId, adGroupId, add, removeIds }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Editing negative keywords requires the team admin role.");
      }

      if ((!add || add.length === 0) && (!removeIds || removeIds.length === 0)) {
        return textResult("Nothing to do: pass add and/or removeIds.");
      }

      const removedTexts =
        removeIds?.length ? await previousGoogleNegativeTexts(ctx.creds, campaignId, adGroupId, removeIds) : [];

      try {
        const added = await addGoogleAdsNegativeKeywords(ctx.creds, campaignId, adGroupId ?? null, add ?? []);
        const removed = await deleteGoogleAdsNegativeKeywords(
          ctx.creds,
          campaignId,
          adGroupId ?? null,
          removeIds ?? [],
        );

        return jsonResult({ campaignId, adGroupId: adGroupId ?? null, added, removed, previous: { removedTexts } });
      } catch (err) {
        return googleAdsError("update_google_ads_negative_keywords", err);
      }
    },
    { summarize: summarizeGoogleUpdateNegatives },
  );
}
