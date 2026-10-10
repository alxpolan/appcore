import { GoogleAdsApi, ResourceNames, enums, errors, toMicros } from "google-ads-api";

// Runtime enum lookup (verified: enums.CampaignStatus.ENABLED === 2).
const E: any = enums;

export interface GoogleAdsCredentials {
  customerId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Sunset by Google on 2026-09-09: the header is optional and ignored. Kept for stored legacy values. */
  developerToken?: string;
}

export interface GoogleAdsStats {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  conversionRate: number | null;
}

export interface GoogleAdsCampaign extends GoogleAdsStats {
  id: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  currency: string | null;
}

export interface GoogleAdsAdGroup extends GoogleAdsStats {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  defaultCpcBid: number | null;
  currency: string | null;
}

export interface GoogleAdsKeyword extends GoogleAdsStats {
  id: string;
  adGroupId: string;
  text: string;
  matchType: string;
  status: string;
  cpcBid: number | null;
  currency: string | null;
}

export interface GoogleAdsNegativeKeyword {
  id: string;
  text: string;
  matchType: string;
  status: string;
}

export interface GoogleAdsCountryStats extends GoogleAdsStats {
  countryOrRegion: string;
  countryName: string | null;
}

export interface GoogleAdsReportRange {
  startDate: string;
  endDate: string;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

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

const ZERO_STATS: GoogleAdsStats = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  conversions: 0,
  ctr: null,
  avgCpc: null,
  costPerConversion: null,
  conversionRate: null,
};

export function resolveGoogleAdsRange(query: {
  days?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}): GoogleAdsReportRange {
  const today = new Date();
  const toISODate = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (typeof query.startDate === "string" && typeof query.endDate === "string") {
    return { startDate: query.startDate.slice(0, 10), endDate: query.endDate.slice(0, 10) };
  }
  const days = Math.max(1, Math.min(365, Number(query.days ?? 30) || 30));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { startDate: toISODate(start), endDate: toISODate(end) };
}

const toGaqlDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

/** Normalize a GoogleAdsFailure (or transport error) into a readable message. */
export function googleAdsErrorMessage(err: any, context: string): string {
  if (err instanceof errors.GoogleAdsFailure) {
    const details = (err.errors ?? [])
      .map((e: any) => e?.message ?? e?.error_code?.toString?.() ?? JSON.stringify(e))
      .filter(Boolean)
      .join("; ");
    return `Google Ads ${context} failed${details ? `: ${details}` : ""}`;
  }
  return `Google Ads ${context} failed: ${String(err?.message ?? err)}`;
}

// ---------------------------------------------------------------------------
// Gateway (real client + in-memory fake selected via GOOGLE_ADS_FAKE=1)
// ---------------------------------------------------------------------------

export interface GoogleAdsMutationOperation {
  entity: "campaign_budget" | "campaign" | "ad_group" | "ad_group_criterion" | "campaign_criterion";
  operation: "create" | "update" | "remove";
  resource: Record<string, any>;
}

export interface GoogleAdsGateway {
  query(gaql: string): Promise<any[]>;
  mutate(operations: GoogleAdsMutationOperation[]): Promise<string[]>;
  listAccessibleCustomers(): Promise<string[]>;
}

class RealGoogleAdsGateway implements GoogleAdsGateway {
  private client: InstanceType<typeof GoogleAdsApi>;
  private creds: GoogleAdsCredentials;

  constructor(creds: GoogleAdsCredentials) {
    this.creds = creds;
    this.client = new GoogleAdsApi({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      // Undefined when unset: the library omits the header (the API rejects an empty one).
      developer_token: creds.developerToken,
    });
  }

  private customer() {
    return this.client.Customer({ customer_id: this.creds.customerId, refresh_token: this.creds.refreshToken });
  }

  async query(gaql: string): Promise<any[]> {
    return this.customer().query(gaql);
  }

  async mutate(operations: GoogleAdsMutationOperation[]): Promise<string[]> {
    const res: any = await this.customer().mutateResources(operations as any);
    const list = res.mutate_operation_responses ?? res.results ?? [];
    return list.map((r: any) => String(r.resource_name ?? ""));
  }

  async listAccessibleCustomers(): Promise<string[]> {
    const res: any = await this.client.listAccessibleCustomers(this.creds.refreshToken);
    return (res.resource_names ?? []) as string[];
  }
}

export function googleAdsGateway(creds: GoogleAdsCredentials): GoogleAdsGateway {
  if (process.env.GOOGLE_ADS_FAKE === "1") return new FakeGoogleAdsGateway(creds);
  return new RealGoogleAdsGateway(creds);
}

// ---------------------------------------------------------------------------
// In-memory fake for tests (supports exactly the query/mutate shapes below)
// ---------------------------------------------------------------------------

interface FakeMetrics {
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

interface FakeCampaign {
  id: string;
  name: string;
  status: string;
  budgetId: string;
  budgetMicros: number | null;
  startDate: string | null;
  endDate: string | null;
  metrics: FakeMetrics;
  removed: boolean;
}

interface FakeAdGroup {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  defaultCpcMicros: number | null;
  metrics: FakeMetrics;
  removed: boolean;
}

interface FakeCriterion {
  id: string;
  adGroupId: string | null;
  campaignId: string;
  text: string;
  matchType: string;
  status: string;
  negative: boolean;
  cpcBidMicros: number | null;
  metrics: FakeMetrics;
  removed: boolean;
}

export interface FakeClick {
  campaignId: string;
  date: string;
  hour: number | null;
  gclid: string;
  adGroupId: string | null;
  criterionId: string | null;
  text: string | null;
  matchType: string | null;
  countryCode: string | null;
}

interface FakeStore {
  campaigns: Map<string, FakeCampaign>;
  adGroups: Map<string, FakeAdGroup>;
  criteria: Map<string, FakeCriterion>;
  countries: Map<string, { code: string; name: string; metrics: FakeMetrics }[]>;
  clicks: FakeClick[];
  nextId: number;
}

const fakeStores = new Map<string, FakeStore>();

function fakeStoreFor(customerId: string): FakeStore {
  let store = fakeStores.get(customerId);
  if (!store) {
    store = {
      campaigns: new Map(),
      adGroups: new Map(),
      criteria: new Map(),
      countries: new Map(),
      clicks: [],
      nextId: 1000,
    };
    fakeStores.set(customerId, store);
  }
  return store;
}

/** Reset fake state (tests only). */
export function resetFakeGoogleAds(customerId?: string): void {
  if (customerId) fakeStores.delete(customerId);
  else fakeStores.clear();
}

const GAQL_ID = /(\w+)\.id\s*=\s*'?(\d+)'?/g;
const GAQL_BETWEEN = /segments\.date\s+BETWEEN\s+'?(\d{8})'?\s+AND\s+'?(\d{8})'?/;

class FakeGoogleAdsGateway implements GoogleAdsGateway {
  private store: FakeStore;
  private customerId: string;

