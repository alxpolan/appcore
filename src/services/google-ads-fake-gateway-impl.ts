import { enums } from "google-ads-api";
import type { GoogleAdsCredentials, GoogleAdsGateway, GoogleAdsMutationOperation } from "./google-ads-types";
import type { FakeCriterion, FakeMetrics, FakeStore } from "./google-ads-fake-store";
import { blankMetrics, fakeStoreFor } from "./google-ads-fake-store";
import {
  adGroupStatusName,
  biddingNumbersOf,
  biddingStrategyName,
  campaignStatusName,
  criterionStatusName,
  dayCountGaql,
  eachDayGaql,
  geoIdForCountry,
  hasBiddingResource,
  matchTypeName,
  opBudgetAmount,
  perDay,
  resourceId,
  tempKey,
} from "./google-ads-fake-gateway-helpers";

const E: any = enums;

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
            bidding_strategy_type: c.biddingStrategy === "MAXIMIZE_CLICKS" ? "TARGET_SPEND" : c.biddingStrategy,
            target_spend: {
              cpc_bid_ceiling_micros:
                c.biddingCeilingMicros != null ? String(c.biddingCeilingMicros) : null,
            },
            maximize_conversions: {
              cpc_bid_ceiling_micros:
                c.biddingCeilingMicros != null ? String(c.biddingCeilingMicros) : null,
              target_cpa_micros:
                c.biddingTargetCpaMicros != null ? String(c.biddingTargetCpaMicros) : null,
            },
            target_cpa: {
              cpc_bid_ceiling_micros:
                c.biddingCeilingMicros != null ? String(c.biddingCeilingMicros) : null,
              target_cpa_micros:
                c.biddingTargetCpaMicros != null ? String(c.biddingTargetCpaMicros) : null,
            },
            target_roas: {
              target_roas: c.biddingTargetRoas != null ? String(c.biddingTargetRoas) : null,
              cpc_bid_ceiling_micros:
                c.biddingCeilingMicros != null ? String(c.biddingCeilingMicros) : null,
            },
          },
          campaign_budget: {
            amount_micros: c.budgetMicros != null ? String(c.budgetMicros) : null,
            explicitly_shared: false,
          },
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

    if (from === "search_term_view") return [];

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

      if (op.entity === "campaign_budget" && op.operation === "remove") {
        throw new Error("FakeGoogleAdsGateway: campaign budget removal is not supported");
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
          biddingStrategy: biddingStrategyName(r),
          ...biddingNumbersOf(r),
          displayNetwork: r.network_settings?.target_content_network === true,
          searchPartners: r.network_settings?.target_search_network !== false,
          presenceOnly:
            r.geo_target_type_setting?.positive_geo_target_type == null ||
            r.geo_target_type_setting.positive_geo_target_type === E.PositiveGeoTargetType.PRESENCE,
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

        if (r.network_settings?.target_content_network != null) {
          c.displayNetwork = r.network_settings.target_content_network === true;
        }

        if (r.network_settings?.target_search_network != null) {
          c.searchPartners = r.network_settings.target_search_network !== false;
        }

        if (r.geo_target_type_setting?.positive_geo_target_type != null) {
          c.presenceOnly =
            r.geo_target_type_setting.positive_geo_target_type === E.PositiveGeoTargetType.PRESENCE;
        }

        if (hasBiddingResource(r)) {
          c.biddingStrategy = biddingStrategyName(r);
          Object.assign(c, biddingNumbersOf(r));
        }

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
        const campaign = this.store.campaigns.get(campaignId);

        if (campaign?.biddingStrategy === "MAXIMIZE_CLICKS" && r.cpc_bid_micros != null) {
          throw new Error("FakeGoogleAdsGateway: cpc bids are incompatible with MAXIMIZE_CLICKS");
        }

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

      if (op.entity === "ad_group_ad" && op.operation === "create") {
        const rsa = r.ad?.responsive_search_ad ?? {};
        const headlines = Array.isArray(rsa.headlines) ? rsa.headlines : [];
        const descriptions = Array.isArray(rsa.descriptions) ? rsa.descriptions : [];
        if (headlines.length < 3) throw new Error("FakeGoogleAdsGateway: responsive search ad needs 3-15 headlines");
        if (descriptions.length < 2) throw new Error("FakeGoogleAdsGateway: responsive search ad needs 2-4 descriptions");

        if (!Array.isArray(r.ad?.final_urls) || r.ad.final_urls.length === 0) {
          throw new Error("FakeGoogleAdsGateway: responsive search ad needs a final URL");
        }

        const id = String(this.store.nextId++);
        const adGroupId = resourceId(String(r.ad_group ?? ""));

        this.store.ads.set(id, { id, adGroupId });
        out.push(`customers/${this.customerId}/adGroupAds/${adGroupId}~${id}`);
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
          const campaign = g ? this.store.campaigns.get(g.campaignId) : undefined;

          if (campaign?.biddingStrategy === "MAXIMIZE_CLICKS" && r.cpc_bid_micros != null) {
            throw new Error("FakeGoogleAdsGateway: cpc bids are incompatible with MAXIMIZE_CLICKS");
          }

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
