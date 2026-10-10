import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { logger, prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import {
  addGoogleAdsKeywords,
  addGoogleAdsNegativeKeywords,
  createGoogleAdsAdGroup,
  createGoogleAdsCampaignFull,
  deleteGoogleAdsAdGroup,
  deleteGoogleAdsCampaign,
  deleteGoogleAdsKeywords,
  deleteGoogleAdsNegativeKeywords,
  getGoogleAdsCampaignCountryBreakdown,
  getGoogleAdsCampaignDailySpend,
  getGoogleAdsCampaignDetail,
  listGoogleAdsAdGroups,
  listGoogleAdsCampaigns,
  listGoogleAdsKeywords,
  listGoogleAdsNegativeKeywords,
  resolveGoogleAdsRange,
  updateGoogleAdsAdGroup,
  updateGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  updateGoogleAdsKeywords,
  validateGoogleAdsCreateCampaignInput,
  type GoogleAdsCredentials,
} from "../../../services/google-ads";
import { getMcpUserTeamId, registerMutatingTool, type ToolSummary } from "./shared";

const rangeSchema = {
  days: z
    .number()
    .int()
    .min(1)
    .max(730)
    .optional()
    .describe("Evaluate the last N days (e.g. 7, 30). Defaults to 30 when no range is given."),
  startDate: z
    .string()
    .optional()
    .describe("Explicit range start, YYYY-MM-DD. Overrides days."),
  endDate: z.string().optional().describe("Explicit range end, YYYY-MM-DD. Defaults to today."),
};

const googleNegativeKeywordSchema = z.object({
  text: z.string().describe("Negative keyword text, e.g. 'free'."),
  matchType: z
    .enum(["EXACT", "PHRASE", "BROAD"])
    .describe("EXACT blocks the precise term, PHRASE blocks the phrase, BROAD blocks close variants."),
});

const googleTargetingKeywordSchema = z.object({
  text: z.string().describe("Keyword text, e.g. 'habit tracker app'."),
  matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).describe("EXACT for precise matches, PHRASE for phrases, BROAD for discovery."),
  bidAmount: z
    .number()
    .positive()
    .optional()
    .describe("Keyword-level max CPC bid. Falls back to the ad group default bid when omitted."),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Best-effort read: history snapshots must never break the mutation itself. */
async function bestEffort<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

function quote(value: unknown): string {
  return value == null || value === "" ? "—" : `"${value}"`;
}

/** "label: from → to", or "label → to" when the old value is unknown. */
function fromTo(label: string, from: unknown, to: unknown): string {
  const oldText = from == null || from === "" ? null : String(from);
  return oldText == null ? `${label} → ${to}` : `${label}: ${oldText} → ${to}`;
}

/** Snapshot of the current campaign settings, so the history can show old → new. */
async function previousGoogleCampaign(creds: GoogleAdsCredentials, campaignId: string) {
  const list = await bestEffort(() => listGoogleAdsCampaigns(creds));
  const c = list?.find((x) => String(x.id) === String(campaignId));
  if (!c) return undefined;
  return {
    name: c.name ?? null,
    status: c.status ?? null,
    dailyBudget: c.dailyBudget ?? null,
    currency: c.currency ?? null,
  };
}

async function previousGoogleAdGroup(creds: GoogleAdsCredentials, campaignId: string, adGroupId: string) {
  const detail = await bestEffort(() => listGoogleAdsAdGroups(creds, campaignId));
  const g = detail?.find((x) => String(x.id) === String(adGroupId));
  if (!g) return undefined;
  return {
    name: g.name ?? null,
    status: g.status ?? null,
    defaultBidAmount: g.defaultCpcBid ?? null,
  };
}

/** Resolve keyword ids to their texts before a delete (capped, for the history). */
async function previousGoogleKeywordTexts(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  ids: (string | number)[],
): Promise<{ id: string; text: string }[]> {
  const list = await bestEffort(() => listGoogleAdsKeywords(creds, campaignId, adGroupId));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));
  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => ({ id: String(k.id), text: k.text ?? "" }))
    .slice(0, 10);
}

async function previousGoogleNegativeTexts(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  ids: (string | number)[],
): Promise<string[]> {
  const list = await bestEffort(() => listGoogleAdsNegativeKeywords(creds, campaignId, adGroupId ?? null));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));
  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => k.text)
    .slice(0, 10);
}

