import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { resolveAppleAdsRange } from "../../../services/apple-ads";
import {
  getAppleAdsCampaignRevenue,
  type AppleAdsCampaignRevenueMap,
  type AppleAdsRevenueBucket,
} from "../../../services/apple-ads-revenue";
import { jsonResult, textResult } from "./shared";
import { adsError, getAppleAdsContext, getMcpRevenueApps, rangeSchema, registerAdsReadTool } from "./ads-tools-shared";

const MAX_DETAILED_TRANSACTIONS = 200;
const EMPTY_BUCKET: AppleAdsRevenueBucket = { proceedsUsd: 0, transactions: [], byCountry: {} };

function formatBucket(bucket: AppleAdsRevenueBucket, format: "concise" | "detailed") {
  const transactionCount = bucket.transactions.length;

  if (format === "concise") {
    return { proceedsUsd: bucket.proceedsUsd, transactionCount, byCountry: bucket.byCountry };
  }

  const sorted = [...bucket.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const transactions = sorted.slice(0, MAX_DETAILED_TRANSACTIONS);

  return {
    proceedsUsd: bucket.proceedsUsd,
    transactionCount,
    transactions,
    truncated: transactions.length < transactionCount,
    byCountry: bucket.byCountry,
  };
}

function formatCampaignBucket(bucket: AppleAdsCampaignRevenueMap[string], format: "concise" | "detailed") {
  const byKeyword = Object.fromEntries(
    Object.entries(bucket.byKeyword).map(([keywordId, kwBucket]) => [keywordId, formatBucket(kwBucket, format)]),
  );

  return { ...formatBucket(bucket, format), byKeyword };
}

export function registerAppleAdsRevenueTools(server: McpServer, userId: string) {
  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_revenue",
    {
      description:
        "Get RevenueCat proceeds (USD) attributed to Apple Search Ads campaigns via Apple attribution, " +
        "grouped by campaign and keyword. " +
        "Open trials carry potentialProceedsUsd (avg paid proceeds of their product); trial conversions attribute " +
        "their proceeds back to the trial-start day (cohortDate). " +
        "Use list_ads_campaigns first to find campaign IDs.",
      inputSchema: {
        campaignId: z
          .string()
          .optional()
          .describe("Restrict the result to one campaign ID. Returns all attributed campaigns if omitted."),
        response_format: z
          .enum(["concise", "detailed"])
          .optional()
          .describe(
            "'concise' (default) returns only proceeds totals and transaction counts, no individual transactions. " +
              `'detailed' adds the individual transactions too, newest first, capped at ${MAX_DETAILED_TRANSACTIONS} ` +
              "per campaign/keyword (see the 'truncated' flag).",
          ),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, period, startDate, endDate, response_format }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      const format = response_format ?? "concise";

      try {
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const { byCampaign } = await getAppleAdsCampaignRevenue(accessibleApps, ctx.orgIds, range);

        if (campaignId) {
          const bucket = byCampaign[campaignId] ?? { ...EMPTY_BUCKET, byKeyword: {} };

          return jsonResult({ range, campaignId, ...formatCampaignBucket(bucket, format) });
        }

        const formatted = Object.fromEntries(
          Object.entries(byCampaign).map(([id, bucket]) => [id, formatCampaignBucket(bucket, format)]),
        );

        return jsonResult({ range, byCampaign: formatted });
      } catch (err) {
        return adsError("get_ads_campaign_revenue", err);
      }
    },
  );
}