  constructor(creds: GoogleAdsCredentials) {
    this.customerId = creds.customerId;
    this.store = fakeStoreFor(creds.customerId);
  }

  async listAccessibleCustomers(): Promise<string[]> {
    return [`customers/${this.customerId}`];
  }

  private whereIds(gaql: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of gaql.matchAll(GAQL_ID)) out[m[1]] = m[2];
    return out;
  }

  private metricsRow(m: FakeMetrics, days = 1): Record<string, string> {
    return {
      cost_micros: String(Math.round(m.costMicros / days)),
      impressions: String(Math.round(m.impressions / days)),
      clicks: String(Math.round(m.clicks / days)),
      conversions: String(Math.round(m.conversions / days)),
    };
  }

  async query(gaql: string): Promise<any[]> {
    const from = gaql.match(/FROM\s+(\w+)/)?.[1];
    const ids = this.whereIds(gaql);
    const between = gaql.match(GAQL_BETWEEN);
    const onlyActive = /status\s*!=\s*'REMOVED'/.test(gaql);
    const negativeOnly = /\.negative\s*=\s*true/.test(gaql);
    const positiveOnly = /\.negative\s*=\s*false/.test(gaql);
    const withMetrics = /metrics\./.test(gaql);
    const byDay = /SELECT\s+segments\.date/.test(gaql);

    if (from === "customer") return [{ customer: { id: this.customerId, currency_code: "USD" } }];

    if (from === "campaign") {
      const rows: any[] = [];
      for (const c of this.store.campaigns.values()) {
        if (ids["campaign"] && c.id !== ids["campaign"]) continue;
        if (onlyActive && c.removed) continue;
        if (byDay && between) {
          for (const day of eachDayGaql(between[1], between[2])) {
            rows.push({
              campaign: { id: c.id },
              segments: { date: day },
              ...(withMetrics ? { metrics: this.metricsRow(c.metrics, dayCountGaql(between[1], between[2])) } : {}),
            });
          }
          continue;
        }
        rows.push({
          campaign: {
            id: c.id,
            name: c.name,
            status: c.status,
            campaign_budget: `customers/${this.customerId}/campaignBudgets/${c.budgetId}`,
          },
          campaign_budget: { amount_micros: c.budgetMicros != null ? String(c.budgetMicros) : null },
          ...(withMetrics ? { metrics: this.metricsRow(c.metrics) } : {}),
        });
      }
      return rows;
    }

    if (from === "ad_group") {
      const rows: any[] = [];
      for (const g of this.store.adGroups.values()) {
        if (ids["campaign"] && g.campaignId !== ids["campaign"]) continue;
        if (ids["ad_group"] && g.id !== ids["ad_group"]) continue;
        if (onlyActive && g.removed) continue;
        rows.push({
          ad_group: {
            id: g.id,
            name: g.name,
            status: g.status,
            cpc_bid_micros: g.defaultCpcMicros != null ? String(g.defaultCpcMicros) : null,
          },
          campaign: { id: g.campaignId },
          ...(withMetrics ? { metrics: this.metricsRow(g.metrics) } : {}),
        });
      }
      return rows;
    }

    if (from === "ad_group_criterion") {
      const rows: any[] = [];
      for (const k of this.store.criteria.values()) {
        if (k.adGroupId == null) continue;
        if (ids["ad_group"] && k.adGroupId !== ids["ad_group"]) continue;
        if (negativeOnly && !k.negative) continue;
        if (positiveOnly && k.negative) continue;
        if (onlyActive && k.removed) continue;
        rows.push({
          ad_group_criterion: {
            criterion_id: k.id,
            status: k.status,
            negative: k.negative,
            keyword: { text: k.text, match_type: k.matchType },
            cpc_bid_micros: k.cpcBidMicros != null ? String(k.cpcBidMicros) : null,
          },
          ad_group: { id: k.adGroupId },
          ...(withMetrics ? { metrics: this.metricsRow(k.metrics) } : {}),
        });
      }
      return rows;
    }

    if (from === "keyword_view") {
      const rows: any[] = [];
      for (const k of this.store.criteria.values()) {
        if (k.adGroupId == null) continue;
        if (ids["ad_group"] && k.adGroupId !== ids["ad_group"]) continue;
        if (k.negative) continue;
        if (k.removed) continue;
        rows.push({
          keyword_view: {
            resource_name: `customers/${this.customerId}/keywordViews/${k.adGroupId}~${k.id}`,
          },
          ad_group: { id: k.adGroupId },
          metrics: this.metricsRow(k.metrics),
        });
      }
      return rows;
    }

    if (from === "campaign_criterion") {
      const rows: any[] = [];
      for (const k of this.store.criteria.values()) {
        if (k.adGroupId != null) continue;
        if (ids["campaign"] && k.campaignId !== ids["campaign"]) continue;
        if (negativeOnly && !k.negative) continue;
        if (positiveOnly && k.negative) continue;
        if (onlyActive && k.removed) continue;
        rows.push({
          campaign_criterion: {
            criterion_id: k.id,
            status: k.status,
            negative: k.negative,
            keyword: { text: k.text, match_type: k.matchType },
          },
          campaign: { id: k.campaignId },
        });
      }
      return rows;
    }

    if (from === "geographic_view") {
      const list = this.store.countries.get(ids["campaign"] ?? "") ?? [];
      return list.map((c) => ({
        geographic_view: { country_criterion_id: String(geoIdForCountry(c.code)) },
        campaign: { id: ids["campaign"] },
        ...(withMetrics ? { metrics: this.metricsRow(c.metrics) } : {}),
      }));
    }

    if (from === "click_view") {
      const day = gaql.match(/segments\.date\s*=\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
      const withHour = /segments\.hour/.test(gaql);
      return this.store.clicks
        .filter((c) => (!ids["campaign"] || c.campaignId === ids["campaign"]) && (!day || c.date === day))
        .map((c) => ({
          click_view: {
            gclid: c.gclid,
            keyword:
              c.adGroupId && c.criterionId
                ? `customers/${this.customerId}/adGroupCriteria/${c.adGroupId}~${c.criterionId}`
                : "",
            keyword_info: { text: c.text ?? "", match_type: c.matchType ?? "" },
            location_of_presence: {
              country: c.countryCode ? `geoTargetConstants/${geoIdForCountry(c.countryCode)}` : "",
            },
          },
          campaign: { id: c.campaignId },
          segments: { date: c.date, ...(withHour ? { hour: c.hour ?? 0 } : {}) },
        }));
    }

    if (from === "geo_target_constant") {
      const inList = gaql.match(/geo_target_constant\.id\s+IN\s*\(([^)]+)\)/)?.[1] ?? "";
      const want = new Set(inList.split(",").map((s) => s.trim().replace(/'/g, "")));
      const rows: any[] = [];
      for (const list of this.store.countries.values()) {
        for (const c of list) {
          const id = String(geoIdForCountry(c.code));
          if (want.has(id)) rows.push({ geo_target_constant: { id, name: c.name, country_code: c.code } });
        }
      }
      return rows;
    }

    throw new Error(`FakeGoogleAdsGateway: unsupported query: ${gaql.slice(0, 120)}`);
  }

  async mutate(operations: GoogleAdsMutationOperation[]): Promise<string[]> {
    const tempIds = new Map<string, string>();
    const out: string[] = [];
    const resolveTemp = (name: string): string => {
      const m = name.match(/\/(-?\d+)$/);
      if (m && Number(m[1]) < 0) {
        const mapped = tempIds.get(m[1]);
        if (mapped) return name.replace(/\/-?\d+$/, `/${mapped}`);
      }
      return name;
    };
    for (const op of operations) {
      const r = op.resource;
      if (op.entity === "campaign_budget" && op.operation === "create") {
        const id = String(this.store.nextId++);
        tempIds.set(tempKey(r.resource_name), id);
        out.push(`customers/${this.customerId}/campaignBudgets/${id}`);
        continue;
      }
      if (op.entity === "campaign_budget" && op.operation === "update") {
        const id = resourceId(r.resource_name);
        for (const c of this.store.campaigns.values()) {
          if (c.budgetId === id && r.amount_micros != null) c.budgetMicros = Number(r.amount_micros);
        }
        out.push(r.resource_name);
        continue;
      }
      if (op.entity === "campaign" && op.operation === "create") {
        const id = String(this.store.nextId++);
        tempIds.set(tempKey(r.resource_name), id);
        const budgetName = resolveTemp(String(r.campaign_budget ?? ""));
        this.store.campaigns.set(id, {
          id,
          name: String(r.name ?? ""),
          status: r.status != null ? campaignStatusName(r.status) : "PAUSED",
          budgetId: resourceId(budgetName),
          budgetMicros: opBudgetAmount(operations, r.campaign_budget),
          startDate: r.start_date ? String(r.start_date) : null,
          endDate: r.end_date ? String(r.end_date) : null,
          metrics: blankMetrics(),
          removed: false,
        });
        out.push(`customers/${this.customerId}/campaigns/${id}`);
        continue;
      }
      if (op.entity === "campaign" && op.operation === "update") {
        const c = this.store.campaigns.get(resourceId(r.resource_name));
        if (!c || c.removed) throw new Error(`FakeGoogleAdsGateway: campaign not found: ${r.resource_name}`);
        if (r.name != null) c.name = String(r.name);
        if (r.status != null) c.status = campaignStatusName(r.status);
        if (r.start_date != null) c.startDate = String(r.start_date);
        if (r.end_date != null) c.endDate = String(r.end_date);
        out.push(r.resource_name);
        continue;
      }
      if (op.entity === "campaign" && op.operation === "remove") {
        const c = this.store.campaigns.get(resourceId(r.resource_name));
        if (!c || c.removed) throw new Error(`FakeGoogleAdsGateway: campaign not found: ${r.resource_name}`);
        c.removed = true;
        out.push(r.resource_name);
        continue;
      }
      if (op.entity === "ad_group" && op.operation === "create") {
        const id = String(this.store.nextId++);
        tempIds.set(tempKey(r.resource_name), id);
        const campaignName = resolveTemp(String(r.campaign ?? ""));
        const campaignId = resourceId(campaignName);
        this.store.adGroups.set(id, {
          id,
          campaignId,
          name: String(r.name ?? ""),
          status: r.status != null ? adGroupStatusName(r.status) : "ENABLED",
          defaultCpcMicros: r.cpc_bid_micros != null ? Number(r.cpc_bid_micros) : null,
          metrics: blankMetrics(),
          removed: false,
        });
        out.push(`customers/${this.customerId}/adGroups/${id}`);
        continue;
      }
      if (op.entity === "ad_group" && op.operation === "update") {
        const g = this.store.adGroups.get(resourceId(r.resource_name));
        if (!g || g.removed) throw new Error(`FakeGoogleAdsGateway: ad group not found: ${r.resource_name}`);
        if (r.name != null) g.name = String(r.name);
        if (r.status != null) g.status = adGroupStatusName(r.status);
        if (r.cpc_bid_micros != null) g.defaultCpcMicros = Number(r.cpc_bid_micros);
        out.push(r.resource_name);
        continue;
      }
      if (op.entity === "ad_group" && op.operation === "remove") {
        const g = this.store.adGroups.get(resourceId(r.resource_name));
        if (!g || g.removed) throw new Error(`FakeGoogleAdsGateway: ad group not found: ${r.resource_name}`);
        g.removed = true;
        for (const k of this.store.criteria.values()) {
          if (k.adGroupId === g.id) k.removed = true;
        }
        out.push(r.resource_name);
        continue;
      }
      if ((op.entity === "ad_group_criterion" || op.entity === "campaign_criterion") && op.operation === "create") {
        const id = String(this.store.nextId++);
        const negative = r.negative === true;
        const kw = r.keyword ?? {};
        if (op.entity === "ad_group_criterion") {
          const adGroupName = resolveTemp(String(r.ad_group ?? ""));
          const adGroupId = resourceId(adGroupName);
          const g = this.store.adGroups.get(adGroupId);
          this.store.criteria.set(`ag:${adGroupId}:${id}`, {
            id,
            adGroupId,
            campaignId: g?.campaignId ?? "",
            text: String(kw.text ?? ""),
            matchType: matchTypeName(kw.match_type ?? "BROAD"),
            status: r.status != null ? criterionStatusName(r.status) : "ENABLED",
            negative,
            cpcBidMicros: r.cpc_bid_micros != null ? Number(r.cpc_bid_micros) : null,
            metrics: blankMetrics(),
            removed: false,
          });
          out.push(`customers/${this.customerId}/adGroupCriteria/${adGroupId}~${id}`);
        } else {
          const campaignName = resolveTemp(String(r.campaign ?? ""));
          const campaignId = resourceId(campaignName);
          this.store.criteria.set(`c:${campaignId}:${id}`, {
            id,
            adGroupId: null,
            campaignId,
            text: String(kw.text ?? ""),
            matchType: matchTypeName(kw.match_type ?? "BROAD"),
            status: r.status != null ? criterionStatusName(r.status) : "ENABLED",
            negative,
            cpcBidMicros: null,
            metrics: blankMetrics(),
            removed: false,
          });
          out.push(`customers/${this.customerId}/campaignCriteria/${campaignId}~${id}`);
        }
        continue;
      }
      if (op.entity === "ad_group_criterion" && op.operation === "update") {
        const k = this.findCriterion(r.resource_name);
        if (!k) throw new Error(`FakeGoogleAdsGateway: criterion not found: ${r.resource_name}`);
        if (r.status != null) k.status = criterionStatusName(r.status);
        if (r.cpc_bid_micros != null) k.cpcBidMicros = Number(r.cpc_bid_micros);
        out.push(r.resource_name);
        continue;
      }
      if ((op.entity === "ad_group_criterion" || op.entity === "campaign_criterion") && op.operation === "remove") {
        const k = this.findCriterion(r.resource_name);
        if (!k) throw new Error(`FakeGoogleAdsGateway: criterion not found: ${r.resource_name}`);
        k.removed = true;
        out.push(r.resource_name);
        continue;
      }
      throw new Error(`FakeGoogleAdsGateway: unsupported mutation ${op.entity} ${op.operation}`);
    }
    return out;
  }

  private findCriterion(resourceName: string): FakeCriterion | undefined {
    const m = String(resourceName).match(/~(\d+)$/);
    if (!m) return undefined;
    for (const k of this.store.criteria.values()) {
      if (k.id === m[1] && !k.removed) return k;
    }
    return undefined;
  }
}

function blankMetrics(): FakeMetrics {
  return { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
}

function resourceId(resourceName: string): string {
  return String(resourceName).split("/").pop() ?? "";
}

function tempKey(resourceName: string): string {
  return String(resourceName).split("/").pop() ?? "";
}

/** Translate numeric enum values (as sent via the client) back to names. */
function enumName(map: Record<string, unknown>, value: unknown): string {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const name = map[String(Number(value))];
    if (typeof name === "string") return name;
  }
  return String(value ?? "");
}

const campaignStatusName = (v: unknown) => enumName(E.CampaignStatus as Record<string, unknown>, v);
const adGroupStatusName = (v: unknown) => enumName(E.AdGroupStatus as Record<string, unknown>, v);
const criterionStatusName = (v: unknown) => enumName(E.AdGroupCriterionStatus as Record<string, unknown>, v);
const matchTypeName = (v: unknown) => enumName(E.KeywordMatchType as Record<string, unknown>, v);

function opBudgetAmount(operations: GoogleAdsMutationOperation[], budgetName: string): number | null {
  const key = tempKey(String(budgetName ?? ""));
  const op = operations.find(
    (o) => o.entity === "campaign_budget" && o.operation === "create" && tempKey(String(o.resource.resource_name)) === key,
  );
  return op?.resource.amount_micros != null ? Number(op.resource.amount_micros) : null;
}

function eachDayGaql(from: string, to: string): string[] {
  const days: string[] = [];
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(4, 6)) - 1, Number(to.slice(6, 8)));
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

function dayCountGaql(from: string, to: string): number {
  return Math.max(1, eachDayGaql(from, to).length);
}

const GEO_IDS: Record<string, number> = { US: 2840, CA: 2124, GB: 2826, AU: 2036, DE: 2276, AT: 2040, FR: 2250 };

function geoIdForCountry(code: string): number {
  return GEO_IDS[code] ?? 9999;
}

/** Query the account currency (metrics are reported in it). */
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
      status: String(c.status ?? ""),
      dailyBudget:
        row.campaign_budget?.amount_micros != null ? Number(row.campaign_budget.amount_micros) / 1_000_000 : null,
      currency,
      ...statsFromMetrics(byId.get(String(c.id)) ?? {}),
    };
  });
}

