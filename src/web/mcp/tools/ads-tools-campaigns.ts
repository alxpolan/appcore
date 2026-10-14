import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  createAppleAdsCampaignFull,
  deleteAppleAdsCampaign,
  getAppleAdsCampaignCountryBreakdown,
  getAppleAdsCampaignDetail,
  getAppleAdsDailyStats,
  getAppleAdsKeywordCountryBreakdown,
  listAppleAdsCampaigns,
  resolveAppleAdsRange,
  resolveAppOrgByAdamId,
  updateAppleAdsCampaign,
  updateAppleAdsCampaignStatus,
  validateCreateCampaignInput,
} from "../../../services/apple-ads";
import { getAppleAdsCampaignRevenue, mergeCountryRevenue } from "../../../services/apple-ads-revenue";
import { isTeamAdmin, jsonResult, textResult } from "./shared";
import {
  adsError,
  getAppleAdsContext,
  getCampaignAppleAdsContext,
  getMcpRevenueApps,
  negativeKeywordSchema,
  rangeSchema,
  registerAdsMutatingTool,
  registerAdsReadTool,
} from "./ads-tools-shared";
import {
  previousCampaign,
  summarizeCampaignStatus,
  summarizeCreateCampaign,
  summarizeDeleteCampaign,
  summarizeUpdateCampaign,
} from "./ads-tools-summaries";

