import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { logger, prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import {
  createAppleAdsAdGroup,
  createAppleAdsCampaignFull,
  createAppleAdsKeywordsBulk,
  createAppleAdsNegativeKeywordsBulk,
  deleteAppleAdsAdGroup,
  deleteAppleAdsCampaign,
  deleteAppleAdsKeywordsBulk,
  deleteAppleAdsNegativeKeywordsBulk,
  getAppleAdsCampaignCountryBreakdown,
  getAppleAdsCampaignDailySpend,
  getAppleAdsCampaignDetail,
  getAppleAdsKeywordCountryBreakdown,
  listAppleAdsAdGroups,
  listAppleAdsCampaigns,
  listAppleAdsKeywords,
  listAppleAdsNegativeKeywords,
  resolveAppleAdsRange,
  updateAppleAdsAdGroup,
  updateAppleAdsCampaign,
  updateAppleAdsCampaignStatus,
  updateAppleAdsKeywords,
  validateCreateCampaignInput,
  type AppleAdsCredentials,
} from "../../../services/apple-ads";
import { getAppleAdsCampaignRevenue, mergeCountryRevenue } from "../../../services/apple-ads-revenue";
import { getMcpAllowedAppIds, getMcpUserTeamId, registerMutatingTool, type ToolSummary } from "./shared";

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

const targetingKeywordSchema = z.object({
  text: z.string().describe("Keyword text, e.g. 'meditation app'."),
  matchType: z.enum(["EXACT", "BROAD"]).describe("EXACT for precise matches, BROAD for discovery."),
  bidAmount: z
    .number()
    .positive()
    .optional()
    .describe("Keyword-level bid. Falls back to the ad group default bid when omitted."),
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
async function previousCampaign(creds: AppleAdsCredentials, campaignId: string) {
  const list = await bestEffort(() => listAppleAdsCampaigns(creds));
  const c = list?.find((x) => String(x.id) === String(campaignId));
  if (!c) return undefined;
  return {
    name: c.name ?? null,
    status: c.status ?? null,
    dailyBudget: c.dailyBudget ?? null,
    currency: c.currency ?? null,
    countriesOrRegions: c.countriesOrRegions ?? [],
  };
}

async function previousAdGroup(creds: AppleAdsCredentials, campaignId: string, adGroupId: string) {
  const list = await bestEffort(() => listAppleAdsAdGroups(creds, campaignId));
  const g = list?.find((x) => String(x.id) === String(adGroupId));
  if (!g) return undefined;
  return {
    name: g.name ?? null,
    status: g.status ?? null,
    defaultBidAmount: g.defaultBidAmount ?? null,
    cpaGoal: g.cpaGoal ?? null,
    currency: g.currency ?? null,
  };
}

/** Resolve keyword ids to their texts before a delete (capped, for the history). */
async function previousKeywordTexts(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  ids: (string | number)[],
): Promise<{ id: string; text: string }[]> {
  const list = await bestEffort(() => listAppleAdsKeywords(creds, campaignId, adGroupId));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));
  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => ({ id: String(k.id), text: k.text ?? "" }))
    .slice(0, 10);
}

async function previousNegativeTexts(
  creds: AppleAdsCredentials,
  campaignId: string,
  adGroupId: string | null | undefined,
  ids: (string | number)[],
): Promise<string[]> {
  const list = await bestEffort(() => listAppleAdsNegativeKeywords(creds, campaignId, adGroupId ?? null));
  if (!list) return [];
  const want = new Set(ids.map((id) => String(id)));
  return list
    .filter((k) => want.has(String(k.id)))
    .map((k) => k.text)
    .slice(0, 10);
}

const summarizeCreateCampaign = (args: any, text: string): ToolSummary => ({
  summary: `Created campaign "${args?.name}" (${args?.status ?? "PAUSED"}) with ${args?.adGroups?.length ?? 0} ad group(s)`,
  entityType: "ads_campaign",
  entityId: tryParseJson(text)?.campaign?.id != null ? String(tryParseJson(text).campaign.id) : undefined,
});

