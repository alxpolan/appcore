import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  createGoogleAdsCampaignFull,
  deleteGoogleAdsCampaign,
  getGoogleAdsCampaignCountryBreakdown,
  getGoogleAdsCampaignDailySpend,
  getGoogleAdsCampaignDetail,
  listGoogleAdsCampaigns,
  replaceGoogleAdsCampaignTargeting,
  resolveGoogleAdsRange,
  updateGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  validateGoogleAdsCreateCampaignInput,
} from "../../../services/google-ads";
import { isTeamAdmin, jsonResult, registerMutatingTool, textResult } from "./shared";
import {
  getGoogleAdsContext,
  googleAdsError,
  googleNegativeKeywordSchema,
  googleTargetingKeywordSchema,
  rangeSchema,
} from "./google-ads-tools-shared";
import {
  previousGoogleCampaign,
  previousGoogleCampaignTargeting,
  summarizeGoogleCampaignStatus,
  summarizeGoogleCampaignTargeting,
  summarizeGoogleCreateCampaign,
  summarizeGoogleDeleteCampaign,
  summarizeGoogleUpdateCampaign,
} from "./google-ads-tools-summaries";

export function registerGoogleAdsCampaignTools(server: McpServer, userId: string) {
  server.registerTool(
    "list_google_ads_campaigns",
    {
      description:
        "List Google Ads Search campaigns with spend and performance stats (impressions, clicks, CTR, conversions, avg CPC) for a date range. " +
        "Call this to discover campaign IDs before using the campaign-scoped tools.",
      inputSchema: { ...rangeSchema },
    },
    async ({ days, startDate, endDate }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveGoogleAdsRange({ days, startDate, endDate });
        const campaigns = await listGoogleAdsCampaigns(ctx.creds, range);

        return jsonResult({ range, campaigns });
      } catch (err) {
        return googleAdsError("list_google_ads_campaigns", err);
      }
    },
  );

  server.registerTool(
    "get_google_ads_campaign_detail",
    {
      description:
        "Get ad groups with keywords, bids and performance stats for one Google Ads campaign. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, startDate, endDate }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveGoogleAdsRange({ days, startDate, endDate });
        const adGroups = await getGoogleAdsCampaignDetail(ctx.creds, campaignId, range);

        return jsonResult({ range, campaignId, adGroups });
      } catch (err) {
        return googleAdsError("get_google_ads_campaign_detail", err);
      }
    },
  );

  server.registerTool(
    "get_google_ads_campaign_daily_spend",
    {
      description:
        "Get daily ad spend for one Google Ads campaign as a date series. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, startDate, endDate }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveGoogleAdsRange({ days, startDate, endDate });
        const daysSeries = await getGoogleAdsCampaignDailySpend(ctx.creds, campaignId, range);

        return jsonResult({ range, campaignId, days: daysSeries });
      } catch (err) {
        return googleAdsError("get_google_ads_campaign_daily_spend", err);
      }
    },
  );

  server.registerTool(
    "get_google_ads_campaign_country_breakdown",
    {
      description:
        "Get per-country performance for one Google Ads campaign: spend, impressions, clicks, CTR, " +
        "conversions and average CPC broken out by country. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, startDate, endDate }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveGoogleAdsRange({ days, startDate, endDate });
        const countries = await getGoogleAdsCampaignCountryBreakdown(ctx.creds, campaignId, range);

        return jsonResult({ range, campaignId, countries });
      } catch (err) {
        return googleAdsError("get_google_ads_campaign_country_breakdown", err);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "create_google_ads_campaign",
    {
      description:
        "Create a Google Ads Search campaign with ad groups, keywords and negative keywords via the Google Ads API. " +
        "The campaign starts PAUSED by default so it can be reviewed in Google Ads before it spends money — " +
        "pass status ENABLED only when the user explicitly asks to run it immediately, " +
        "or publish it later with update_google_ads_campaign_status. " +
        "Requires team admin rights. Note: the campaign also needs responsive search ads " +
        "and geo targeting (both managed in the Google Ads UI) before it can serve. " +
        "Campaign-level negativeKeywords apply to the whole campaign; per-ad-group negativeKeywords apply to that ad group only.",
      inputSchema: {
        name: z.string().describe("Campaign name, e.g. 'MyApp - US - Brand'."),
        dailyBudgetAmount: z.number().positive().describe("Daily budget in the account currency, e.g. 50."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .default("PAUSED")
          .describe("PAUSED (default, recommended) or ENABLED to run immediately."),
        startDate: z.string().optional().describe("Start date, YYYY-MM-DD. Defaults to today when omitted."),
        endDate: z.string().optional().describe("Optional end date, YYYY-MM-DD."),
        adGroups: z
          .array(
            z.object({
              name: z.string().describe("Ad group name, e.g. 'Brand Exact'."),
              defaultBidAmount: z.number().positive().describe("Default max CPC bid."),
              keywords: z
                .array(
                  googleTargetingKeywordSchema.extend({
                    bidAmount: z.number().positive().describe("Keyword-level max CPC bid (required at creation)."),
                  }),
                )
                .min(1)
                .max(500)
                .describe("At least one keyword per ad group is required."),
              negativeKeywords: z
                .array(googleNegativeKeywordSchema)
                .max(500)
                .optional()
                .describe("Negative keywords for this ad group only. Omit when none are needed."),
            }),
          )
          .min(1)
          .max(20)
          .describe("At least one ad group is required."),
        negativeKeywords: z
          .array(googleNegativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Campaign-level negative keywords applying to all ad groups. Omit when none are needed."),
      },
    },
    async (params) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Creating campaigns requires the team admin role.");
      }

      let input;

      try {
        input = validateGoogleAdsCreateCampaignInput(params);
      } catch (err: any) {
        return textResult(`Invalid campaign input: ${err.message}`);
      }

      try {
        const campaign = await createGoogleAdsCampaignFull(ctx.creds, input);

        return jsonResult({ campaign });
      } catch (err) {
        return googleAdsError("create_google_ads_campaign", err);
      }
    },
    { summarize: summarizeGoogleCreateCampaign },
  );

  registerMutatingTool(
    server,
    userId,
    "update_google_ads_campaign_status",
    {
      description:
        "Publish or pause a Google Ads campaign by setting its status to ENABLED or PAUSED. " +
        "Use ENABLED to publish a paused campaign so it starts spending. Requires team admin rights. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .describe("ENABLED publishes the campaign (it starts spending); PAUSED pauses it."),
      },
    },
    async ({ campaignId, status }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Publishing campaigns requires the team admin role.");
      }

      const previous = await previousGoogleCampaign(ctx.creds, campaignId);
      try {
        const campaign = await updateGoogleAdsCampaignStatus(ctx.creds, campaignId, status);

        return jsonResult({ campaign, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("update_google_ads_campaign_status", err);
      }
    },
    { summarize: summarizeGoogleCampaignStatus },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_google_ads_campaign",
    {
      description:
        "Permanently delete a Google Ads campaign with all its ad groups and keywords. " +
        "This cannot be undone — prefer update_google_ads_campaign_status with PAUSED when the campaign might be needed again. " +
        "Requires team admin rights. Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
      },
    },
    async ({ campaignId }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting campaigns requires the team admin role.");
      }

      const previous = await previousGoogleCampaign(ctx.creds, campaignId);
      try {
        const campaign = await deleteGoogleAdsCampaign(ctx.creds, campaignId);

        return jsonResult({ campaign, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("delete_google_ads_campaign", err);
      }
    },
    { summarize: summarizeGoogleDeleteCampaign },
  );

  registerMutatingTool(
    server,
    userId,
    "update_google_ads_campaign",
    {
      description:
        "Update a Google Ads campaign: daily budget, status, name, start/end date. " +
        "Requires team admin rights. Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        name: z.string().optional().describe("New campaign name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New campaign status."),
        dailyBudgetAmount: z.number().positive().optional().describe("New daily budget in the account currency."),
        startDate: z.string().optional().describe("New start date, YYYY-MM-DD."),
        endDate: z.string().optional().describe("New end date, YYYY-MM-DD."),
      },
    },
    async ({ campaignId, name, status, dailyBudgetAmount, startDate, endDate }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating campaigns requires the team admin role.");
      }

      const previous = await previousGoogleCampaign(ctx.creds, campaignId);
      try {
        const campaign = await updateGoogleAdsCampaign(ctx.creds, campaignId, {
          name,
          status,
          dailyBudgetAmount,
          startDate,
          endDate,
        });

        return jsonResult({ campaign, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("update_google_ads_campaign", err);
      }
    },
    { summarize: summarizeGoogleUpdateCampaign },
  );

  registerMutatingTool(
    server,
    userId,
    "set_google_ads_campaign_targeting",
    {
      description:
        "Replace geo and/or language targeting of a Google Ads campaign. " +
        "Each given list fully replaces that dimension (omit a dimension to leave it untouched, pass an empty array to clear it). " +
        "Requires team admin rights. Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        locationIds: z
          .array(z.string().regex(/^\d+$/))
          .optional()
          .describe("Geo target IDs, e.g. ['2276'] for Germany, ['2040'] Austria, ['2756'] Switzerland."),
        languageIds: z
          .array(z.string().regex(/^\d+$/))
          .optional()
          .describe("Language IDs, e.g. ['1002'] German, ['1001'] English."),
      },
    },
    async ({ campaignId, locationIds, languageIds }) => {
      const ctx = await getGoogleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating campaign targeting requires the team admin role.");
      }
      if (locationIds === undefined && languageIds === undefined) {
        return textResult("Pass locationIds and/or languageIds.");
      }

      const previous = await previousGoogleCampaignTargeting(ctx.creds, campaignId);
      try {
        const targeting = await replaceGoogleAdsCampaignTargeting(ctx.creds, campaignId, {
          locationIds,
          languageIds,
        });

        return jsonResult({ campaignId, targeting, previous: previous ?? null });
      } catch (err) {
        return googleAdsError("set_google_ads_campaign_targeting", err);
      }
    },
    { summarize: summarizeGoogleCampaignTargeting },
  );
}
