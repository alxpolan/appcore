import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { prisma } from "../../../config";
import { resolveGoogleAdsRange } from "../../../services/google-ads";
import { getMcpAllowedAppIds, getMcpUserTeamId, isTeamAdmin, jsonResult, registerMutatingTool, textResult, type ToolSummary } from "./shared";
import { googleAdsError, rangeSchema } from "./google-ads-tools-shared";
import { mergeCampaignDayMetrics } from "../../../services/utils/google-ads-mapping";

export async function upsertGoogleAdsAppleMapping(teamId: string, campaignId: string, bundleId: string, ctToken: string) {
  const app = await prisma.app.findFirst({ where: { bundleId, teamId }, select: { id: true } });
  if (!app) return null;

  return prisma.googleAdsCampaignToken.upsert({
    where: { teamId_googleCampaignId: { teamId, googleCampaignId: campaignId } },
    create: { teamId, googleCampaignId: campaignId, appId: app.id, ctToken: ctToken.trim() },
    update: { appId: app.id, ctToken: ctToken.trim() },
  });
}

export function registerGoogleAdsAppleMappingTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_google_ads_apple_revenue",
    {
      description:
        "Get Apple-measured downloads, trials and proceeds for one Google Ads campaign via its linked App Store " +
        "campaign token (ct). The campaign must be linked first with set_google_ads_apple_mapping. " +
        "Use list_google_ads_campaigns first to find the campaign ID.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, days, startDate, endDate }) => {
      const teamId = await getMcpUserTeamId(userId);
      if (!teamId) return textResult("No team found for this user.");

      try {
        const mapping = await prisma.googleAdsCampaignToken.findUnique({
          where: { teamId_googleCampaignId: { teamId, googleCampaignId: campaignId } },
          include: { app: { select: { id: true, bundleId: true, displayName: true, name: true } } },
        });

        if (!mapping) {
          return textResult(
            `Google Ads campaign ${campaignId} has no Apple campaign token linked. Use set_google_ads_apple_mapping first.`,
          );
        }

        const allowedAppIds = await getMcpAllowedAppIds(userId, teamId);

        if (allowedAppIds && !allowedAppIds.includes(mapping.appId)) {
          return textResult("App not found.");
        }

        const range = resolveGoogleAdsRange({ days, startDate, endDate });
        const end = new Date(`${range.endDate}T00:00:00Z`);

        end.setUTCDate(end.getUTCDate() + 1);
        const rows = await prisma.appStoreCampaignMetrics.findMany({
          where: {
            bundleId: mapping.app.bundleId,
            campaign: mapping.ctToken,
            reportDate: { gte: new Date(`${range.startDate}T00:00:00Z`), lt: end },
          },
          orderBy: { reportDate: "asc" },
        });

        const days = mergeCampaignDayMetrics(
          rows.map((r) => ({
            date: r.reportDate.toISOString().slice(0, 10),
            territory: r.territory,
            downloads: r.downloads,
            purchases: r.purchases,
            trials: r.trials,
            proceedsUsd: r.proceedsUsd,
          })),
        );

        const totals = days.reduce(
          (acc, d) => ({
            downloads: acc.downloads + d.downloads,
            purchases: acc.purchases + d.purchases,
            trials: acc.trials + d.trials,
            proceedsUsd: acc.proceedsUsd + d.proceedsUsd,
          }),
          { downloads: 0, purchases: 0, trials: 0, proceedsUsd: 0 },
        );

        const priceStart = new Date();

        priceStart.setUTCDate(priceStart.getUTCDate() - 90);
        priceStart.setUTCHours(0, 0, 0, 0);
        const priceSample = await prisma.revenueCatTransaction.aggregate({
          where: {
            bundleId: mapping.app.bundleId,
            occurredAt: { gte: priceStart },
            environment: "production",
            proceedsUsd: { gt: 0 },
          },
          _avg: { proceedsUsd: true },
        });

        const avgTrialValueUsd = Math.round((priceSample._avg.proceedsUsd ?? 0) * 100) / 100;

        return jsonResult({
          campaignId,
          app: mapping.app,
          ctToken: mapping.ctToken,
          range,
          totals,
          days,
          avgTrialValueUsd,
        });
      } catch (err) {
        return googleAdsError("get_google_ads_apple_revenue", err);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "set_google_ads_apple_mapping",
    {
      description:
        "Link a Google Ads campaign to an App Store campaign token (ct) for Apple-measured revenue. " +
        "Create the campaign link in App Store Connect Analytics Campaigns first, use it as the Google " +
        "campaign's final URL, then link its token here with the app's bundle ID. " +
        "Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
        bundleId: z.string().describe("App bundle ID, e.g. 'com.example.app'."),
        ctToken: z.string().describe("App Store campaign token (ct) from the campaign link."),
      },
    },
    async ({ campaignId, bundleId, ctToken }) => {
      const teamId = await getMcpUserTeamId(userId);
      if (!teamId) return textResult("No team found for this user.");

      if (!(await isTeamAdmin(userId, teamId))) {
        return textResult("Linking campaign tokens requires the team admin role.");
      }

      try {
        const mapping = await upsertGoogleAdsAppleMapping(teamId, campaignId, bundleId, ctToken);
        if (!mapping) return textResult(`App ${bundleId} not found on this team.`);

        return jsonResult({ campaignId, bundleId, ctToken: mapping.ctToken });
      } catch (err) {
        return googleAdsError("set_google_ads_apple_mapping", err);
      }
    },
    {
      summarize: (args: any): ToolSummary => ({
        summary: `Linked Apple campaign token "${args?.ctToken}" (${args?.bundleId}) to Google Ads campaign ${args?.campaignId}`,
        entityType: "google_ads_campaign",
        entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
      }),
    },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_google_ads_apple_mapping",
    {
      description:
        "Remove the App Store campaign token link from a Google Ads campaign. " +
        "Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Google Ads campaign ID (numeric string)."),
      },
    },
    async ({ campaignId }) => {
      const teamId = await getMcpUserTeamId(userId);
      if (!teamId) return textResult("No team found for this user.");

      if (!(await isTeamAdmin(userId, teamId))) {
        return textResult("Removing campaign token links requires the team admin role.");
      }

      try {
        await prisma.googleAdsCampaignToken.deleteMany({ where: { teamId, googleCampaignId: campaignId } });

        return jsonResult({ campaignId, deleted: true });
      } catch (err) {
        return googleAdsError("delete_google_ads_apple_mapping", err);
      }
    },
    {
      summarize: (args: any): ToolSummary => ({
        summary: `Removed Apple campaign token link from Google Ads campaign ${args?.campaignId}`,
        entityType: "google_ads_campaign",
        entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
      }),
    },
  );
}