export interface GoogleAdsAdGroupWithKeywords extends GoogleAdsAdGroup {
  keywords: GoogleAdsKeyword[];
}

/** Light ad-group list (no metrics, no keywords) for negatives overviews. */
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
      status: String(g.status ?? ""),
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
        status: String(g.status ?? ""),
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
    // Metrics are incompatible with FROM ad_group_criterion — keyword stats live on keyword_view.
    gw.query(
      "SELECT keyword_view.resource_name, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
        `FROM keyword_view WHERE ad_group.id = ${adGroupId} ` +
        `AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}'`,
    ),
    currency ?? getGoogleAdsCurrency(creds),
  ]);
  const metricsById = new Map<string, any>();
  // keyword_view resource names look like customers/{cid}/keywordViews/{adGroupId}~{criterionId}.
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
      matchType: String(k.keyword?.match_type ?? ""),
      status: String(k.status ?? ""),
      cpcBid: k.cpc_bid_micros != null ? Number(k.cpc_bid_micros) / 1_000_000 : null,
      currency: ccy,
      ...statsFromMetrics(metricsById.get(id) ?? {}),
    };
  });
}

export async function getGoogleAdsCampaignDailySpend(
  creds: GoogleAdsCredentials,
  campaignId: string,
  range: GoogleAdsReportRange = resolveGoogleAdsRange({}),
): Promise<{ date: string; spend: number }[]> {
  const gw = googleAdsGateway(creds);
  const rows = await gw.query(
    "SELECT segments.date, campaign.id, metrics.cost_micros " +
      `FROM campaign WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${toGaqlDate(range.startDate)}' AND '${toGaqlDate(range.endDate)}' ORDER BY segments.date`,
  );
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = String(row.segments?.date ?? "").slice(0, 10);
    if (day) byDay.set(day, num(row.metrics?.cost_micros) / 1_000_000);
  }
  const days: { date: string; spend: number }[] = [];
  for (
    let t = Date.parse(`${range.startDate}T00:00:00Z`);
    t <= Date.parse(`${range.endDate}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push({ date, spend: byDay.get(date) ?? 0 });
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

export interface GoogleAdsClick {
  gclid: string;
  date: string;
  hour: number | null;
  campaignId: string;
  adGroupId: string | null;
  criterionId: string | null;
  keywordText: string | null;
  matchType: string | null;
  countryCode: string | null;
}

/** Per-click rows for one day. click_view queries must be limited to a single
 * day and only go 90 days back. Falls back to date precision when the API
 * rejects segments.hour. */
export async function listGoogleAdsClicks(
  creds: GoogleAdsCredentials,
  campaignId: string,
  date: string,
): Promise<GoogleAdsClick[]> {
  const gw = googleAdsGateway(creds);
  const select =
    "click_view.gclid, click_view.keyword, click_view.keyword_info.text, click_view.keyword_info.match_type, " +
    "click_view.location_of_presence.country, campaign.id, segments.date";
  const where = `FROM click_view WHERE campaign.id = ${campaignId} AND segments.date = '${date}'`;
  let rows: any[];
  try {
    rows = await gw.query(`SELECT ${select}, segments.hour ${where}`);
  } catch (err: any) {
    if (!/hour/i.test(googleAdsErrorMessage(err, ""))) throw err;
    rows = await gw.query(`SELECT ${select} ${where}`);
  }

  const geoIds = [
    ...new Set(
      rows
        .map((r) => String(r.click_view?.location_of_presence?.country ?? "").split("/").pop())
        .filter((id) => /^\d+$/.test(id ?? "")),
    ),
  ];
  let codes = new Map<string, string>();
  if (geoIds.length > 0) {
    const geoRows = await gw.query(
      "SELECT geo_target_constant.id, geo_target_constant.country_code " +
        `FROM geo_target_constant WHERE geo_target_constant.id IN (${geoIds.join(",")})`,
    );
    codes = new Map(
      geoRows.map((r) => [
        String(r.geo_target_constant?.id),
        String(r.geo_target_constant?.country_code ?? ""),
      ]),
    );
  }

  return rows.map((row) => {
    const cv = row.click_view ?? {};
    const parts = String(cv.keyword ?? "").split("~");
    const geoId = String(cv.location_of_presence?.country ?? "").split("/").pop() ?? "";
    return {
      gclid: String(cv.gclid ?? ""),
      date: String(row.segments?.date ?? date).slice(0, 10),
      hour: row.segments?.hour != null && row.segments.hour !== "" ? Number(row.segments.hour) : null,
      campaignId: String(campaignId),
      adGroupId: parts.length === 2 ? parts[0].split("/").pop()! : null,
      criterionId: parts.length === 2 ? parts[1] : null,
      keywordText: cv.keyword_info?.text != null && cv.keyword_info.text !== "" ? String(cv.keyword_info.text) : null,
      matchType:
        cv.keyword_info?.match_type != null && cv.keyword_info.match_type !== ""
          ? String(cv.keyword_info.match_type)
          : null,
      countryCode: codes.get(geoId) || null,
    };
  });
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
        matchType: String(k.keyword?.match_type ?? ""),
        status: String(k.status ?? ""),
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
      matchType: String(k.keyword?.match_type ?? ""),
      status: String(k.status ?? ""),
    };
  });
}

// ---------------------------------------------------------------------------
// Validation + creation
// ---------------------------------------------------------------------------

export type GoogleAdsKeywordMatchType = "EXACT" | "PHRASE" | "BROAD";

export interface GoogleAdsCreateKeywordInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
  bidAmount: number;
}

export interface GoogleAdsCreateNegativeInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
}

export interface GoogleAdsCreateAdGroupInput {
  name: string;
  defaultBidAmount: number;
  status: "ENABLED" | "PAUSED";
  keywords: GoogleAdsCreateKeywordInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
}

export interface GoogleAdsCreateCampaignInput {
  name: string;
  dailyBudgetAmount: number;
  currency?: string;
  status: "ENABLED" | "PAUSED";
  startDate?: string;
  endDate?: string;
  adGroups: GoogleAdsCreateAdGroupInput[];
  negativeKeywords?: GoogleAdsCreateNegativeInput[];
}

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;

function asPositiveNumber(value: unknown, label: string): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive number`);
  return n;
}

