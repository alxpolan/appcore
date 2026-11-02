import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { prisma } from "../../../config";
import {
  assignCustomProductPageToAdGroup,
  getAppleAdsCampaign,
  listAppleAdsAds,
  listAppleAdsProductPages,
  resolveAppOrgByAdamId,
} from "../../../services/apple-ads";
import { isTeamAdmin, jsonResult, textResult } from "./shared";
import {
  adsError,
  getAppleAdsContext,
  getCampaignAppleAdsContext,
  registerAdsMutatingTool,
  registerAdsReadTool,
} from "./ads-tools-shared";

export function registerAppleAdsCppTools(server: McpServer, userId: string) {
  registerAdsReadTool(
    server,
    userId,
    "list_ads_product_pages",
    {
      description:
        "List the Custom Product Pages Apple Search Ads can see for an app, with each page's Search-Ads-side " +
        "productPageId (needed by assign_cpp_to_ads_ad_group). Match by name against the Custom Product Pages " +
        "created with create_cpp_page — the App Store Connect page id and this productPageId are different " +
        "identifiers for the same page. Pass either bundleId or adamId.",
      inputSchema: {
        bundleId: z.string().optional().describe("App bundle ID, e.g. 'com.example.myapp'."),
        adamId: z.number().int().positive().optional().describe("Numeric App Store app ID, if known directly."),
      },
    },
    async ({ bundleId, adamId }: { bundleId?: string; adamId?: number }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!bundleId && !adamId) {
        return textResult("Pass either bundleId or adamId.");
      }

      let resolvedAdamId = adamId;
      let orgId: string | undefined;

      if (bundleId) {
        const app = await prisma.app.findFirst({
          where: { teamId: ctx.teamId, bundleId },
          select: { trackId: true, appleAdsOrgId: true },
        });

        if (!app?.trackId || !app.appleAdsOrgId) {
          return textResult(`No Apple Search Ads mapping found for bundleId ${bundleId}.`);
        }

        resolvedAdamId = Number(app.trackId);
        orgId = app.appleAdsOrgId;
      } else {
        const mapping = await resolveAppOrgByAdamId(ctx.teamId, adamId!);

        if (!mapping) {
          return textResult(`No Apple Search Ads mapping found for adamId ${adamId}.`);
        }

        orgId = mapping.orgId;
      }

      try {
        const pages = await listAppleAdsProductPages({ ...ctx.keyCreds, orgId: orgId! }, resolvedAdamId!);

        return jsonResult({ adamId: resolvedAdamId, productPages: pages });
      } catch (err) {
        return adsError("list_ads_product_pages", err);
      }
    },
  );

  registerAdsReadTool(
    server,
    userId,
    "list_ads_ad_group_ads",
    {
      description:
        "List the ads in an Apple Search Ads campaign, optionally scoped to one ad group. Each ad's " +
        "creativeType tells you whether it's a CUSTOM_PRODUCT_PAGE ad, and creativeId identifies which " +
        "creative/Custom Product Page is currently assigned. Each ad group can have at most one Custom " +
        "Product Page ad at a time — use this before assign_cpp_to_ads_ad_group to see what's already there.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string)."),
        adGroupId: z.string().optional().describe("Restrict to one ad group ID. Returns every ad group's ads if omitted."),
      },
    },
    async ({ campaignId, adGroupId }: { campaignId: string; adGroupId?: string }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const ads = await listAppleAdsAds(ctx.creds, campaignId, adGroupId);

        return jsonResult({ campaignId, adGroupId: adGroupId ?? null, ads });
      } catch (err) {
        return adsError("list_ads_ad_group_ads", err);
      }
    },
  );

  registerAdsMutatingTool(
    server,
    userId,
    "assign_cpp_to_ads_ad_group",
    {
      description:
        "Connect a Custom Product Page to an Apple Search Ads ad group, so ads in that ad group link to that " +
        "page instead of the app's default product page. Each ad group can only have one Custom Product Page: " +
        "if the ad group already has one, this swaps it for the new one; otherwise it creates the assignment. " +
        "Get productPageId from list_ads_product_pages (match by name to a page made with create_cpp_page) and " +
        "campaignId/adGroupId from get_ads_campaign_detail. Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string)."),
        adGroupId: z.string().describe("Apple Search Ads ad group ID (numeric string)."),
        productPageId: z
          .string()
          .describe("Search-Ads-side Custom Product Page id, from list_ads_product_pages."),
        name: z.string().describe("Label for the creative/ad, e.g. the Custom Product Page's name."),
        status: z.enum(["ENABLED", "PAUSED"]).default("ENABLED").describe("ENABLED (default) or PAUSED."),
      },
    },
    async ({ campaignId, adGroupId, productPageId, name, status }) => {
      const ctx = await getCampaignAppleAdsContext(userId, campaignId);
      if ("error" in ctx) return textResult(ctx.error);

      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Connecting a Custom Product Page to an ad group requires the team admin role.");
      }

      try {
        const campaign = await getAppleAdsCampaign(ctx.creds, campaignId);

        if (!campaign.adamId) {
          return textResult(`Campaign ${campaignId} has no adamId on record.`);
        }

        const result = await assignCustomProductPageToAdGroup(
          ctx.creds,
          campaign.adamId,
          campaignId,
          adGroupId,
          productPageId,
          name,
          status,
        );

        return jsonResult(result);
      } catch (err) {
        return adsError("assign_cpp_to_ads_ad_group", err);
      }
    },
  );
}
