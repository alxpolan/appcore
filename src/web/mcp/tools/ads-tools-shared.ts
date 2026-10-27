import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { logger, prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import {
  listTeamAppleAdsOrgs,
  resolveCampaignOrgId,
  AppleAdsCampaignNotFoundError,
  type AppleAdsCredentials,
  type AppleAdsOrgCredentials,
} from "../../../services/apple-ads";
import {
  getMcpAllowedAppIds,
  getMcpUserTeamId,
  registerMutatingTool,
  textResult,
  type MutatingToolOpts,
} from "./shared";

export const rangeSchema = {
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

export const negativeKeywordSchema = z.object({
  text: z.string().describe("Negative keyword text, e.g. 'free'."),
  matchType: z.enum(["EXACT", "BROAD"]).describe("EXACT blocks the precise term, BROAD blocks close variants."),
});

export const targetingKeywordSchema = z.object({
  text: z.string().describe("Keyword text, e.g. 'meditation app'."),
  matchType: z.enum(["EXACT", "BROAD"]).describe("EXACT for precise matches, BROAD for discovery."),
  bidAmount: z
    .number()
    .positive()
    .optional()
    .describe("Keyword-level bid. Falls back to the ad group default bid when omitted."),
});

export interface AppleAdsMcpContext {
  teamId: string;
  keyCreds: AppleAdsOrgCredentials;
  orgIds: string[];
  orgNameById: Map<string, string>;
}

export async function getAppleAdsContext(userId: string): Promise<AppleAdsMcpContext | { error: string }> {
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return { error: "No team found for this user." };
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });

  if (
    !settings?.appleAdsConnectedAt ||
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

  const mappedOrgs = await listTeamAppleAdsOrgs(teamId);

  return {
    teamId,
    keyCreds: {
      clientId: settings.appleAdsClientId,
      teamId: settings.appleAdsTeamId,
      keyId: settings.appleAdsKeyId,
      privateKey,
    },
    orgIds: mappedOrgs.map((o) => o.orgId),
    orgNameById: new Map(mappedOrgs.map((o) => [o.orgId, o.orgName])),
  };
}

export async function getCampaignAppleAdsContext(
  userId: string,
  campaignId: string,
): Promise<(AppleAdsMcpContext & { orgId: string; creds: AppleAdsCredentials }) | { error: string }> {
  const ctx = await getAppleAdsContext(userId);
  if ("error" in ctx) return ctx;
  try {
    const orgId = await resolveCampaignOrgId(ctx.keyCreds, ctx.orgIds, campaignId);

    return { ...ctx, orgId, creds: { ...ctx.keyCreds, orgId } };
  } catch (err) {
    if (err instanceof AppleAdsCampaignNotFoundError) return { error: err.message };
    throw err;
  }
}

export function adsError(tool: string, err: unknown) {
  logger.error(`[mcp] ${tool} error`, { err: String((err as any)?.message ?? err) });
  const detail = (err as any)?.response?.data ? `: ${JSON.stringify((err as any).response.data)}` : "";

  return textResult(`Apple Search Ads request failed${detail || `: ${String((err as any)?.message ?? err)}`}`);
}

export async function getMcpRevenueApps(userId: string, teamId: string) {
  const apps = await prisma.app.findMany({
    where: { teamId, revenueCatConnectedAt: { not: null } },
    select: { id: true, bundleId: true, displayName: true, name: true },
  });

  const allowedAppIds = await getMcpAllowedAppIds(userId, teamId);

  return allowedAppIds ? apps.filter((app) => allowedAppIds.includes(app.id)) : apps;
}

async function getAdsHistory(teamId: string, campaignId?: string, limit = 20) {
  try {
    const entries = await prisma.activityLog.findMany({
      where: {
        teamId,
        entityType: "ads_campaign",
        status: "success",
        ...(campaignId != null ? { entityId: String(campaignId) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { source: true, actor: true, action: true, entityId: true, summary: true, createdAt: true },
    });

    return entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
  } catch {
    return [];
  }
}

async function withAdsHistory(userId: string, campaignId: unknown, result: any) {
  try {
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string") return result;
    const parsed: any = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result;
    const teamId = await getMcpUserTeamId(userId);
    if (!teamId) return result;
    parsed.history =
      parsed.history ?? (await getAdsHistory(teamId, typeof campaignId === "string" ? campaignId : undefined));

    return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
  } catch {
    return result;
  }
}

type AdsToolConfig = { description?: string; inputSchema?: any; outputSchema?: any; annotations?: any };
type AdsToolHandler = (args: any, extra?: any) => Promise<any>;

export function registerAdsReadTool(
  server: McpServer,
  userId: string,
  name: string,
  config: AdsToolConfig,
  handler: AdsToolHandler,
) {
  server.registerTool(name, config, async (args: any, extra?: any) =>
    withAdsHistory(userId, args?.campaignId, await handler(args, extra)),
  );
}

export function registerAdsMutatingTool(
  server: McpServer,
  userId: string,
  name: string,
  config: AdsToolConfig,
  handler: AdsToolHandler,
  opts: MutatingToolOpts = {},
) {
  registerMutatingTool(
    server,
    userId,
    name,
    config,
    async (args: any, extra?: any) => withAdsHistory(userId, args?.campaignId, await handler(args, extra)),
    opts,
  );
}