const summarizeGoogleCreateCampaign = (args: any, text: string): ToolSummary => ({
  summary: `Created Google Ads campaign "${args?.name}" (${args?.status ?? "PAUSED"}) with ${args?.adGroups?.length ?? 0} ad group(s)`,
  entityType: "google_ads_campaign",
  entityId: tryParseJson(text)?.campaign?.id != null ? String(tryParseJson(text).campaign.id) : undefined,
});

const summarizeGoogleUpdateCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const parts: string[] = [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  if (args?.name != null) {
    parts.push(`name: ${quote(prev?.name)} → ${quote(args.name)}`);
    changes.push({ label: "Name", from: prev?.name ?? null, to: args.name });
  }
  if (args?.status != null) {
    parts.push(fromTo("status", prev?.status, args.status));
    changes.push({ label: "Status", from: prev?.status ?? null, to: args.status });
  }
  if (args?.dailyBudgetAmount != null) {
    const ccy = prev?.currency ? ` ${prev.currency}` : "";
    parts.push(fromTo("daily budget", prev?.dailyBudget, `${args.dailyBudgetAmount}${ccy}`));
    changes.push({
      label: "Daily budget",
      from: prev?.dailyBudget != null ? `${prev.dailyBudget}${ccy}` : null,
      to: `${args.dailyBudgetAmount}${ccy}`,
    });
  }
  if (args?.startDate != null) {
    parts.push(fromTo("start date", null, args.startDate));
    changes.push({ label: "Start date", from: null, to: args.startDate });
  }
  if (args?.endDate != null) {
    parts.push(fromTo("end date", null, args.endDate));
    changes.push({ label: "End date", from: null, to: args.endDate });
  }
  return {
    summary: `Updated Google Ads campaign ${args?.campaignId}${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, changes },
  };
};

const summarizeGoogleCampaignStatus = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  return {
    summary:
      args?.status === "ENABLED"
        ? `Published Google Ads campaign ${args?.campaignId} (${fromTo("status", prev?.status, "ENABLED")})`
        : `Paused Google Ads campaign ${args?.campaignId} (${fromTo("status", prev?.status, "PAUSED")})`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: {
      campaignId: args?.campaignId,
      changes: [{ label: "Status", from: prev?.status ?? null, to: args?.status ?? null }],
    },
  };
};

const summarizeGoogleDeleteCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  return {
    summary: prev?.name
      ? `Deleted Google Ads campaign "${prev.name}" (${args?.campaignId})`
      : `Deleted Google Ads campaign ${args?.campaignId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeGoogleCreateAdGroup = (args: any, text: string): ToolSummary => ({
  summary: `Created ad group "${args?.name}" (default bid ${args?.defaultBidAmount}) in Google Ads campaign ${args?.campaignId}`,
  entityType: "google_ads_campaign",
  entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
});

const summarizeGoogleUpdateAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const parts: string[] = [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  if (args?.name != null) {
    parts.push(`name: ${quote(prev?.name)} → ${quote(args.name)}`);
    changes.push({ label: "Name", from: prev?.name ?? null, to: args.name });
  }
  if (args?.status != null) {
    parts.push(fromTo("status", prev?.status, args.status));
    changes.push({ label: "Status", from: prev?.status ?? null, to: args.status });
  }
  if (args?.defaultBidAmount != null) {
    parts.push(fromTo("default bid", prev?.defaultBidAmount, args.defaultBidAmount));
    changes.push({
      label: "Default bid",
      from: prev?.defaultBidAmount != null ? String(prev.defaultBidAmount) : null,
      to: String(args.defaultBidAmount),
    });
  }
  return {
    summary: `Updated ad group ${args?.adGroupId} (Google Ads campaign ${args?.campaignId})${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

const summarizeGoogleDeleteAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  return {
    summary: prev?.name
      ? `Deleted ad group "${prev.name}" (${args?.adGroupId}) from Google Ads campaign ${args?.campaignId}`
      : `Deleted ad group ${args?.adGroupId} from Google Ads campaign ${args?.campaignId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeGoogleAddKeywords = (args: any): ToolSummary => {
  const texts = (args?.keywords ?? []).map((k: any) => k?.text).filter(Boolean).slice(0, 5).join(", ");
  return {
    summary: `Added ${args?.keywords?.length ?? 0} Google Ads keyword(s)${texts ? ` (${texts}${(args?.keywords?.length ?? 0) > 5 ? ", …" : ""})` : ""} to ad group ${args?.adGroupId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeGoogleUpdateKeywords = (args: any, text: string): ToolSummary => {
  const rows = tryParseJson(text)?.updated ?? [];
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  const parts = rows.slice(0, 5).map((r: any) => {
    const bits: string[] = [];
    const name = `"${r?.text ?? r?.id}"`;
    if (r?.bidAmount != null) {
      bits.push(`bid ${r.previousBidAmount ?? "—"} → ${r.bidAmount}`);
      changes.push({
        label: `${name} · bid`,
        from: r.previousBidAmount != null ? String(r.previousBidAmount) : null,
        to: String(r.bidAmount),
      });
    }
    if (r?.status != null) {
      bits.push(`${r.previousStatus ?? "—"} → ${r.status}`);
      changes.push({ label: `${name} · status`, from: r.previousStatus ?? null, to: r.status });
    }
    return `${name}: ${bits.join(", ") || "no changes"}`;
  });
  const more = rows.length > 5 ? `; +${rows.length - 5} more` : "";
  return {
    summary: `Updated ${rows.length} Google Ads keyword(s) in ad group ${args?.adGroupId}${parts.length ? `: ${parts.join("; ")}${more}` : ""}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

const summarizeGoogleDeleteKeywords = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous ?? [];
  const removed = prev.map((p: any) => p?.text).filter(Boolean);
  const label = removed.map((t: string) => `"${t}"`).join(", ") || (args?.keywordIds ?? []).join(", ");
  return {
    summary: `Deleted ${args?.keywordIds?.length ?? 0} Google Ads keyword(s) (${label}) from ad group ${args?.adGroupId}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, removed },
  };
};

const summarizeGoogleUpdateNegatives = (args: any, text: string): ToolSummary => {
  const scope = args?.adGroupId ? `ad group ${args.adGroupId}` : "campaign level";
  const prev = tryParseJson(text)?.previous;
  const added = (args?.add ?? []).map((k: any) => k?.text).filter(Boolean);
  const removed = (prev?.removedTexts ?? []).filter(Boolean);
  const parts: string[] = [];
  if (args?.add?.length) {
    const texts = added
      .map((t: string) => `"${t}"`)
      .slice(0, 5)
      .join(", ");
    parts.push(`added ${args.add.length}${texts ? ` (${texts})` : ""}`);
  }
  if (args?.removeIds?.length) {
    const texts = removed
      .map((t: string) => `"${t}"`)
      .slice(0, 5)
      .join(", ");
    parts.push(`removed ${args.removeIds.length}${texts ? ` (${texts})` : ""}`);
  }
  return {
    summary: `Google Ads negative keywords (${scope}, campaign ${args?.campaignId}): ${parts.join(", ") || "no changes"}`,
    entityType: "google_ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId ?? null, scope, added, removed },
  };
};

interface GoogleAdsMcpContext {
  teamId: string;
  creds: GoogleAdsCredentials;
}

async function getGoogleAdsContext(userId: string): Promise<GoogleAdsMcpContext | { error: string }> {
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return { error: "No team found for this user." };
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });
  if (
    !settings?.googleAdsConnectedAt ||
    !settings.googleAdsClientId ||
    !settings.googleAdsClientSecret ||
    !settings.googleAdsRefreshToken ||
    !settings.googleAdsDeveloperToken ||
    !settings.googleAdsCustomerId
  ) {
    return { error: "Google Ads is not connected. Connect it in Marteso Integrations first." };
  }

  const clientSecret = decryptNullable(settings.googleAdsClientSecret);
  const refreshToken = decryptNullable(settings.googleAdsRefreshToken);
  const developerToken = decryptNullable(settings.googleAdsDeveloperToken);

  if (!clientSecret || !refreshToken || !developerToken) {
    return { error: "Google Ads credentials are unreadable. Reconnect them in Marteso Integrations." };
  }

  return {
    teamId,
    creds: {
      customerId: settings.googleAdsCustomerId,
      clientId: settings.googleAdsClientId,
      clientSecret,
      refreshToken,
      developerToken,
    },
  };
}

function googleAdsError(tool: string, err: unknown) {
  logger.error(`[mcp] ${tool} error`, { err: String((err as any)?.message ?? err) });
  return textResult(`Google Ads request failed: ${String((err as any)?.message ?? err)}`);
}

async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "ADMIN") return true;

  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true },
  });

  return member?.role === "OWNER" || member?.role === "ADMIN";
}

export function registerGoogleAdsTools(server: McpServer, userId: string) {
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