function asMatchType(value: unknown, label: string): GoogleAdsKeywordMatchType {
  const upper = String(value ?? "").toUpperCase();
  if (!(MATCH_TYPES as readonly string[]).includes(upper)) {
    throw new Error(`${label} must be one of EXACT, PHRASE, BROAD`);
  }
  return upper as GoogleAdsKeywordMatchType;
}

function asDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }
  return value;
}

/** Single shared validator for REST + MCP creation input. */
export function validateGoogleAdsCreateCampaignInput(body: any): GoogleAdsCreateCampaignInput {
  if (!body || typeof body !== "object") throw new Error("Request body must be an object");
  const name = String(body.name ?? "").trim();
  if (!name) throw new Error("name is required");
  if (!Array.isArray(body.adGroups) || body.adGroups.length === 0) throw new Error("At least one ad group is required");
  const status = body.status == null ? "PAUSED" : String(body.status).toUpperCase();
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error('status must be "ENABLED" or "PAUSED"');

  const keywordsOf = (list: any, label: string): GoogleAdsCreateKeywordInput[] => {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`${label} needs at least one keyword`);
    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} keyword ${i + 1}: text is required`);
      return { text, matchType: asMatchType(k?.matchType, `${label} keyword ${i + 1} matchType`), bidAmount: asPositiveNumber(k?.bidAmount, `${label} keyword ${i + 1} bidAmount`) };
    });
  };
  const negativesOf = (list: any, label: string): GoogleAdsCreateNegativeInput[] => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new Error(`${label} negativeKeywords must be an array`);
    return list.map((k: any, i: number) => {
      const text = String(k?.text ?? "").trim();
      if (!text) throw new Error(`${label} negative keyword ${i + 1}: text is required`);
      return { text, matchType: asMatchType(k?.matchType, `${label} negative keyword ${i + 1} matchType`) };
    });
  };

  return {
    name,
    dailyBudgetAmount: asPositiveNumber(body.dailyBudgetAmount, "dailyBudgetAmount"),
    currency: body.currency != null ? String(body.currency).toUpperCase() : undefined,
    status: status as "ENABLED" | "PAUSED",
    startDate: body.startDate != null ? asDate(body.startDate, "startDate") : undefined,
    endDate: body.endDate != null ? asDate(body.endDate, "endDate") : undefined,
    adGroups: body.adGroups.map((g: any, i: number) => {
      const label = `Ad group ${i + 1}`;
      const groupName = String(g?.name ?? "").trim();
      if (!groupName) throw new Error(`${label}: name is required`);
      const groupStatus = g?.status == null ? "ENABLED" : String(g.status).toUpperCase();
      if (groupStatus !== "ENABLED" && groupStatus !== "PAUSED") {
        throw new Error(`${label}: status must be "ENABLED" or "PAUSED"`);
      }
      return {
        name: groupName,
        defaultBidAmount: asPositiveNumber(g?.defaultBidAmount, `${label} defaultBidAmount`),
        status: groupStatus as "ENABLED" | "PAUSED",
        keywords: keywordsOf(g?.keywords, label),
        negativeKeywords: negativesOf(g?.negativeKeywords, label),
      };
    }),
    negativeKeywords: negativesOf(body.negativeKeywords, "Campaign"),
  };
}

export interface GoogleAdsCreatedCampaign {
  id: string;
  name: string;
  status: string;
  budgetResourceName: string;
  adGroups: { id: string; name: string; keywords: { id: string; text: string }[] }[];
}

/** Create budget + campaign + ad groups + keywords + negatives. New campaigns
 * start PAUSED by default; campaigns need responsive search ads (added in the
 * Google UI) before they can serve. */
export async function createGoogleAdsCampaignFull(
  creds: GoogleAdsCredentials,
  input: GoogleAdsCreateCampaignInput,
): Promise<GoogleAdsCreatedCampaign> {
  const gw = googleAdsGateway(creds);
  const customerId = creds.customerId;
  const budgetTemp = ResourceNames.campaignBudget(customerId, "-1");
  const campaignTemp = ResourceNames.campaign(customerId, "-2");

  const header: GoogleAdsMutationOperation[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetTemp,
        name: `${input.name} budget`,
        delivery_method: E.BudgetDeliveryMethod.STANDARD,
        amount_micros: toMicros(input.dailyBudgetAmount),
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignTemp,
        name: input.name,
        advertising_channel_type: E.AdvertisingChannelType.SEARCH,
        status: E.CampaignStatus[input.status],
        manual_cpc: { enhanced_cpc_enabled: false },
        campaign_budget: budgetTemp,
        network_settings: { target_google_search: true, target_search_network: true },
        ...(input.startDate ? { start_date: input.startDate.replace(/-/g, "") } : {}),
        ...(input.endDate ? { end_date: input.endDate.replace(/-/g, "") } : {}),
      },
    },
  ];
  const [budgetName, campaignName] = await gw.mutate(header);
  const campaignId = campaignName.split("/").pop()!;

  const adGroups: GoogleAdsCreatedCampaign["adGroups"] = [];
  let tempCounter = -3;
  for (const group of input.adGroups) {
    const groupTemp = ResourceNames.adGroup(customerId, String(tempCounter--));
    const [groupName] = await gw.mutate([
      {
        entity: "ad_group",
        operation: "create",
        resource: {
          resource_name: groupTemp,
          name: group.name,
          status: E.AdGroupStatus[group.status ?? "ENABLED"],
          campaign: campaignName,
          cpc_bid_micros: toMicros(group.defaultBidAmount),
        },
      },
    ]);
    const adGroupId = groupName.split("/").pop()!;
    const keywordOps: GoogleAdsMutationOperation[] = group.keywords.map((k) => ({
      entity: "ad_group_criterion",
      operation: "create",
      resource: {
        ad_group: groupName,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        status: E.AdGroupCriterionStatus.ENABLED,
        cpc_bid_micros: toMicros(k.bidAmount),
      },
    }));
    const keywordNames = keywordOps.length > 0 ? await gw.mutate(keywordOps) : [];
    if ((group.negativeKeywords ?? []).length > 0) {
      await gw.mutate(
        group.negativeKeywords!.map((k) => ({
          entity: "ad_group_criterion",
          operation: "create",
          resource: {
            ad_group: groupName,
            negative: true,
            keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
          },
        })),
      );
    }
    adGroups.push({
      id: adGroupId,
      name: group.name,
      keywords: keywordNames.map((n, i) => ({ id: n.split("~").pop()!, text: group.keywords[i].text })),
    });
  }

  if ((input.negativeKeywords ?? []).length > 0) {
    await gw.mutate(
      input.negativeKeywords!.map((k) => ({
        entity: "campaign_criterion",
        operation: "create",
        resource: {
          campaign: campaignName,
          negative: true,
          keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        },
      })),
    );
  }

  return { id: campaignId, name: input.name, status: input.status, budgetResourceName: budgetName, adGroups };
}

// ---------------------------------------------------------------------------
// Updates + deletes
// ---------------------------------------------------------------------------

export async function updateGoogleAdsCampaignStatus(
  creds: GoogleAdsCredentials,
  campaignId: string,
  status: "ENABLED" | "PAUSED",
): Promise<{ id: string; status: string }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    {
      entity: "campaign",
      operation: "update",
      resource: {
        resource_name: ResourceNames.campaign(creds.customerId, campaignId),
        status: E.CampaignStatus[status],
      },
    },
  ]);
  return { id: campaignId, status };
}

export async function deleteGoogleAdsCampaign(
  creds: GoogleAdsCredentials,
  campaignId: string,
): Promise<{ id: string; deleted: boolean }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    { entity: "campaign", operation: "remove", resource: { resource_name: ResourceNames.campaign(creds.customerId, campaignId) } },
  ]);
  return { id: campaignId, deleted: true };
}

export async function updateGoogleAdsCampaign(
  creds: GoogleAdsCredentials,
  campaignId: string,
  patch: { name?: string; status?: "ENABLED" | "PAUSED"; dailyBudgetAmount?: number; startDate?: string; endDate?: string },
): Promise<{ id: string }> {
  if (Object.values(patch).every((v) => v == null)) throw new Error("Nothing to update: pass at least one field");
  const gw = googleAdsGateway(creds);
  const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
  if (patch.dailyBudgetAmount != null) {
    const rows = await gw.query(
      `SELECT campaign.id, campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
    );
    const budgetName = String(rows[0]?.campaign?.campaign_budget ?? "");
    if (!budgetName) throw new Error(`Campaign ${campaignId} has no budget to update`);
    await gw.mutate([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: { resource_name: budgetName, amount_micros: toMicros(patch.dailyBudgetAmount) },
      },
    ]);
  }
  const resource: Record<string, any> = { resource_name: campaignName };
  if (patch.name != null) resource.name = patch.name;
  if (patch.status != null) resource.status = E.CampaignStatus[patch.status];
  if (patch.startDate != null) resource.start_date = patch.startDate.replace(/-/g, "");
  if (patch.endDate != null) resource.end_date = patch.endDate.replace(/-/g, "");
  if (Object.keys(resource).length > 1) {
    await gw.mutate([{ entity: "campaign", operation: "update", resource }]);
  }
  return { id: campaignId };
}

