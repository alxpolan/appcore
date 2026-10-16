import { aggregateGoogleDailyStats, type GoogleAdsDailyStats } from "./utils/google-ads-daily";
import { googleAdsGateway } from "./google-ads-gateway";
import type {
  GoogleAdsAdGroupWithKeywords,
  GoogleAdsCampaign,
  GoogleAdsCampaignTargeting,
  GoogleAdsCountryStats,
  GoogleAdsCredentials,
  GoogleAdsKeyword,
  GoogleAdsNegativeKeyword,
  GoogleAdsSearchTerm,
  GoogleAdsReportRange,
  GoogleAdsStats,
} from "./google-ads-types";

const num = (v: unknown): number => {
  const n = Number(v ?? 0);

  return Number.isFinite(n) ? n : 0;
};

const GOOGLE_ADS_STATUS_NAMES = ["UNSPECIFIED", "UNKNOWN", "ENABLED", "PAUSED", "REMOVED"];

/**
 * The live API returns status enums as numbers (2 = ENABLED, 3 = PAUSED)
 * while the fake gateway uses names. Normalize both to names.
 */
export function normalizeGoogleAdsStatus(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return GOOGLE_ADS_STATUS_NAMES[value] ?? String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return GOOGLE_ADS_STATUS_NAMES[n] ?? value;
  }
  return String(value ?? "");
}

const GOOGLE_ADS_MATCH_TYPE_NAMES = ["UNSPECIFIED", "UNKNOWN", "EXACT", "PHRASE", "BROAD"];

/** Keyword match types arrive numeric too (2 = EXACT, 3 = PHRASE, 4 = BROAD). */
export function normalizeGoogleAdsMatchType(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isInteger(value)) {
    return GOOGLE_ADS_MATCH_TYPE_NAMES[value] ?? String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return GOOGLE_ADS_MATCH_TYPE_NAMES[n] ?? value;
  }
  return String(value);
}

const GOOGLE_ADS_SEARCH_TERM_STATUS_NAMES = ["UNSPECIFIED", "UNKNOWN", "ADDED", "EXCLUDED", "ADDED_EXCLUDED", "NONE"];

/** Search term view status: 2 = added, 3 = excluded, 4 = both, 5 = neither yet. */
export function normalizeGoogleAdsSearchTermStatus(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return GOOGLE_ADS_SEARCH_TERM_STATUS_NAMES[value] ?? String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return GOOGLE_ADS_SEARCH_TERM_STATUS_NAMES[n] ?? value;
  }
  return String(value ?? "");
}

function statsFromMetrics(m: any): GoogleAdsStats {
  const spend = num(m?.cost_micros) / 1_000_000;
  const impressions = num(m?.impressions);
  const clicks = num(m?.clicks);
  const conversions = num(m?.conversions);

  return {
    spend,
    impressions,
    clicks,
    conversions,
    ctr: impressions > 0 ? clicks / impressions : null,
    avgCpc: clicks > 0 ? spend / clicks : null,
    costPerConversion: conversions > 0 ? spend / conversions : null,
    conversionRate: clicks > 0 ? conversions / clicks : null,
  };
}

const ALL_TIME_START = "2015-01-01";

export function resolveGoogleAdsRange(query: {
  days?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  period?: unknown;
}): GoogleAdsReportRange {
  const today = new Date();
  const toISODate = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  if (typeof query.startDate === "string" && typeof query.endDate === "string") {
    return { startDate: query.startDate.slice(0, 10), endDate: query.endDate.slice(0, 10) };
  }

  if (query.period === "all") {
    return { startDate: ALL_TIME_START, endDate: toISODate(end) };
  }

  if (query.period === "ytd") {
    return { startDate: `${end.getUTCFullYear()}-01-01`, endDate: toISODate(end) };
  }

  const days = Math.max(1, Math.min(365, Number(query.days ?? 30) || 30));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);

  return { startDate: toISODate(start), endDate: toISODate(end) };
}

const toGaqlDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

export async function getGoogleAdsCurrency(creds: GoogleAdsCredentials): Promise<string> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query("SELECT customer.id, customer.currency_code FROM customer LIMIT 1");

  return String(rows[0]?.customer?.currency_code ?? "USD");
}

export async function listGoogleAdsCampaigns(
  creds: GoogleAdsCredentials,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<GoogleAdsCampaign[]> {
  const gw = googleAdsGateway(creds);
  const [attrs, metrics, currency] = await Promise.all([
    gw.query(
      "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros " +
        "FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name",
    ),
    gw.query(
      "SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
        `FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}'`,
    ),
    getGoogleAdsCurrency(creds),
  ]);

  const byId = new Map<string, any>();
  for (const row of metrics) byId.set(String(row.campaign?.id), row.metrics ?? {});

  return attrs.map((row) => {
    const c = row.campaign ?? {};

    return {
      id: String(c.id),
      name: String(c.name ?? ""),
      status: normalizeGoogleAdsStatus(c.status),
      dailyBudget:
        row.campaign_budget?.amount_micros != null ? Number(row.campaign_budget.amount_micros) / 1_000_000 : null,
      currency,
      ...statsFromMetrics(byId.get(String(c.id)) ?? {}),
    };
  });
}

export async function listGoogleAdsAdGroups(
  creds: GoogleAdsCredentials,
  campaignId: string,
): Promise<{ id: string; name: string; status: string; defaultCpcBid: number | null }[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, campaign.id " +
      `FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED' ORDER BY ad_group.name`,
  );

  return rows.map((row) => {
    const g = row.ad_group ?? {};

    return {
      id: String(g.id),
      name: String(g.name ?? ""),
      status: normalizeGoogleAdsStatus(g.status),
      defaultCpcBid: g.cpc_bid_micros != null ? Number(g.cpc_bid_micros) / 1_000_000 : null,
    };
  });
}

export async function getGoogleAdsCampaignDetail(
  creds: GoogleAdsCredentials,
  campaignId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<GoogleAdsAdGroupWithKeywords[]> {
  const gw = googleAdsGateway(creds);
  const [groupAttrs, groupMetrics, currency] = await Promise.all([
    gw.query(
      "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, campaign.id " +
        `FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED' ORDER BY ad_group.name`,
    ),
    gw.query(
      "SELECT ad_group.id, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
        `FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.status != 'REMOVED' AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}'`,
    ),
    getGoogleAdsCurrency(creds),
  ]);

  const metricsById = new Map<string, any>();
  for (const row of groupMetrics) metricsById.set(String(row.ad_group?.id), row.metrics ?? {});

  return Promise.all(
    groupAttrs.map(async (row) => {
      const g = row.ad_group ?? {};
      const id = String(g.id);

      return {
        id,
        campaignId: String(campaignId),
        name: String(g.name ?? ""),
        status: normalizeGoogleAdsStatus(g.status),
        defaultCpcBid: g.cpc_bid_micros != null ? Number(g.cpc_bid_micros) / 1_000_000 : null,
        currency,
        ...statsFromMetrics(metricsById.get(id) ?? {}),
        keywords: await listGoogleAdsKeywords(creds, campaignId, id, range, currency),
      };
    }),
  );
}

export async function listGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
  currency?: string,
): Promise<GoogleAdsKeyword[]> {
  const gw = googleAdsGateway(creds);
  const [attrs, metrics, ccy] = await Promise.all([
    gw.query(
      "SELECT ad_group_criterion.criterion_id, ad_group.id, ad_group_criterion.keyword.text, " +
        "ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros " +
        `FROM ad_group_criterion WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD' ` +
        "AND ad_group_criterion.negative = false AND ad_group_criterion.status != 'REMOVED'",
    ),
    gw.query(
      "SELECT keyword_view.resource_name, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
        `FROM keyword_view WHERE ad_group.id = ${adGroupId} ` +
        `AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}'`,
    ),
    currency ?? getGoogleAdsCurrency(creds),
  ]);

  const metricsById = new Map<string, any>();
  for (const row of metrics) {
    const criterionId = String(row.keyword_view?.resource_name ?? "").split("~").pop();
    if (criterionId) metricsById.set(criterionId, row.metrics ?? {});
  }

  return attrs.map((row) => {
    const k = row.ad_group_criterion ?? {};
    const id = String(k.criterion_id);

    return {
      id,
      adGroupId: String(adGroupId),
      text: String(k.keyword?.text ?? ""),
      matchType: normalizeGoogleAdsMatchType(k.keyword?.match_type),
      status: normalizeGoogleAdsStatus(k.status),
      cpcBid: k.cpc_bid_micros != null ? Number(k.cpc_bid_micros) / 1_000_000 : null,
      currency: ccy,
      ...statsFromMetrics(metricsById.get(id) ?? {}),
    };
  });
}