export function registerAppleAdsCampaignTools(server: McpServer, userId: string) {
  registerAdsReadTool(
    server,
    userId,
    "list_ads_campaigns",
    {
      description:
        "List Apple Search Ads campaigns with spend and performance stats (impressions, taps, installs, TTR, avg CPT/CPA, conversion rate) for a date range. " +
        "Call this to discover campaign IDs before using the campaign-scoped tools.",
      inputSchema: { ...rangeSchema },
    },
    async ({ days, period, startDate, endDate }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (ctx.orgIds.length === 0) {
        return textResult("No campaign group is mapped to any app yet — map one per app in Marteso Integrations.");
      }

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const lists = await Promise.all(
          ctx.orgIds.map((orgId) => listAppleAdsCampaigns({ ...ctx.keyCreds, orgId }, range)),
        );

        const campaigns = lists
          .flat()
          .map((c) => ({ ...c, orgName: ctx.orgNameById.get(c.orgId) ?? c.orgId }));

        return jsonResult({ range, campaigns });
      } catch (err) {
        return adsError("list_ads_campaigns", err);
      }
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_detail",
    {
      description:
        "Get ad groups with keywords, bids and performance stats for one Apple Search Ads campaign. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const adGroups = await getAppleAdsCampaignDetail(ctx.creds, campaignId, range);

        return jsonResult({ range, campaignId, adGroups });
      } catch (err) {
        return adsError("get_ads_campaign_detail", err);
      }
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_daily_spend",
    {
      description:
        "Get daily spend, impressions, taps and installs for one Apple Search Ads campaign as a date series. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const daysSeries = await getAppleAdsDailyStats(ctx.creds, range, campaignId);

        return jsonResult({ range, campaignId, days: daysSeries });
      } catch (err) {
        return adsError("get_ads_campaign_daily_spend", err);
      }
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_country_breakdown",
    {
      description:
        "Get per-country performance for one Apple Search Ads campaign: spend, impressions, taps, TTR, " +
        "installs, average CPT/CPA and conversion rate broken out by countryOrRegion, plus attributed " +
        "RevenueCat trials and proceeds (USD) per country when RevenueCat is connected. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const [apple, revenue] = await Promise.all([
          getAppleAdsCampaignCountryBreakdown(ctx.creds, campaignId, range),
          getAppleAdsCampaignRevenue(accessibleApps, ctx.orgIds, range),
        ]);

        const countries = mergeCountryRevenue(apple, revenue.byCampaign[campaignId]?.byCountry);

        return jsonResult({ range, campaignId, revenueAvailable: accessibleApps.length > 0, countries });
      } catch (err) {
        return adsError("get_ads_campaign_country_breakdown", err);
      }
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_keyword_country_breakdown",
    {
      description:
        "Get per-country performance for one targeting keyword in an Apple Search Ads ad group: spend, " +
        "impressions, taps, TTR, installs and conversion rate broken out by countryOrRegion, plus attributed " +
        "RevenueCat trials and proceeds (USD) per country when RevenueCat is connected. " +
        "Use get_ads_campaign_detail first to find campaign, ad group and keyword IDs.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        keywordId: z.string().describe("Keyword ID (numeric string)."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, adGroupId, keywordId, days, period, startDate, endDate }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const [apple, revenue] = await Promise.all([
          getAppleAdsKeywordCountryBreakdown(ctx.creds, campaignId, adGroupId, keywordId, range),
          getAppleAdsCampaignRevenue(accessibleApps, ctx.orgIds, range),
        ]);

        const keywordBucket = revenue.byCampaign[campaignId]?.byKeyword[keywordId];
        const countries = mergeCountryRevenue(apple, keywordBucket?.byCountry);

        return jsonResult({
          range,
          campaignId,
          adGroupId,
          keywordId,
          revenueAvailable: accessibleApps.length > 0,
          countries,
        });
      } catch (err) {
        return adsError("get_ads_keyword_country_breakdown", err);
      }
    },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "create_ads_campaign",
    {
      description:
        "Create an Apple Search Ads campaign with ad groups, keywords and negative keywords via the Apple Search Ads API. " +
        "The campaign starts PAUSED by default so it can be reviewed in Search Ads before it spends money — " +
        "pass status ENABLED only when the user explicitly asks to run it immediately, " +
        "or publish it later with update_ads_campaign_status. " +
        "Requires team admin rights. Keywords only take effect for the APPSTORE_SEARCH_RESULTS placement. " +
        "Campaign-level negativeKeywords apply to the whole campaign; per-ad-group negativeKeywords apply to that ad group only.",
      inputSchema: {
        name: z.string().describe("Campaign name, e.g. 'MyApp - US - Brand'."),
        adamId: z
          .number()
          .int()
          .positive()
          .describe("Numeric App Store app ID of the advertised app (NOT the bundle ID)."),
        countriesOrRegions: z
          .array(z.string())
          .min(1)
          .describe("Target countries as two-letter codes, e.g. ['US', 'DE']."),
        dailyBudgetAmount: z.number().positive().describe("Daily budget in the given currency, e.g. 50."),
        budgetAmount: z.number().positive().optional().describe("Optional lifetime budget cap in the given currency."),
        currency: z.string().default("USD").describe("Three-letter currency code, e.g. USD, EUR."),
        supplySources: z
          .array(
            z.enum(["APPSTORE_SEARCH_RESULTS", "APPSTORE_SEARCH_TAB", "APPSTORE_TODAY_TAB", "APPSTORE_PRODUCT_PAGE"]),
          )
          .min(1)
          .default(["APPSTORE_SEARCH_RESULTS"])
          .describe("Ad placements. Search Results is the default."),
        pricingModel: z
          .enum(["CPC", "CPM"])
          .default("CPC")
          .describe("CPC (cost per tap) for Search Results; CPM for Search Tab / Today Tab placements."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .default("PAUSED")
          .describe("PAUSED (default, recommended) or ENABLED to run immediately."),
        startTime: z.string().optional().describe("Start date, YYYY-MM-DD. Defaults to today when omitted."),
        adGroups: z
          .array(
            z.object({
              name: z.string().describe("Ad group name, e.g. 'Brand Exact'."),
              defaultBidAmount: z
                .number()
                .positive()
                .describe("Default bid per tap (CPC) or per 1k impressions (CPM)."),
              cpaGoal: z.number().positive().optional().describe("Optional target cost per acquisition."),
              keywords: z
                .array(
                  z.object({
                    text: z.string().describe("Keyword text, e.g. 'meditation app'."),
                    matchType: z.enum(["EXACT", "BROAD"]).describe("EXACT for precise matches, BROAD for discovery."),
                    bidAmount: z
                      .number()
                      .positive()
                      .optional()
                      .describe("Keyword-level bid. Falls back to the ad group default bid when omitted."),
                  }),
                )
                .max(500)
                .optional()
                .describe(
                  "Keywords for this ad group (Search Results placements only). Omit for Search Match / tab placements.",
                ),
              negativeKeywords: z
                .array(negativeKeywordSchema)
                .max(500)
                .optional()
                .describe("Negative keywords for this ad group only. Omit when none are needed."),
            }),
          )
          .min(1)
          .max(20)
          .describe("At least one ad group is required."),
        negativeKeywords: z
          .array(negativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Campaign-level negative keywords applying to all ad groups. Omit when none are needed."),
      },
    },
    async (params) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Creating campaigns requires the team admin role.");
      }

      let input;

      try {
        input = validateCreateCampaignInput(params);
      } catch (err: any) {
        return textResult(`Invalid campaign input: ${err.message}`);
      }

      const mapping = await resolveAppOrgByAdamId(ctx.teamId, input.adamId);

      if (!mapping) {
        return textResult("No campaign group mapped for the advertised app — map one in Marteso Integrations.");
      }

      try {
        const campaign = await createAppleAdsCampaignFull({ ...ctx.keyCreds, orgId: mapping.orgId }, input);

        return jsonResult({ campaign, orgId: mapping.orgId });
      } catch (err) {
        return adsError("create_ads_campaign", err);
      }
    },
    { summarize: summarizeCreateCampaign },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "update_ads_campaign_status",
    {
      description:
        "Publish or pause an Apple Search Ads campaign by setting its status to ENABLED or PAUSED. " +
        "Use ENABLED to publish a paused campaign so it starts spending. Requires team admin rights. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .describe("ENABLED publishes the campaign (it starts spending); PAUSED pauses it."),
      },
    },
    async ({ campaignId, status }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Publishing campaigns requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      const previous = await previousCampaign(ctx.creds, campaignId);
      try {
        const campaign = await updateAppleAdsCampaignStatus(ctx.creds, campaignId, status);

        return jsonResult({ campaign, previous: previous ?? null });
      } catch (err) {
        return adsError("update_ads_campaign_status", err);
      }
    },
    { summarize: summarizeCampaignStatus },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "delete_ads_campaign",
    {
      description:
        "Permanently delete an Apple Search Ads campaign with all its ad groups and keywords. " +
        "This cannot be undone — prefer update_ads_campaign_status with PAUSED when the campaign might be needed again. " +
        "Only delete when the user explicitly asks for deletion. Requires team admin rights. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
      },
    },
    async ({ campaignId }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Deleting campaigns requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      const previous = await previousCampaign(ctx.creds, campaignId);
      try {
        const campaign = await deleteAppleAdsCampaign(ctx.creds, campaignId);

        return jsonResult({ campaign, previous: previous ? { name: previous.name } : null });
      } catch (err) {
        return adsError("delete_ads_campaign", err);
      }
    },
    { summarize: summarizeDeleteCampaign },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "update_ads_campaign",
    {
      description:
        "Update an Apple Search Ads campaign: daily budget, status, name and/or countries. " +
        "Only the passed fields change. Apple's API does not allow changing the lifetime budget after creation. " +
        "Requires team admin rights. Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        name: z.string().optional().describe("New campaign name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("ENABLED runs the campaign, PAUSED pauses it."),
        dailyBudgetAmount: z.number().positive().optional().describe("New daily budget, e.g. 50."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when setting dailyBudgetAmount."),
        countriesOrRegions: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("New target countries as two-letter codes, e.g. ['US', 'DE']. Replaces the current list."),
      },
    },
    async ({ campaignId, name, status, dailyBudgetAmount, currency, countriesOrRegions }) => {
      const base = await getAppleAdsContext(userId);
      if ("error" in base) return textResult(base.error);

      if (!(await isTeamAdmin(userId, base.teamId))) {
        return textResult("Updating campaigns requires the team admin role.");
      }

      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);
      const previous = await previousCampaign(ctx.creds, campaignId);
      try {
        const campaign = await updateAppleAdsCampaign(ctx.creds, campaignId, {
          name,
          status,
          dailyBudgetAmount,
          currency,
          countriesOrRegions,
        });

        return jsonResult({ campaign, previous: previous ?? null });
      } catch (err: any) {
        if (err?.response == null) return textResult(`Invalid campaign update: ${err.message}`);

        return adsError("update_ads_campaign", err);
      }
    },
    { summarize: summarizeUpdateCampaign },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_revenue",
    {
      description:
        "Get RevenueCat proceeds (USD) attributed to Apple Search Ads campaigns via Apple attribution, " +
        "grouped by campaign and keyword with individual transactions. " +
        "Open trials carry potentialProceedsUsd (avg paid proceeds of their product); trial conversions attribute " +
        "their proceeds back to the trial-start day (cohortDate). " +
        "Use list_ads_campaigns first to find campaign IDs.",
      inputSchema: {
        campaignId: z
          .string()
          .optional()
          .describe("Restrict the result to one campaign ID. Returns all attributed campaigns if omitted."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const { byCampaign } = await getAppleAdsCampaignRevenue(accessibleApps, ctx.orgIds, range);

        if (campaignId) {
          const bucket = byCampaign[campaignId] ?? { proceedsUsd: 0, transactions: [], byKeyword: {}, byCountry: {} };

          return jsonResult({ range, campaignId, ...bucket });
        }

        return jsonResult({ range, byCampaign });
      } catch (err) {
        return adsError("get_ads_campaign_revenue", err);
      }
    },
  );
}