const summarizeUpdateCampaign = (args: any, text: string): ToolSummary => {
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
    const ccy = args?.currency ?? prev?.currency;
    const suffix = ccy ? ` ${ccy}` : "";
    parts.push(fromTo("daily budget", prev?.dailyBudget, `${args.dailyBudgetAmount}${suffix}`));
    changes.push({
      label: "Daily budget",
      from: prev?.dailyBudget != null ? `${prev.dailyBudget}${suffix}` : null,
      to: `${args.dailyBudgetAmount}${suffix}`,
    });
  }
  if (args?.countriesOrRegions != null) {
    const from = (prev?.countriesOrRegions ?? []).join(", ") || null;
    parts.push(fromTo("countries", from, args.countriesOrRegions.join(", ")));
    changes.push({ label: "Countries", from, to: args.countriesOrRegions.join(", ") });
  }
  return {
    summary: `Updated campaign ${args?.campaignId}${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, changes },
  };
};

const summarizeCampaignStatus = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const verb = args?.status === "ENABLED" ? "Published" : "Paused";
  const target = prev?.name ? `"${prev.name}" (${args?.campaignId})` : `campaign ${args?.campaignId}`;
  const transition = prev?.status ? `: ${prev.status} → ${args?.status}` : "";
  return {
    summary: `${verb} ${target}${transition}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: {
      campaignId: args?.campaignId,
      name: prev?.name ?? null,
      changes: [{ label: "Status", from: prev?.status ?? null, to: args?.status ?? null }],
    },
  };
};

const summarizeDeleteCampaign = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  return {
    summary: prev?.name
      ? `Deleted campaign "${prev.name}" (${args?.campaignId})`
      : `Deleted campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeCreateAdGroup = (args: any, text: string): ToolSummary => {
  const created = tryParseJson(text)?.adGroup;
  return {
    summary: `Created ad group "${args?.name}"${created?.id != null ? ` (${created.id})` : ""} in campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeUpdateAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  const ccy = args?.currency ?? prev?.currency;
  const suffix = ccy ? ` ${ccy}` : "";
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
    parts.push(fromTo("default bid", prev?.defaultBidAmount, `${args.defaultBidAmount}${suffix}`));
    changes.push({
      label: "Default bid",
      from: prev?.defaultBidAmount != null ? `${prev.defaultBidAmount}${suffix}` : null,
      to: `${args.defaultBidAmount}${suffix}`,
    });
  }
  if (args?.cpaGoal != null) {
    parts.push(fromTo("CPA goal", prev?.cpaGoal, `${args.cpaGoal}${suffix}`));
    changes.push({
      label: "CPA goal",
      from: prev?.cpaGoal != null ? `${prev.cpaGoal}${suffix}` : null,
      to: `${args.cpaGoal}${suffix}`,
    });
  }
  return {
    summary: `Updated ad group ${args?.adGroupId} (campaign ${args?.campaignId})${parts.length ? `: ${parts.join("; ")}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

const summarizeDeleteAdGroup = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous;
  return {
    summary: prev?.name
      ? `Deleted ad group "${prev.name}" (${args?.adGroupId}) from campaign ${args?.campaignId}`
      : `Deleted ad group ${args?.adGroupId} from campaign ${args?.campaignId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeAddKeywords = (args: any): ToolSummary => {
  const texts = (args?.keywords ?? []).map((k: any) => k?.text).filter(Boolean).slice(0, 5).join(", ");
  return {
    summary: `Added ${args?.keywords?.length ?? 0} keyword(s)${texts ? ` (${texts}${(args?.keywords?.length ?? 0) > 5 ? ", …" : ""})` : ""} to ad group ${args?.adGroupId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
  };
};

const summarizeUpdateKeywords = (args: any, text: string): ToolSummary => {
  const rows = tryParseJson(text)?.updated ?? [];
  const suffix = args?.currency ? ` ${args.currency}` : "";
  const changes: { label: string; from: string | null; to: string | null }[] = [];
  const parts = rows.slice(0, 5).map((r: any) => {
    const bits: string[] = [];
    const name = `"${r?.text ?? r?.id}"`;
    if (r?.bidAmount != null) {
      bits.push(`bid ${r.previousBidAmount ?? "—"} → ${r.bidAmount}${suffix}`);
      changes.push({
        label: `${name} · bid`,
        from: r.previousBidAmount != null ? `${r.previousBidAmount}${suffix}` : null,
        to: `${r.bidAmount}${suffix}`,
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
    summary: `Updated ${rows.length} keyword(s) in ad group ${args?.adGroupId}${parts.length ? `: ${parts.join("; ")}${more}` : ""}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, changes },
  };
};

const summarizeDeleteKeywords = (args: any, text: string): ToolSummary => {
  const prev = tryParseJson(text)?.previous ?? [];
  const removed = prev.map((p: any) => p?.text).filter(Boolean);
  const label = removed.map((t: string) => `"${t}"`).join(", ") || (args?.keywordIds ?? []).join(", ");
  return {
    summary: `Deleted ${args?.keywordIds?.length ?? 0} keyword(s) (${label}) from ad group ${args?.adGroupId}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId, removed },
  };
};

const summarizeUpdateNegatives = (args: any, text: string): ToolSummary => {
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
    summary: `Negative keywords (${scope}, campaign ${args?.campaignId}): ${parts.join(", ") || "no changes"}`,
    entityType: "ads_campaign",
    entityId: args?.campaignId != null ? String(args.campaignId) : undefined,
    details: { campaignId: args?.campaignId, adGroupId: args?.adGroupId ?? null, scope, added, removed },
  };
};

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

async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "ADMIN") return true;

  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true },
  });

  return member?.role === "OWNER" || member?.role === "ADMIN";
}