export async function createGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  input: { name: string; defaultBidAmount: number; status?: "ENABLED" | "PAUSED" },
): Promise<{ id: string; name: string }> {
  const gw = googleAdsGateway(creds);
  const [name] = await gw.mutate([
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        name: input.name,
        status: E.AdGroupStatus[input.status ?? "ENABLED"],
        campaign: ResourceNames.campaign(creds.customerId, campaignId),
        cpc_bid_micros: toMicros(input.defaultBidAmount),
      },
    },
  ]);
  return { id: name.split("/").pop()!, name: input.name };
}

export async function updateGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  patch: { name?: string; status?: "ENABLED" | "PAUSED"; defaultBidAmount?: number },
): Promise<{ id: string }> {
  if (Object.values(patch).every((v) => v == null)) throw new Error("Nothing to update: pass at least one field");
  const gw = googleAdsGateway(creds);
  const resource: Record<string, any> = { resource_name: ResourceNames.adGroup(creds.customerId, adGroupId) };
  if (patch.name != null) resource.name = patch.name;
  if (patch.status != null) resource.status = E.AdGroupStatus[patch.status];
  if (patch.defaultBidAmount != null) resource.cpc_bid_micros = toMicros(patch.defaultBidAmount);
  await gw.mutate([{ entity: "ad_group", operation: "update", resource }]);
  return { id: adGroupId };
}

