import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Megaphone, Pause, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, X } from "lucide-react";
import { apiGet, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { GoogleAdsAttributionResponse, GoogleAdsCampaign, GoogleAdsCampaignDetail, GoogleAdsCountryBreakdownResponse, GoogleAdsCountryStats, GoogleAdsDailySpendResponse, GoogleAdsNegativesResponse, GoogleAdsStats } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { countryName, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams } from "../../utils/analyticsRange";
import {
  EMPTY_GOOGLE_KEYWORD_FILTERS,
  filterGoogleKeywordRows,
  isGoogleFilterActive,
  sortGoogleKeywordRows,
  type GoogleKeywordFilters,
  type GoogleKeywordSortCol,
  type GoogleSortDir,
} from "../../utils/googleKeywordTable";
import GoogleAdsCampaignChart from "./GoogleAdsCampaignChart";
import { GoogleNegativeKeywordManager } from "./GoogleAdsNegativeKeywords";
import GoogleAdsCampaignHistory from "./GoogleAdsCampaignHistory";

function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function statusBadge(status: string) {
  const isOn = status === "ENABLED" || status === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
        isOn
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          : "bg-gray-100 text-gray-600 dark:bg-[#252b38] dark:text-[#8b93a5]"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function statusDot(status: string) {
  const isOn = status === "ENABLED" || status === "ACTIVE";
  const isPaused = status === "PAUSED";
  return (
    <span
      title={status.replace(/_/g, " ")}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
        isOn
          ? "bg-emerald-100 dark:bg-emerald-900/30"
          : isPaused
            ? "bg-gray-100 dark:bg-[#252b38]"
            : "bg-red-100 dark:bg-red-900/30"
      }`}
    >
      {isOn ? (
        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
      ) : isPaused ? (
        <Pause className="w-3 h-3 text-gray-600 dark:text-[#8b93a5]" fill="currentColor" strokeWidth={0} />
      ) : (
        <X className="w-3 h-3 text-red-600 dark:text-red-400" strokeWidth={3} />
      )}
    </span>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className={`text-[11px] ${textMuted} mb-1.5`}>{label}</div>
      <div className={`text-[20px] font-bold leading-none truncate ${textPrimary}`} title={value}>{value}</div>
      {sub != null && <div className={`text-[11px] ${textMuted} mt-1.5 truncate`}>{sub}</div>}
    </div>
  );
}

function StatCells({ stats, currency }: { stats: GoogleAdsStats; currency: string | null }) {
  return (
    <>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(stats.spend, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.impressions)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.clicks)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>
        {stats.ctr != null ? fmtPct(stats.ctr * 100) : "—"}
      </td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.conversions)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.avgCpc, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.costPerConversion, currency)}</td>
      <td className={`${TD} text-right pr-5 tabular-nums ${textMuted}`}>
        {stats.conversionRate != null ? fmtPct(stats.conversionRate * 100) : "—"}
      </td>
    </>
  );
}

const STAT_HEADERS = ["Spend", "Impressions", "Clicks", "CTR", "Conversions", "Avg CPC", "Cost/Conv", "Conv. Rate"];

/** Like useApi, but surfaces the server's error message. */
function useCountryBreakdown(path: string | null) {
  const [data, setData] = useState<GoogleAdsCountryBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(path != null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (path == null) return;
    let live = true;
    setLoading(true);
    setError(null);
    apiGet<GoogleAdsCountryBreakdownResponse>(path)
      .then((d) => {
        if (!live) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path]);
  return { data, loading, error };
}

function CountryStatsTable({ countries, currency }: { countries: GoogleAdsCountryStats[]; currency: string | null }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>
          <th className={TH}>Country</th>
          {STAT_HEADERS.map((h) => (
            <th key={h} className={`${TH} text-right ${h === "Conv. Rate" ? "pr-5" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => (
          <tr key={c.countryOrRegion}>
            <td className={TD}>
              <span className={`font-medium ${textPrimary}`}>{c.countryName ?? countryName(c.countryOrRegion)}</span>{" "}
              <span className={textMuted}>{c.countryOrRegion}</span>
            </td>
            <StatCells stats={c} currency={currency} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AnalyticsGoogleAdsCampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [expandedAdGroup, setExpandedAdGroup] = useState<string | null>(null);
  const [kwSortCol, setKwSortCol] = useState<GoogleKeywordSortCol>("spend");
  const [kwSortDir, setKwSortDir] = useState<GoogleSortDir>("desc");
  const [kwFilter, setKwFilter] = useState<GoogleKeywordFilters>(EMPTY_GOOGLE_KEYWORD_FILTERS);
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const query = useMemo(
    () => rangeToParams(range, customStart, customEnd).replace(/^&/, "?"),
    [range, customStart, customEnd],
  );
  const rangeDeps = [range, customStart, customEnd];

  const { data: campaignsData } = useApi<{ campaigns: GoogleAdsCampaign[] }>(`/google-ads/campaigns${query}`, rangeDeps, true);
  const campaign = campaignsData?.campaigns.find((c) => c.id === campaignId) ?? null;

  const {
    data: detail,
    loading,
    error,
  } = useApi<GoogleAdsCampaignDetail>(`/google-ads/campaigns/${campaignId}/details${query}`, [campaignId, ...rangeDeps], true);

  const {
    data: dailySpend,
    loading: spendLoading,
    error: spendError,
  } = useApi<GoogleAdsDailySpendResponse>(`/google-ads/campaigns/${campaignId}/daily-spend${query}`, [campaignId, ...rangeDeps], true);

  const {
    data: countriesData,
    loading: countriesLoading,
    error: countriesError,
  } = useCountryBreakdown(campaignId ? `/google-ads/campaigns/${campaignId}/countries${query}` : null);

  const {
    data: attributionData,
    loading: attributionLoading,
    error: attributionError,
  } = useApi<GoogleAdsAttributionResponse>(
    `/google-ads/campaigns/${campaignId}/attribution${query}`,
    [campaignId, ...rangeDeps],
    true,
  );

  const { canManageTeam } = usePermissions();
  const {
    data: negativesData,
    loading: negativesLoading,
    error: negativesError,
    refetch: refetchNegatives,
  } = useApi<GoogleAdsNegativesResponse>(`/google-ads/campaigns/${campaignId}/negatives`, [campaignId], true);
  const negativesByGroup = useMemo(
    () => new Map((negativesData?.adGroups ?? []).map((a) => [a.id, a.negatives])),
    [negativesData],
  );
  const [historyToken, setHistoryToken] = useState(0);
  const handleNegativesChanged = useCallback(() => {
    refetchNegatives();
    setHistoryToken((t) => t + 1);
  }, [refetchNegatives]);

  const adGroups = detail?.adGroups ?? [];
  const currency = campaign?.currency ?? adGroups.find((g) => g.currency)?.currency ?? "USD";

  const TEXT_SORT_COLS: GoogleKeywordSortCol[] = ["keyword", "matchType"];
  function handleKwSort(col: GoogleKeywordSortCol) {
    if (kwSortCol === col) {
      setKwSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setKwSortCol(col);
      setKwSortDir(TEXT_SORT_COLS.includes(col) ? "asc" : "desc");
    }
  }

  function KwSortTh({
    col,
    children,
    right,
    last,
  }: {
    col: GoogleKeywordSortCol;
    children: React.ReactNode;
    right?: boolean;
    last?: boolean;
  }) {
    const active = kwSortCol === col;
    return (
      <th
        className={`${TH} ${right ? "text-right" : ""} ${last ? "pr-5" : ""} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
        onClick={() => handleKwSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className="opacity-40 [&_svg]:w-3 [&_svg]:h-3">
            {active ? kwSortDir === "asc" ? <ChevronUp /> : <ChevronDown /> : <ChevronsUpDown />}
          </span>
        </span>
      </th>
    );
  }

  function resetKwTable() {
    setKwFilter(EMPTY_GOOGLE_KEYWORD_FILTERS);
    setKwSortCol("spend");
    setKwSortDir("desc");
  }

  const setKwFilterValue = (key: keyof GoogleKeywordFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setKwFilter((prev) => ({ ...prev, [key]: e.target.value }));

  const kwFilterInput =
    `h-7 w-full min-w-[56px] px-1.5 text-[11px] border ${borderDefault} rounded-lg ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2] tabular-nums`;
  const kwFilterCell = "px-4 py-1.5 border-b border-[#f3f4f6] dark:border-[#2a2f3d]";
  const kwTableModified = isGoogleFilterActive(kwFilter) || kwSortCol !== "spend" || kwSortDir !== "desc";
  // Only one ad group expands at a time, so one shared filtered/sorted view is enough.
  const visibleKeywords = useMemo(() => {
    const group = adGroups.find((g) => g.id === expandedAdGroup);
    if (!group) return [];
    return sortGoogleKeywordRows(filterGoogleKeywordRows(group.keywords, kwFilter), kwSortCol, kwSortDir);
  }, [adGroups, expandedAdGroup, kwFilter, kwSortCol, kwSortDir]);

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className={`p-1.5 rounded-lg hover:bg-[#f3f4f6] dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className={`w-9 h-9 rounded-xl bg-black flex items-center justify-center shrink-0`}>
          <Megaphone className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className={`${pageTitle} leading-tight truncate`}>{campaign?.name ?? "Campaign"}</h1>
            {campaign && statusDot(campaign.status)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                range === opt.key
                  ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                  : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2]`}
            />
            <span className={`${textMuted} text-[12px]`}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2]`}
            />
          </div>
        )}
      </div>

      {campaign && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <StatTile label="Daily Budget" value={fmtMoney(campaign.dailyBudget, campaign.currency)} />
          <StatTile label="Spend" value={fmtMoney(campaign.spend, campaign.currency)} />
          <StatTile label="Impressions" value={fmtNumber(campaign.impressions)} />
          <StatTile label="Clicks" value={fmtNumber(campaign.clicks)} />
          <StatTile label="CTR" value={campaign.ctr != null ? fmtPct(campaign.ctr * 100) : "—"} />
          <StatTile label="Conversions" value={fmtNumber(campaign.conversions)} />
          <StatTile label="Avg CPC" value={fmtMoney(campaign.avgCpc, campaign.currency)} />
          <StatTile label="Cost/Conv." value={fmtMoney(campaign.costPerConversion, campaign.currency)} />
          <StatTile
            label="Conv. Rate"
            value={campaign.conversionRate != null ? fmtPct(campaign.conversionRate * 100) : "—"}
          />
        </div>
      )}

      <GoogleAdsCampaignChart
        spendDays={dailySpend?.days}
        startDate={dailySpend?.startDate}
        endDate={dailySpend?.endDate}
        currency={currency}
        loading={spendLoading}
        error={!!spendError}
      />

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Countries</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>Spend and performance by country for the selected period</div>
        </div>
        {countriesLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : countriesError || !countriesData ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {countriesError ?? "Failed to load country data"}
          </div>
        ) : countriesData.countries.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No country data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <CountryStatsTable countries={countriesData.countries} currency={currency} />
          </div>
        )}
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Attribution</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Ad clicks matched to first app opens by timestamp (24-hour window) — installs link to trials and
            proceeds via RevenueCat
          </div>
        </div>
        {attributionLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : attributionError || !attributionData ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {attributionError ?? "Failed to load attribution"}
          </div>
        ) : !attributionData.revenueAvailable ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            Connect RevenueCat to match installs to ad clicks.
          </div>
        ) : (
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              <StatTile label="Clicks" value={fmtNumber(attributionData.clicks)} />
              <StatTile
                label="Matched installs"
                value={fmtNumber(attributionData.installsMatched)}
                sub={`${fmtNumber(attributionData.highConfidenceInstalls)} high confidence`}
              />
              <StatTile label="Organic installs" value={fmtNumber(attributionData.installsOrganic)} />
              <StatTile label="Trials" value={fmtNumber(attributionData.trials)} />
              <StatTile label="Proceeds" value={fmtMoney(attributionData.proceedsUsd, "USD")} />
            </div>
            <div className={`text-[12px] ${textMuted} mb-4`}>
              Click precision: {attributionData.hourPrecision ? "hour" : "day"} · install delay:{" "}
              {attributionData.gapBuckets.map((b) => `${b.label} ${fmtNumber(b.count)}`).join(" · ")}
            </div>
            {attributionData.byKeyword.length === 0 ? (
              <div className={`text-[12px] ${textMuted}`}>No installs matched to clicks in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr>
                      <th className={TH}>Keyword</th>
                      <th className={`${TH} text-right`}>Installs</th>
                      <th className={`${TH} text-right`}>High conf.</th>
                      <th className={`${TH} text-right`}>Trials</th>
                      <th className={`${TH} text-right pr-5`}>Proceeds (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attributionData.byKeyword.map((k) => (
                      <tr key={k.criterionId}>
                        <td className={TD}>
                          <span className={`font-medium ${textPrimary}`}>{k.keywordText ?? k.criterionId}</span>
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(k.installs)}</td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {fmtNumber(k.highConfidenceInstalls)}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(k.trials)}</td>
                        <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                          {fmtMoney(k.proceedsUsd, "USD")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Negative Keywords</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>Campaign level — apply to all ad groups</div>
        </div>
        <div className="px-5 py-4">
          {negativesLoading ? (
            <div className={`text-[13px] ${textMuted}`}>Loading…</div>
          ) : negativesError || !negativesData || !campaignId ? (
            <div className={`text-[13px] ${textMuted}`}>{negativesError}</div>
          ) : (
            <GoogleNegativeKeywordManager
              campaignId={campaignId}
              adGroupId={null}
              negatives={negativesData.campaign}
              canEdit={canManageTeam}
              onChanged={handleNegativesChanged}
            />
          )}
        </div>
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Ad Groups</div>
        </div>
        {loading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : error ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>{error}</div>
        ) : adGroups.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No ad groups found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px]">
              <thead>
                <tr>
                  <th className={TH}>Ad Group</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-right`}>Default Bid</th>
                  {STAT_HEADERS.map((h) => (
                    <th key={h} className={`${TH} text-right ${h === "Conv. Rate" ? "pr-5" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adGroups.map((g) => {
                  const expanded = expandedAdGroup === g.id;
                  return (
                    <Fragment key={g.id}>
                      <tr
                        onClick={() => setExpandedAdGroup(expanded ? null : g.id)}
                        className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer"
                      >
                        <td className={TD}>
                          <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                            <ChevronRight
                              className={`w-3.5 h-3.5 ${textMuted} transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
                            />
                            {g.name}
                          </span>
                        </td>
                        <td className={TD}>{statusBadge(g.status)}</td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {fmtMoney(g.defaultCpcBid, g.currency ?? currency)}
                        </td>
                        <StatCells stats={g} currency={g.currency ?? currency} />
                      </tr>
                      {expanded && (
                        <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                          <td colSpan={11} className="px-5 py-4">
                            <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>
                              Negative keywords{" "}
                              <span className={`font-normal ${textMuted}`}>(apply to this ad group only)</span>
                            </div>
                            <div className="mb-4">
                              {negativesLoading ? (
                                <div className={`text-[12px] ${textMuted}`}>Loading…</div>
                              ) : negativesError || !campaignId ? (
                                <div className={`text-[12px] ${textMuted}`}>{negativesError}</div>
                              ) : (
                                <GoogleNegativeKeywordManager
                                  campaignId={campaignId}
                                  adGroupId={g.id}
                                  negatives={negativesByGroup.get(g.id) ?? []}
                                  canEdit={canManageTeam}
                                  onChanged={handleNegativesChanged}
                                />
                              )}
                            </div>
                            <div className={`text-[12px] font-semibold ${textPrimary} mb-2 flex items-center justify-between gap-2`}>
                              <span>Keywords</span>
                              {kwTableModified && (
                                <button
                                  onClick={resetKwTable}
                                  className={`text-[11px] font-medium ${textMuted} hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                            {g.keywords.length === 0 ? (
                              <div className={`text-[12px] ${textMuted}`}>No keywords in this ad group.</div>
                            ) : visibleKeywords.length === 0 ? (
                              <div className={`text-[12px] ${textMuted}`}>No keywords match the current filters.</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-[12px] min-w-[1200px]">
                                  <thead>
                                    <tr>
                                      <KwSortTh col="keyword">Keyword</KwSortTh>
                                      <KwSortTh col="matchType">Match Type</KwSortTh>
                                      <KwSortTh col="bid" right>Bid</KwSortTh>
                                      <KwSortTh col="spend" right>Spend</KwSortTh>
                                      <KwSortTh col="impressions" right>Impressions</KwSortTh>
                                      <KwSortTh col="clicks" right>Clicks</KwSortTh>
                                      <KwSortTh col="ctr" right>CTR</KwSortTh>
                                      <KwSortTh col="conversions" right>Conversions</KwSortTh>
                                      <KwSortTh col="avgCpc" right>Avg CPC</KwSortTh>
                                      <KwSortTh col="costPerConversion" right>Cost/Conv</KwSortTh>
                                      <KwSortTh col="convRate" right last>Conv. Rate</KwSortTh>
                                    </tr>
                                    <tr>
                                      <th className={kwFilterCell}>
                                        <input
                                          value={kwFilter.text}
                                          onChange={setKwFilterValue("text")}
                                          placeholder="Search"
                                          className={kwFilterInput}
                                        />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <select value={kwFilter.matchType} onChange={setKwFilterValue("matchType")} className={kwFilterInput}>
                                          <option value="">All</option>
                                          {[...new Set(g.keywords.map((k) => k.matchType))].sort().map((v) => (
                                            <option key={v} value={v}>{v}</option>
                                          ))}
                                        </select>
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.bid} onChange={setKwFilterValue("bid")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.spend} onChange={setKwFilterValue("spend")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.impressions} onChange={setKwFilterValue("impressions")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.clicks} onChange={setKwFilterValue("clicks")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.ctr} onChange={setKwFilterValue("ctr")} placeholder="min %" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.conversions} onChange={setKwFilterValue("conversions")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.avgCpc} onChange={setKwFilterValue("avgCpc")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.costPerConversion} onChange={setKwFilterValue("costPerConversion")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={`${kwFilterCell} pr-5`}>
                                        <input value={kwFilter.convRate} onChange={setKwFilterValue("convRate")} placeholder="min %" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {visibleKeywords.map((k) => (
                                      <tr key={k.id} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38]">
                                        <td className={TD}>
                                          <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                                            {statusDot(k.status)}
                                            {k.text}
                                          </span>
                                        </td>
                                        <td className={`${TD} ${textMuted}`}>{k.matchType}</td>
                                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                                          {fmtMoney(k.cpcBid, k.currency ?? g.currency ?? currency)}
                                        </td>
                                        <StatCells stats={k} currency={k.currency ?? g.currency ?? currency} />
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {campaignId && <GoogleAdsCampaignHistory campaignId={campaignId} refreshToken={historyToken} />}
    </div>
  );
}
