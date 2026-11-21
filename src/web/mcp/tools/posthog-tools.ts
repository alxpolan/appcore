import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@prisma/client";
import { z } from "zod/v3";
import { prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import { resolveAppleAdsRange } from "../../../services/apple-ads";
import { getAppleAdsCampaignCustomerIds } from "../../../services/apple-ads-revenue";
import { computeMilestoneCompletions, type MilestoneDefinition } from "../../../services/posthog-milestones";
import {
  appNotFoundWithListApps,
  getSettingsWithBundleId,
  jsonResult,
  mcpToolMessages,
  registerMutatingTool,
  textResult,
  verifyMcpAppAccess,
} from "./shared";
import { adsError, getCampaignAppleAdsContext, rangeSchema, registerAdsReadTool } from "./ads-tools-shared";

const unavailable = (reason: string) => jsonResult({ available: false, reason, totalInstalls: 0, milestones: [] });

export function registerPostHogTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "get_posthog_milestones",
    {
      description:
        "Get the PostHog engagement milestone thresholds configured for an app. Each milestone names a PostHog " +
        "event and the minimum number of times it must occur for a user to count as having reached it. " +
        "Use get_ads_campaign_milestones to see how many Apple Search Ads-attributed users completed each one, " +
        "for a whole campaign or narrowed to one ad group or keyword.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
      },
    },
    async ({ bundleId }: { bundleId?: string }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!resolvedBundleId) return textResult(mcpToolMessages.noBundleIdProvidedWithDefault);
      const app = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!app) return textResult(appNotFoundWithListApps(resolvedBundleId));
      const milestones = (app.postHogMilestones as MilestoneDefinition[] | null) ?? [];

      return jsonResult({ bundleId: resolvedBundleId, milestones });
    },
  );

  registerMutatingTool(
    server,
    userId,
    "set_posthog_milestones",
    {
      description:
        "Replace the PostHog engagement milestone thresholds for an app. Each milestone names a PostHog event, " +
        "a human-readable label, and the minimum occurrence count that counts as reaching it (e.g. eventName " +
        "'workout_completed', minCount 3, label 'Completed 3 workouts'). Pass the full list every time; it " +
        "replaces whatever was configured before. PostHog and RevenueCat must both be connected for " +
        "get_ads_campaign_milestones to report completions.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        milestones: z
          .array(
            z.object({
              eventName: z.string().min(1).describe("Exact PostHog event name, e.g. 'workout_completed'."),
              label: z.string().min(1).describe("Human-readable label, e.g. 'Completed 3 workouts'."),
              minCount: z.number().int().min(1).describe("Minimum occurrences of the event to count as reached."),
            }),
          )
          .describe("Full list of milestones. Replaces the previous configuration."),
      },
    },
    async ({ bundleId, milestones }: { bundleId?: string; milestones: MilestoneDefinition[] }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!resolvedBundleId) return textResult(mcpToolMessages.noBundleIdProvidedWithDefault);
      const app = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!app) return textResult(appNotFoundWithListApps(resolvedBundleId));
      const cleaned: MilestoneDefinition[] = milestones.map((m) => ({
        eventName: m.eventName.trim(),
        label: m.label.trim(),
        minCount: Math.trunc(m.minCount),
      }));

      await prisma.app.update({
        where: { id: app.id },
        data: { postHogMilestones: cleaned as unknown as Prisma.InputJsonValue },
      });

      return jsonResult({ ok: true, bundleId: resolvedBundleId, milestones: cleaned });
    },
    {
      summarize: (args) => ({
        summary: `Set ${args?.milestones?.length ?? 0} PostHog milestone(s) for ${args?.bundleId ?? "default app"}`,
        entityType: "app",
        entityId: args?.bundleId,
      }),
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "get_ads_campaign_milestones",
    {
      description:
        "Get PostHog engagement milestone completions for the users RevenueCat attributes to an Apple Search " +
        "Ads campaign, optionally narrowed to one ad group or one targeting keyword within it. Define milestones " +
        "first with set_posthog_milestones. Requires RevenueCat and PostHog both connected and the app's Apple " +
        "Ads org mapped. Use list_ads_campaigns, list_ads_ad_group_ads and keyword tools to find the IDs.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID. Use list_ads_campaigns to find it."),
        adGroupId: z.string().optional().describe("Restrict to one ad group ID within the campaign."),
        keywordId: z.string().optional().describe("Restrict to one targeting keyword ID."),
        ...rangeSchema,
      },
    },
    async ({ campaignId, adGroupId, keywordId, days, period, startDate, endDate }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const app = await prisma.app.findFirst({
          where: { teamId: ctx.teamId, appleAdsOrgId: ctx.orgId },
          select: { bundleId: true, revenueCatConnectedAt: true, postHogMilestones: true },
        });

        if (!app) return unavailable("no-app-mapped");

        if (!app.revenueCatConnectedAt) return unavailable("no-revenuecat");

        const settings = await prisma.teamSettings.findUnique({ where: { teamId: ctx.teamId } });

        if (!settings?.posthogConnectedAt) return unavailable("no-posthog");

        const milestoneDefs = (app.postHogMilestones as MilestoneDefinition[] | null) ?? [];

        if (milestoneDefs.length === 0) {
          return jsonResult({ available: true, reason: "no-milestones", totalInstalls: 0, milestones: [] });
        }

        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const customerIds = await getAppleAdsCampaignCustomerIds(app.bundleId, ctx.orgId, campaignId, range, {
          adGroupId,
          keywordId,
        });

        if (customerIds.length === 0) {
          return jsonResult({
            available: true,
            range,
            totalInstalls: 0,
            milestones: milestoneDefs.map((m) => ({ ...m, completed: 0 })),
          });
        }

        const apiKey = decryptNullable(settings.posthogApiKey);

        if (!apiKey || !settings.posthogHost || !settings.posthogProjectId) return unavailable("no-posthog");

        const milestones = await computeMilestoneCompletions(
          settings.posthogHost,
          apiKey,
          settings.posthogProjectId,
          customerIds,
          milestoneDefs,
        );

        return jsonResult({ available: true, range, totalInstalls: customerIds.length, milestones });
      } catch (err) {
        return adsError("get_ads_campaign_milestones", err);
      }
    },
  );
}