export async function deleteGoogleAdsAdGroup(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
): Promise<{ id: string; deleted: boolean }> {
  const gw = googleAdsGateway(creds);
  await gw.mutate([
    { entity: "ad_group", operation: "remove", resource: { resource_name: ResourceNames.adGroup(creds.customerId, adGroupId) } },
  ]);
  return { id: adGroupId, deleted: true };
}

export interface GoogleAdsAddKeywordInput {
  text: string;
  matchType: GoogleAdsKeywordMatchType;
  bidAmount?: number;
  status?: "ENABLED" | "PAUSED";
}

export async function addGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywords: GoogleAdsAddKeywordInput[],
): Promise<{ id: string; text: string }[]> {
  const gw = googleAdsGateway(creds);
  const groupName = ResourceNames.adGroup(creds.customerId, adGroupId);
  const names = await gw.mutate(
    keywords.map((k) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: groupName,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        status: E.AdGroupCriterionStatus[k.status ?? "ENABLED"],
        ...(k.bidAmount != null ? { cpc_bid_micros: toMicros(k.bidAmount) } : {}),
      },
    })),
  );
  return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
}

export interface GoogleAdsUpdateKeywordInput {
  keywordId: string;
  bidAmount?: number;
  status?: "ENABLED" | "PAUSED";
}

