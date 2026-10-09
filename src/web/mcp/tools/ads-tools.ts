import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// The SDK's schema types are keyed to the zod/v3 subpath — importing z from
// anywhere else fails assignability under node10 module resolution.
import { z } from "zod/v3";
import { logger, prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import {
  createAppleAdsCampaignFull,
  createAppleAdsNegativeKeywordsBulk,
  deleteAppleAdsNegativeKeywordsBulk,
  getAppleAdsCampaignDailySpend,
  getAppleAdsCampaignDetail,
  listAppleAdsAdGroups,
  listAppleAdsCampaigns,
  listAppleAdsNegativeKeywords,
  resolveAppleAdsRange,
  validateCreateCampaignInput,
  type AppleAdsCredentials,
} from "../../../services/apple-ads";
import { getAppleAdsCampaignRevenue } from "../../../services/apple-ads-revenue";
import { getMcpAllowedAppIds, getMcpUserTeamId } from "./shared";

const rangeSchema = {
  days: z
    .number()
    .int()
    .min(1)
    .max(730)
    .optional()
    .describe("Evaluate the last N days (e.g. 7, 30). Defaults to 30 when no range is given."),
  period: z
    .enum(["ytd", "all"])
    .optional()
    .describe("'ytd' for year-to-date, 'all' for the last 365 days (Apple reporting has no unbounded window)."),
  startDate: z
    .string()
    .optional()
    .describe("Explicit range start, YYYY-MM-DD (e.g. the day of an app update). Overrides days/period."),
  endDate: z.string().optional().describe("Explicit range end, YYYY-MM-DD. Defaults to today."),
};

const negativeKeywordSchema = z.object({
  text: z.string().describe("Negative keyword text, e.g. 'free'."),
  matchType: z.enum(["EXACT", "BROAD"]).describe("EXACT blocks the precise term, BROAD blocks close variants."),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

async function getAppleAdsContext(
  userId: string,
): Promise<{ teamId: string; orgId: string; creds: AppleAdsCredentials } | { error: string }> {
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return { error: "No team found for this user." };
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });
  if (
    !settings?.appleAdsConnectedAt ||
    !settings.appleAdsOrgId ||
    !settings.appleAdsClientId ||
    !settings.appleAdsTeamId ||
    !settings.appleAdsKeyId ||
    !settings.appleAdsPrivateKey
  ) {
    return { error: "Apple Search Ads is not connected. Connect it in Marteso Integrations first." };
  }
  const privateKey = decryptNullable(settings.appleAdsPrivateKey);
  if (!privateKey) {
    return { error: "Apple Search Ads credentials are unreadable. Reconnect them in Marteso Integrations." };
  }
  return {
    teamId,
    orgId: settings.appleAdsOrgId,
    creds: {
      orgId: settings.appleAdsOrgId,
      clientId: settings.appleAdsClientId,
      teamId: settings.appleAdsTeamId,
      keyId: settings.appleAdsKeyId,
      privateKey,
    },
  };
}

function adsError(tool: string, err: unknown) {
  logger.error(`[mcp] ${tool} error`, { err: String((err as any)?.message ?? err) });
  const detail = (err as any)?.response?.data ? `: ${JSON.stringify((err as any).response.data)}` : "";
  return textResult(`Apple Search Ads request failed${detail || `: ${String((err as any)?.message ?? err)}`}`);
}

/** Mirrors requireTeamAdmin: creating campaigns can spend real money. */
async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "ADMIN") return true;
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true },
  });
  return member?.role === "OWNER" || member?.role === "ADMIN";
}

export function registerAdsTools(server: McpServer, userId: string) {
  server.registerTool(
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
      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const campaigns = await listAppleAdsCampaigns(ctx.creds, range);
        return jsonResult({ range, campaigns });
      } catch (err) {
        return adsError("list_ads_campaigns", err);
      }
    },
  );

  server.registerTool(
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
      const ctx = await getAppleAdsContext(userId);
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

  server.registerTool(
    "get_ads_campaign_daily_spend",
    {
      description:
        "Get daily ad spend for one Apple Search Ads campaign as a date series. " +
        "Use list_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const daysSeries = await getAppleAdsCampaignDailySpend(ctx.creds, campaignId, range);
        return jsonResult({ range, campaignId, days: daysSeries });
      } catch (err) {
        return adsError("get_ads_campaign_daily_spend", err);
      }
    },
  );

  server.registerTool(
    "create_ads_campaign",
    {
      description:
        "Create an Apple Search Ads campaign with ad groups, keywords and negative keywords via the Apple Search Ads API. " +
        "The campaign starts PAUSED by default so it can be reviewed in Search Ads before it spends money — " +
        "pass status ENABLED only when the user explicitly asks to run it immediately. " +
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
        budgetAmount: z
          .number()
          .positive()
          .optional()
          .describe("Optional lifetime budget cap in the given currency."),
        currency: z.string().default("USD").describe("Three-letter currency code, e.g. USD, EUR."),
        supplySources: z
          .array(
            z.enum([
              "APPSTORE_SEARCH_RESULTS",
              "APPSTORE_SEARCH_TAB",
              "APPSTORE_TODAY_TAB",
              "APPSTORE_PRODUCT_PAGE",
            ]),
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
        startTime: z
          .string()
          .optional()
          .describe("Start date, YYYY-MM-DD. Defaults to today when omitted."),
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
      try {
        const campaign = await createAppleAdsCampaignFull(ctx.creds, input);
        return jsonResult({ campaign });
      } catch (err) {
        return adsError("create_ads_campaign", err);
      }
    },
  );

  server.registerTool(
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
      const ctx = await getAppleAdsContext(userId);
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

  server.registerTool(
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
        add: z
          .array(negativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Negative keywords to add."),
        removeIds: z
          .array(z.string())
          .max(500)
          .optional()
          .describe("IDs of negative keywords to delete."),
      },
    },
    async ({ campaignId, adGroupId, add, removeIds }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Editing negative keywords requires the team admin role.");
      }
      if ((!add || add.length === 0) && (!removeIds || removeIds.length === 0)) {
        return textResult("Nothing to do: pass add and/or removeIds.");
      }
      try {
        const added = await createAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroupId ?? null, add ?? []);
        const removed = await deleteAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroupId ?? null, removeIds ?? []);
        return jsonResult({ campaignId, adGroupId: adGroupId ?? null, added, removed });
      } catch (err) {
        return adsError("update_ads_negative_keywords", err);
      }
    },
  );

  server.registerTool(
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
        const apps = await prisma.app.findMany({
          where: { teamId: ctx.teamId, revenueCatConnectedAt: { not: null } },
          select: { id: true, bundleId: true, displayName: true, name: true },
        });
        const allowedAppIds = await getMcpAllowedAppIds(userId, ctx.teamId);
        const accessibleApps = allowedAppIds ? apps.filter((app) => allowedAppIds.includes(app.id)) : apps;
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const { byCampaign } = await getAppleAdsCampaignRevenue(accessibleApps, ctx.orgId, range);
        if (campaignId) {
          const bucket = byCampaign[campaignId] ?? { proceedsUsd: 0, transactions: [], byKeyword: {} };
          return jsonResult({ range, campaignId, ...bucket });
        }
        return jsonResult({ range, byCampaign });
      } catch (err) {
        return adsError("get_ads_campaign_revenue", err);
      }
    },
  );
}