async function getMcpRevenueApps(userId: string, teamId: string) {
  const apps = await prisma.app.findMany({
    where: { teamId, revenueCatConnectedAt: { not: null } },
    select: { id: true, bundleId: true, displayName: true, name: true },
  });
  const allowedAppIds = await getMcpAllowedAppIds(userId, teamId);
  return allowedAppIds ? apps.filter((app) => allowedAppIds.includes(app.id)) : apps;
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
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const [apple, revenue] = await Promise.all([
          getAppleAdsCampaignCountryBreakdown(ctx.creds, campaignId, range),
          getAppleAdsCampaignRevenue(accessibleApps, ctx.orgId, range),
        ]);
        const countries = mergeCountryRevenue(apple, revenue.byCampaign[campaignId]?.byCountry);
        return jsonResult({ range, campaignId, revenueAvailable: accessibleApps.length > 0, countries });
      } catch (err) {
        return adsError("get_ads_campaign_country_breakdown", err);
      }
    },
  );

  server.registerTool(
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
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);

      try {
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const [apple, revenue] = await Promise.all([
          getAppleAdsKeywordCountryBreakdown(ctx.creds, campaignId, adGroupId, keywordId, range),
          getAppleAdsCampaignRevenue(accessibleApps, ctx.orgId, range),
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

  registerMutatingTool(
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

      try {
        const campaign = await createAppleAdsCampaignFull(ctx.creds, input);
        return jsonResult({ campaign });
      } catch (err) {
        return adsError("create_ads_campaign", err);
      }
    },
    { summarize: summarizeCreateCampaign },
  );

  registerMutatingTool(
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
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Publishing campaigns requires the team admin role.");
      }

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

  registerMutatingTool(
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
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting campaigns requires the team admin role.");
      }

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

  registerMutatingTool(
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
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating campaigns requires the team admin role.");
      }
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

  registerMutatingTool(
    server,
    userId,
    "create_ads_ad_group",
    {
      description:
        "Create an ad group with optional keywords and negative keywords in an existing Apple Search Ads campaign. " +
        "Requires team admin rights. Use get_ads_campaign_detail first to see the campaign's current ad groups.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        name: z.string().min(1).describe("Ad group name, e.g. 'Brand Exact'."),
        defaultBidAmount: z.number().positive().describe("Default bid per tap (CPC) or per 1k impressions (CPM)."),
        currency: z.string().describe("Three-letter currency code, e.g. USD, EUR."),
        cpaGoal: z.number().positive().optional().describe("Optional target cost per acquisition."),
        status: z
          .enum(["ENABLED", "PAUSED"])
          .default("ENABLED")
          .describe("ENABLED (default) or PAUSED."),
        pricingModel: z
          .enum(["CPC", "CPM"])
          .default("CPC")
          .describe("Must match the campaign's placements: CPC for Search Results, CPM for Search Tab / Today Tab."),
        keywords: z
          .array(targetingKeywordSchema)
          .max(500)
          .optional()
          .describe("Keywords for the new ad group (Search Results placements only)."),
        negativeKeywords: z
          .array(negativeKeywordSchema)
          .max(500)
          .optional()
          .describe("Negative keywords for the new ad group."),
      },
    },
    async ({ campaignId, name, defaultBidAmount, currency, cpaGoal, status, pricingModel, keywords, negativeKeywords }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Creating ad groups requires the team admin role.");
      }
      if (!/^[A-Z]{3}$/i.test(currency)) return textResult("currency must be a three-letter code like USD or EUR.");
      try {
        const adGroup = await createAppleAdsAdGroup(ctx.creds, campaignId, currency.toUpperCase(), pricingModel, undefined, {
          name,
          defaultBidAmount,
          cpaGoal,
          status,
        });
        const keywordCount = await createAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroup.id, currency.toUpperCase(), keywords ?? []);
        const negatives = await createAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroup.id, negativeKeywords ?? []);
        return jsonResult({ adGroup: { ...adGroup, keywordCount, negativeKeywordCount: negatives.length } });
      } catch (err) {
        return adsError("create_ads_ad_group", err);
      }
    },
    { summarize: summarizeCreateAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "update_ads_ad_group",
    {
      description:
        "Update an Apple Search Ads ad group: default bid, CPA goal, status and/or name. " +
        "Only the passed fields change. Requires team admin rights. " +
        "Use get_ads_campaign_detail first to find the ad group ID.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        name: z.string().optional().describe("New ad group name."),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("ENABLED or PAUSED."),
        defaultBidAmount: z.number().positive().optional().describe("New default bid."),
        cpaGoal: z.number().positive().optional().describe("New target cost per acquisition."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when setting defaultBidAmount or cpaGoal."),
      },
    },
    async ({ campaignId, adGroupId, name, status, defaultBidAmount, cpaGoal, currency }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating ad groups requires the team admin role.");
      }
      const previous = await previousAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const adGroup = await updateAppleAdsAdGroup(ctx.creds, campaignId, adGroupId, {
          name,
          status,
          defaultBidAmount,
          cpaGoal,
          currency,
        });
        return jsonResult({ adGroup, previous: previous ?? null });
      } catch (err: any) {
        if (err?.response == null) return textResult(`Invalid ad group update: ${err.message}`);
        return adsError("update_ads_ad_group", err);
      }
    },
    { summarize: summarizeUpdateAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_ads_ad_group",
    {
      description:
        "Permanently delete an Apple Search Ads ad group with all its keywords. " +
        "This cannot be undone — prefer update_ads_ad_group with PAUSED when the ad group might be needed again. " +
        "Only delete when the user explicitly asks for deletion. Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
      },
    },
    async ({ campaignId, adGroupId }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting ad groups requires the team admin role.");
      }
      const previous = await previousAdGroup(ctx.creds, campaignId, adGroupId);
      try {
        const adGroup = await deleteAppleAdsAdGroup(ctx.creds, campaignId, adGroupId);
        return jsonResult({ adGroup, previous: previous ? { name: previous.name } : null });
      } catch (err) {
        return adsError("delete_ads_ad_group", err);
      }
    },
    { summarize: summarizeDeleteAdGroup },
  );

  registerMutatingTool(
    server,
    userId,
    "add_ads_keywords",
    {
      description:
        "Add targeting keywords to an existing Apple Search Ads ad group. " +
        "Keywords only take effect for the APPSTORE_SEARCH_RESULTS placement. " +
        "Requires team admin rights. Use get_ads_campaign_detail first to find campaign and ad group IDs.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when any keyword sets a bidAmount."),
        keywords: z
          .array(targetingKeywordSchema)
          .min(1)
          .max(500)
          .describe("Keywords to add."),
      },
    },
    async ({ campaignId, adGroupId, currency, keywords }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Adding keywords requires the team admin role.");
      }
      if (keywords.some((k: any) => k.bidAmount != null) && !/^[A-Z]{3}$/i.test(currency ?? "")) {
        return textResult("currency (e.g. USD, EUR) is required when setting keyword bids.");
      }
      try {
        const count = await createAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroupId, (currency ?? "USD").toUpperCase(), keywords);
        return jsonResult({ campaignId, adGroupId, added: count });
      } catch (err) {
        return adsError("add_ads_keywords", err);
      }
    },
    { summarize: summarizeAddKeywords },
  );

  registerMutatingTool(
    server,
    userId,
    "update_ads_keywords",
    {
      description:
        "Update bids and/or status of targeting keywords in an Apple Search Ads ad group, by keyword ID. " +
        "Only the passed fields change per keyword. Requires team admin rights. " +
        "Use get_ads_campaign_detail first to find keyword IDs and current bids.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        currency: z
          .string()
          .optional()
          .describe("Three-letter currency code, e.g. USD, EUR. Required when setting bids."),
        updates: z
          .array(
            z.object({
              keywordId: z.string().describe("Keyword ID (numeric string)."),
              bidAmount: z.number().positive().optional().describe("New keyword-level bid."),
              status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("ACTIVE or PAUSED."),
            }),
          )
          .min(1)
          .max(500)
          .describe("At least one keyword update with bidAmount and/or status each."),
      },
    },
    async ({ campaignId, adGroupId, currency, updates }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Updating keywords requires the team admin role.");
      }
      try {
        const updated = await updateAppleAdsKeywords(ctx.creds, campaignId, adGroupId, currency, updates);
        return jsonResult({ campaignId, adGroupId, updated });
      } catch (err: any) {
        if (err?.response == null) return textResult(`Invalid keyword update: ${err.message}`);
        return adsError("update_ads_keywords", err);
      }
    },
    { summarize: summarizeUpdateKeywords },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_ads_keywords",
    {
      description:
        "Permanently delete targeting keywords from an Apple Search Ads ad group, by keyword ID. " +
        "This cannot be undone — prefer update_ads_keywords with PAUSED when a keyword might be needed again. " +
        "Only delete when the user explicitly asks for deletion. Requires team admin rights.",
      inputSchema: {
        campaignId: z.string().describe("Apple Search Ads campaign ID (numeric string, e.g. '2144630640')."),
        adGroupId: z.string().describe("Ad group ID (numeric string)."),
        keywordIds: z
          .array(z.string())
          .min(1)
          .max(500)
          .describe("IDs of the keywords to delete (numeric strings)."),
      },
    },
    async ({ campaignId, adGroupId, keywordIds }) => {
      const ctx = await getAppleAdsContext(userId);
      if ("error" in ctx) return textResult(ctx.error);
      if (!(await isTeamAdmin(userId, ctx.teamId))) {
        return textResult("Deleting keywords requires the team admin role.");
      }
      const previous = await previousKeywordTexts(ctx.creds, campaignId, adGroupId, keywordIds);
      try {
        const deleted = await deleteAppleAdsKeywordsBulk(ctx.creds, campaignId, adGroupId, keywordIds);
        return jsonResult({ campaignId, adGroupId, deleted, previous });
      } catch (err) {
        return adsError("delete_ads_keywords", err);
      }
    },
    { summarize: summarizeDeleteKeywords },
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

  registerMutatingTool(
    server,
    userId,
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
        add: z.array(negativeKeywordSchema).max(500).optional().describe("Negative keywords to add."),
        removeIds: z.array(z.string()).max(500).optional().describe("IDs of negative keywords to delete."),
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

      const removedTexts =
        removeIds?.length ? await previousNegativeTexts(ctx.creds, campaignId, adGroupId, removeIds) : [];
      try {
        const added = await createAppleAdsNegativeKeywordsBulk(ctx.creds, campaignId, adGroupId ?? null, add ?? []);
        const removed = await deleteAppleAdsNegativeKeywordsBulk(
          ctx.creds,
          campaignId,
          adGroupId ?? null,
          removeIds ?? [],
        );
        return jsonResult({ campaignId, adGroupId: adGroupId ?? null, added, removed, previous: { removedTexts } });
      } catch (err) {
        return adsError("update_ads_negative_keywords", err);
      }
    },
    { summarize: summarizeUpdateNegatives },
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
        const accessibleApps = await getMcpRevenueApps(userId, ctx.teamId);
        const range = resolveAppleAdsRange({ days, period, startDate, endDate });
        const { byCampaign } = await getAppleAdsCampaignRevenue(accessibleApps, ctx.orgId, range);

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