export async function listGoogleAdsSearchTerms(
  creds: GoogleAdsCredentials,
  campaignId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<GoogleAdsSearchTerm[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT campaign.id, ad_group.id, ad_group.name, search_term_view.search_term, search_term_view.status, " +
      "segments.keyword.info.text, segments.keyword.info.match_type, " +
      "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions " +
      `FROM search_term_view WHERE campaign.id = ${campaignId} ` +
      `AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}' ` +
      "ORDER BY metrics.cost_micros DESC LIMIT 500",
  );

  return rows.map((row) => {
    const info = row.segments?.keyword?.info ?? {};

    return {
      searchTerm: String(row.search_term_view?.search_term ?? ""),
      status: normalizeGoogleAdsSearchTermStatus(row.search_term_view?.status),
      adGroupId: String(row.ad_group?.id ?? ""),
      adGroupName: row.ad_group?.name != null ? String(row.ad_group.name) : null,
      keywordText: info.text != null ? String(info.text) : null,
      matchType: info.match_type != null ? normalizeGoogleAdsMatchType(info.match_type) : null,
      ...statsFromMetrics(row.metrics ?? {}),
    };
  });
}

export async function getGoogleAdsCampaignDailySpend(
  creds: GoogleAdsCredentials,
  campaignId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<GoogleAdsDailyStats[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
      `FROM campaign WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}' ORDER BY segments.date`,
  );

  const byDay = new Map(aggregateGoogleDailyStats(rows).map((d) => [d.date, d]));
  const days: GoogleAdsDailyStats[] = [];
  for (
    let t = Date.parse(`${range.startDate}T00:00:00Z`);
    t <= Date.parse(`${range.endDate}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push(byDay.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0, conversions: 0, installs: 0 });
  }

  return days;
}

export async function getGoogleAdsDailyStats(
  creds: GoogleAdsCredentials,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
  campaignIds?: string[],
): Promise<GoogleAdsDailyStats[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
      `FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}' ORDER BY segments.date`,
  );

  const byDay = new Map(aggregateGoogleDailyStats(rows, campaignIds).map((d) => [d.date, d]));
  const days: GoogleAdsDailyStats[] = [];
  for (
    let t = Date.parse(`${range.startDate}T00:00:00Z`);
    t <= Date.parse(`${range.endDate}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push(byDay.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0, conversions: 0, installs: 0 });
  }

  return days;
}

export async function getGoogleAdsCampaignCountryBreakdown(
  creds: GoogleAdsCredentials,
  campaignId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<GoogleAdsCountryStats[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT geographic_view.country_criterion_id, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
      `FROM geographic_view WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}'`,
  );

  const geoIds = [...new Set(rows.map((r) => String(r.geographic_view?.country_criterion_id ?? "")).filter(Boolean))];
  let names = new Map<string, { name: string; code: string }>();

  if (geoIds.length > 0) {
    const geoRows = await gw.query(
      "SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code " +
        `FROM geo_target_constant WHERE geo_target_constant.id IN (${geoIds.join(",")})`,
    );

    names = new Map(
      geoRows.map((r) => [
        String(r.geo_target_constant?.id),
        { name: String(r.geo_target_constant?.name ?? ""), code: String(r.geo_target_constant?.country_code ?? "") },
      ]),
    );
  }

  return rows
    .map((row) => {
      const geoId = String(row.geographic_view?.country_criterion_id ?? "");
      const meta = names.get(geoId);

      return {
        countryOrRegion: meta?.code || geoId,
        countryName: meta?.name ?? null,
        ...statsFromMetrics(row.metrics ?? {}),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

export async function listGoogleAdsNegativeKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null,
): Promise<GoogleAdsNegativeKeyword[]> {
  const gw = googleAdsGateway(creds);

  if (adGroupId) {
    const rows = await gw.query(
      "SELECT ad_group_criterion.criterion_id, ad_group.id, ad_group_criterion.keyword.text, " +
        "ad_group_criterion.keyword.match_type, ad_group_criterion.status " +
        `FROM ad_group_criterion WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD' ` +
        "AND ad_group_criterion.negative = true AND ad_group_criterion.status != 'REMOVED'",
    );

    return rows.map((row) => {
      const k = row.ad_group_criterion ?? {};

      return {
        id: String(k.criterion_id),
        text: String(k.keyword?.text ?? ""),
        matchType: normalizeGoogleAdsMatchType(k.keyword?.match_type),
        status: normalizeGoogleAdsStatus(k.status),
      };
    });
  }

  const rows = await gw.query(
    "SELECT campaign_criterion.criterion_id, campaign.id, campaign_criterion.keyword.text, " +
      "campaign_criterion.keyword.match_type, campaign_criterion.status " +
      `FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.type = 'KEYWORD' ` +
      "AND campaign_criterion.negative = true AND campaign_criterion.status != 'REMOVED'",
  );

  return rows.map((row) => {
    const k = row.campaign_criterion ?? {};

    return {
      id: String(k.criterion_id),
      text: String(k.keyword?.text ?? ""),
      matchType: normalizeGoogleAdsMatchType(k.keyword?.match_type),
      status: normalizeGoogleAdsStatus(k.status),
    };
  });
}

export interface GoogleAdsCampaignBudget {
  resourceName: string;
  explicitlyShared: boolean | null;
}

export async function getGoogleAdsCampaignBudget(
  creds: GoogleAdsCredentials,
  campaignId: string,
): Promise<GoogleAdsCampaignBudget | null> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT campaign.campaign_budget, campaign_budget.explicitly_shared " +
      `FROM campaign WHERE campaign.id = ${campaignId}`,
  );
  const row = rows[0];
  const name = row?.campaign?.campaign_budget ? String(row.campaign.campaign_budget) : "";
  if (!name) return null;
  const shared = row?.campaign_budget?.explicitly_shared;

  return { resourceName: name, explicitlyShared: typeof shared === "boolean" ? shared : null };
}

export async function listGoogleAdsCampaignTargeting(
  creds: GoogleAdsCredentials,
  campaignId: string,
): Promise<GoogleAdsCampaignTargeting> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT campaign_criterion.criterion_id, campaign_criterion.location.geo_target_constant, " +
      "campaign_criterion.language.language_constant " +
      `FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.status != 'REMOVED'`,
  );

  const locations: GoogleAdsCampaignTargeting["locations"] = [];
  const languages: GoogleAdsCampaignTargeting["languages"] = [];
  for (const row of rows) {
    const k = row.campaign_criterion ?? {};
    const geo = k.location?.geo_target_constant ? String(k.location.geo_target_constant) : "";
    const lang = k.language?.language_constant ? String(k.language.language_constant) : "";
    if (geo) locations.push({ criterionId: String(k.criterion_id), geoTargetConstant: geo });
    if (lang) languages.push({ criterionId: String(k.criterion_id), languageConstant: lang });
  }

  return { locations, languages };
}
