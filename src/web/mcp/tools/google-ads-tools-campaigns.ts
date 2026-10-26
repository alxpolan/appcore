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
import { parseCtParam, withCtParam } from "../../../services/utils/google-ads-mapping";
import { upsertGoogleAdsAppleMapping } from "./google-ads-tools-apple-mapping";
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
        "Create a Google Ads Search campaign with ad groups, keywords, negative keywords, geo/language targeting, " +
        "ad schedule, device bid adjustments, ad extensions (sitelinks/callouts/structured snippets/call) " +
        "and responsive search ads via the Google Ads API. " +
        "The campaign starts PAUSED by default so it can be reviewed in Google Ads before it spends money — " +
        "pass status ENABLED only when the user explicitly asks to run it immediately, " +
        "or publish it later with update_google_ads_campaign_status. " +
        "Requires team admin rights. " +
        "Campaign-level negativeKeywords apply to the whole campaign; per-ad-group negativeKeywords apply to that ad group only. " +
        "Pass locationIds (e.g. ['2276'] Germany) or the campaign serves worldwide; location targeting only reaches " +
        "people physically present in those locations, never people merely searching about or interested in them. " +
        "Pass ctToken to append it as ct param to all ad final URLs; with appleBundleId the Apple mapping is linked automatically.",
      inputSchema: {
        name: z.string().describe("Campaign name, e.g. 'MyApp - US - Brand'."),
        dailyBudgetAmount: z.number().positive().describe("Daily budget in the account currency, e.g. 50."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .default("PAUSED")
          .describe("PAUSED (default, recommended) or ENABLED to run immediately."),
        startDate: z.string().optional().describe("Start date, YYYY-MM-DD. Defaults to today when omitted."),
        endDate: z.string().optional().describe("Optional end date, YYYY-MM-DD."),
        biddingStrategy: z
          .enum(["MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "TARGET_ROAS"])
          .optional()
          .describe(
            "MANUAL_CPC (default, needs bids), MAXIMIZE_CLICKS, MAXIMIZE_CONVERSIONS (optionally with targetCpa), " +
              "TARGET_CPA (requires targetCpa), or TARGET_ROAS (requires targetRoas). " +
              "The target-based strategies need conversion tracking set up on the account to work well.",
          ),
        cpcBidCeiling: z
          .number()
          .positive()
          .optional()
          .describe("Max CPC cap. Valid with MAXIMIZE_CLICKS, MAXIMIZE_CONVERSIONS, TARGET_CPA or TARGET_ROAS."),
        targetCpa: z
          .number()
          .positive()
          .optional()
          .describe("Target cost per acquisition in the account currency. Required for TARGET_CPA."),
        targetRoas: z
          .number()
          .positive()
          .optional()
          .describe("Target return on ad spend as a percent, e.g. 300 for 300%. Required for TARGET_ROAS."),
        locationIds: z
          .array(z.string().regex(/^\d+$/))
          .optional()
          .describe("Geo target IDs, e.g. ['2276'] Germany, ['2040'] Austria. Omit only for worldwide campaigns."),
        languageIds: z
          .array(z.string().regex(/^\d+$/))
          .optional()
          .describe("Language IDs, e.g. ['1001'] German, ['1000'] English."),
        adSchedule: z
          .array(
            z.object({
              dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]),
              startHour: z.number().int().min(0).max(24).describe("0-24."),
              startMinute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]).optional(),
              endHour: z.number().int().min(0).max(24).describe("0-24, after startHour."),
              endMinute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]).optional(),
            }),
          )
          .optional()
          .describe("Day/time windows the ads may show in. Omit to run all the time."),
        deviceBidAdjustments: z
          .object({
            mobile: z.number().min(-90).max(900).optional(),
            desktop: z.number().min(-90).max(900).optional(),
            tablet: z.number().min(-90).max(900).optional(),
          })
          .optional()
          .describe("Per-device bid adjustment as a percent, e.g. -50 or 20. Range -90 to 900."),
        sitelinks: z
          .array(
            z.object({
              linkText: z.string().max(25).describe("Max 25 characters."),
              finalUrl: z.string().describe("Destination URL for this sitelink."),
              description1: z.string().max(35).optional().describe("Max 35 characters."),
              description2: z.string().max(35).optional().describe("Max 35 characters."),
            }),
          )
          .optional()
          .describe("Sitelink extensions shown below the ad."),
        callouts: z
          .array(z.string().max(25))
          .optional()
          .describe("Callout extension texts, max 25 characters each, e.g. 'Free Shipping'."),
        structuredSnippets: z
          .array(
            z.object({
              header: z.string().describe("A Google-defined header such as 'Brands', 'Styles', or 'Types'."),
              values: z.array(z.string().max(25)).min(1).describe("Max 25 characters each."),
            }),
          )
          .optional()
          .describe("Structured snippet extensions."),
        calls: z
          .array(
            z.object({
              phoneNumber: z.string().describe("Phone number including country dialing code."),
              countryCode: z.string().length(2).describe("2-letter ISO country code, e.g. 'US'."),
            }),
          )
          .optional()
          .describe("Call extensions."),
        ctToken: z
          .string()
          .optional()
          .describe("App Store campaign token appended as ct param to all ad final URLs missing one."),
        appleBundleId: z
          .string()
          .optional()
          .describe("App bundle ID to link the ct token for Apple-measured revenue (needs ctToken or ct in final URLs)."),
        adGroups: z
          .array(
            z.object({
              name: z.string().describe("Ad group name, e.g. 'Brand Exact'."),
              defaultBidAmount: z
                .number()
                .positive()
                .optional()
                .describe("Default max CPC bid (required for MANUAL_CPC, ignored for MAXIMIZE_CLICKS)."),
              keywords: z
                .array(
                  googleTargetingKeywordSchema.extend({
                    bidAmount: z.number().positive().optional().describe("Keyword-level max CPC bid."),
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
              ads: z
                .array(
                  z.object({
                    headlines: z.array(z.string()).min(3).max(15).describe("3-15 headlines, max 30 chars each."),
                    descriptions: z.array(z.string()).min(2).max(4).describe("2-4 descriptions, max 90 chars each."),
                    finalUrl: z.string().describe("Final URL, e.g. an App Store campaign link."),
                    path1: z.string().max(15).optional(),
                    path2: z.string().max(15).optional(),
                    status: z.enum(["ENABLED", "PAUSED"]).optional().describe("Defaults to PAUSED."),
                  }),
                )
                .max(10)
                .optional()
                .describe("Responsive search ads for this ad group, e.g. translated per language."),
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

      const token = String(params.ctToken ?? "").trim() || null;
      const groups = Array.isArray(params.adGroups) ? params.adGroups : [];
      if (token) {
        for (const g of groups) {
          for (const ad of g?.ads ?? []) {
            if (ad?.finalUrl) ad.finalUrl = withCtParam(String(ad.finalUrl), token);
          }
        }
      }

      let input;

      try {
        input = validateGoogleAdsCreateCampaignInput(params);
      } catch (err: any) {
        return textResult(`Invalid campaign input: ${err.message}`);
      }

      try {
        const campaign = await createGoogleAdsCampaignFull(ctx.creds, input);
        let appleMapping: { bundleId: string; ctToken: string } | null = null;
        const bundleId = String(params.appleBundleId ?? "").trim();
        if (bundleId) {
          const fromUrls = new Set<string>();
          for (const g of groups) {
            for (const ad of g?.ads ?? []) {
              const ct = ad?.finalUrl ? parseCtParam(String(ad.finalUrl)) : null;
              if (ct) fromUrls.add(ct);
            }
          }
          const effective = token ?? (fromUrls.size === 1 ? [...fromUrls][0] : null);
          if (effective) {
            const mapping = await upsertGoogleAdsAppleMapping(ctx.teamId, campaign.id, bundleId, effective);
            if (mapping) appleMapping = { bundleId, ctToken: mapping.ctToken };
          }
        }

        return jsonResult({ campaign, appleMapping });
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
        "Update a Google Ads campaign: daily budget, status, name, start/end date, Display Network, " +
        "and geo targeting type. Requires team admin rights. Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        name: z.string().optional().describe("New campaign name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New campaign status."),
        dailyBudgetAmount: z.number().positive().optional().describe("New daily budget in the account currency."),
        startDate: z.string().optional().describe("New start date, YYYY-MM-DD."),
        endDate: z.string().optional().describe("New end date, YYYY-MM-DD."),
        displayNetworkEnabled: z
          .boolean()
          .optional()
          .describe("Whether the campaign may also serve on the Display Network. Defaults to off on creation."),
        presenceOnlyTargeting: z
          .boolean()
          .optional()
          .describe(
            "When true, only targets people physically located in the chosen locations, not people merely " +
              "searching about or interested in them.",
          ),
      },
    },
    async ({
      campaignId,
      name,
      status,
      dailyBudgetAmount,
      startDate,
      endDate,
      displayNetworkEnabled,
      presenceOnlyTargeting,
    }) => {
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
          displayNetworkEnabled,
          presenceOnlyTargeting,
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
          .describe("Language IDs, e.g. ['1001'] German, ['1000'] English."),
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