export async function updateGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  updates: GoogleAdsUpdateKeywordInput[],
): Promise<{ id: string; text: string; bidAmount: number | null; status: string | null; previousBidAmount: number | null; previousStatus: string | null }[]> {
  const existing = await listGoogleAdsKeywords(creds, campaignId, adGroupId);
  const byId = new Map(existing.map((k) => [k.id, k]));
  for (const u of updates) {
    if (!byId.has(String(u.keywordId))) throw new Error(`Keyword ${u.keywordId} not found in ad group ${adGroupId}`);
    if (u.bidAmount == null && u.status == null) throw new Error(`Keyword ${u.keywordId}: nothing to update`);
  }
  const gw = googleAdsGateway(creds);
  await gw.mutate(
    updates.map((u) => ({
      entity: "ad_group_criterion" as const,
      operation: "update" as const,
      resource: {
        resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, u.keywordId),
        ...(u.status != null ? { status: E.AdGroupCriterionStatus[u.status] } : {}),
        ...(u.bidAmount != null ? { cpc_bid_micros: toMicros(u.bidAmount) } : {}),
      },
    })),
  );
  return updates.map((u) => {
    const known = byId.get(String(u.keywordId))!;
    return {
      id: String(u.keywordId),
      text: known.text,
      bidAmount: u.bidAmount ?? null,
      status: u.status ?? null,
      previousBidAmount: known.cpcBid,
      previousStatus: known.status,
    };
  });
}

