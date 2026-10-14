import { enums } from "google-ads-api";
import type { GoogleAdsCredentials, GoogleAdsGateway, GoogleAdsMutationOperation } from "./google-ads-types";

const E: any = enums;

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
  locationId: string | null;
  languageId: string | null;
}

interface FakeStore {
  campaigns: Map<string, FakeCampaign>;
  adGroups: Map<string, FakeAdGroup>;
  criteria: Map<string, FakeCriterion>;
  countries: Map<string, { code: string; name: string; metrics: FakeMetrics }[]>;
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
      nextId: 1000,
    };
    fakeStores.set(customerId, store);
  }

  return store;
}

export function resetFakeGoogleAds(customerId?: string): void {
  if (customerId) fakeStores.delete(customerId);
  else fakeStores.clear();
}

const GAQL_ID = /(\w+)\.id\s*=\s*'?(\d+)'?/g;
const GAQL_BETWEEN = /segments\.date\s+BETWEEN\s+'?(\d{8})'?\s+AND\s+'?(\d{8})'?/;

export class FakeGoogleAdsGateway implements GoogleAdsGateway {
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
      cost_micros: perDay(m.costMicros, days),
      impressions: perDay(m.impressions, days),
      clicks: perDay(m.clicks, days),
      conversions: perDay(m.conversions, days),
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
            ...(k.locationId ? { location: { geo_target_constant: `geoTargetConstants/${k.locationId}` } } : {}),
            ...(k.languageId ? { language: { language_constant: `languageConstants/${k.languageId}` } } : {}),
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
      const r: any = op.resource;
      const removeName = typeof r === "string" ? r : String(r.resource_name ?? "");

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
        if (r.contains_eu_political_advertising == null) {
          throw new Error(
            "FakeGoogleAdsGateway: EU_POLITICAL_ADVERTISING_DECLARATION_REQUIRED (campaign create needs contains_eu_political_advertising)",
          );
        }
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
        const c = this.store.campaigns.get(resourceId(removeName));
        if (!c || c.removed) throw new Error(`FakeGoogleAdsGateway: campaign not found: ${removeName}`);

        c.removed = true;
        out.push(removeName);
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
        const g = this.store.adGroups.get(resourceId(removeName));
        if (!g || g.removed) throw new Error(`FakeGoogleAdsGateway: ad group not found: ${removeName}`);

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
            locationId: null,
            languageId: null,
          });

          out.push(`customers/${this.customerId}/adGroupCriteria/${adGroupId}~${id}`);
        } else {
          const campaignName = resolveTemp(String(r.campaign ?? ""));
          const campaignId = resourceId(campaignName);

          const locationId = String(r.location?.geo_target_constant ?? "").split("/").pop() || null;
          const languageId = String(r.language?.language_constant ?? "").split("/").pop() || null;
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
            locationId,
            languageId,
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
        const k = this.findCriterion(removeName);
        if (!k) throw new Error(`FakeGoogleAdsGateway: criterion not found: ${removeName}`);

        k.removed = true;
        out.push(removeName);
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

function perDay(total: number, days: number): string {
  return String(Math.round(total / days));
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
    (o) =>
      o.entity === "campaign_budget" &&
      o.operation === "create" &&
      typeof o.resource === "object" &&
      tempKey(String(o.resource.resource_name)) === key,
  );
  const res = op?.resource;

  return typeof res === "object" && res?.amount_micros != null ? Number(res.amount_micros) : null;
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

export function seedFakeGoogleAdsMetrics(
  customerId: string,
  seed: {
    campaigns?: Record<string, Partial<FakeMetrics>>;
    adGroups?: Record<string, Partial<FakeMetrics>>;
    criteria?: Record<string, Partial<FakeMetrics>>;
    countries?: Record<string, { code: string; name: string; metrics: Partial<FakeMetrics> }[]>;
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
}