export async function deleteGoogleAdsKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string,
  keywordIds: (string | number)[],
): Promise<number> {
  const gw = googleAdsGateway(creds);
  await gw.mutate(
    keywordIds.map((id) => ({
      entity: "ad_group_criterion" as const,
      operation: "remove" as const,
      resource: { resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id) },
    })),
  );
  return keywordIds.length;
}

export async function addGoogleAdsNegativeKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null,
  keywords: GoogleAdsCreateNegativeInput[],
): Promise<{ id: string; text: string }[]> {
  const gw = googleAdsGateway(creds);
  if (adGroupId) {
    const groupName = ResourceNames.adGroup(creds.customerId, adGroupId);
    const names = await gw.mutate(
      keywords.map((k) => ({
        entity: "ad_group_criterion" as const,
        operation: "create" as const,
        resource: {
          ad_group: groupName,
          negative: true,
          keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
        },
      })),
    );
    return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
  }
  const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
  const names = await gw.mutate(
    keywords.map((k) => ({
      entity: "campaign_criterion" as const,
      operation: "create" as const,
      resource: {
        campaign: campaignName,
        negative: true,
        keyword: { text: k.text, match_type: E.KeywordMatchType[k.matchType] },
      },
    })),
  );
  return names.map((n, i) => ({ id: n.split("~").pop()!, text: keywords[i].text }));
}

export async function deleteGoogleAdsNegativeKeywords(
  creds: GoogleAdsCredentials,
  campaignId: string,
  adGroupId: string | null,
  ids: (string | number)[],
): Promise<number> {
  const gw = googleAdsGateway(creds);
  if (adGroupId) {
    await gw.mutate(
      ids.map((id) => ({
        entity: "ad_group_criterion" as const,
        operation: "remove" as const,
        resource: { resource_name: ResourceNames.adGroupCriterion(creds.customerId, adGroupId, id) },
      })),
    );
  } else {
    const campaignName = ResourceNames.campaign(creds.customerId, campaignId);
    await gw.mutate(
      ids.map((id) => ({
        entity: "campaign_criterion" as const,
        operation: "remove" as const,
        resource: { resource_name: `${campaignName}/campaignCriteria/${campaignId}~${id}` },
      })),
    );
  }
  return ids.length;
}

/** Seed deterministic metrics (tests only). */
export function seedFakeGoogleAdsMetrics(
  customerId: string,
  seed: {
    campaigns?: Record<string, Partial<FakeMetrics>>;
    adGroups?: Record<string, Partial<FakeMetrics>>;
    criteria?: Record<string, Partial<FakeMetrics>>;
    countries?: Record<string, { code: string; name: string; metrics: Partial<FakeMetrics> }[]>;
    clicks?: FakeClick[];
  },
): void {
  const store = fakeStoreFor(customerId);
  for (const [id, m] of Object.entries(seed.campaigns ?? {})) {
    const c = store.campaigns.get(id);
    if (c) c.metrics = { ...blankMetrics(), ...m };
  }
  for (const [id, m] of Object.entries(seed.adGroups ?? {})) {
    const g = store.adGroups.get(id);
    if (g) g.metrics = { ...blankMetrics(), ...m };
  }
  for (const [key, m] of Object.entries(seed.criteria ?? {})) {
    for (const [storeKey, k] of store.criteria) {
      if (storeKey.endsWith(`:${key}`)) k.metrics = { ...blankMetrics(), ...m };
    }
  }
  for (const [campaignId, list] of Object.entries(seed.countries ?? {})) {
    store.countries.set(
      campaignId,
      list.map((c) => ({ code: c.code, name: c.name, metrics: { ...blankMetrics(), ...c.metrics } })),
    );
  }
  if (seed.clicks) store.clicks.push(...seed.clicks);
}
