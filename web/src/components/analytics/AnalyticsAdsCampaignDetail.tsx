import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Megaphone, Pause, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, X } from "lucide-react";
import { apiGet, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { AppleAdsCampaign, AppleAdsCampaignDetail, AppleAdsCampaignRevenue, AppleAdsCountryBreakdownResponse, AppleAdsCountryStats, AppleAdsDailySpendResponse, AppleAdsNegativesResponse, AppleAdsStats } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { countryName, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams } from "../../utils/analyticsRange";
import {
  EMPTY_KEYWORD_FILTERS,
  filterKeywordRows,
  isFilterActive,
  sortKeywordRows,
  type KeywordFilters,
  type KeywordSortCol,
  type SortDir,
} from "../../utils/keywordTable";
import AppleAdsCampaignChart from "./AppleAdsCampaignChart";
import { NegativeKeywordManager } from "./AppleAdsNegativeKeywords";
import AppleAdsCampaignHistory from "./AppleAdsCampaignHistory";

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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className={`text-[11px] ${textMuted} mb-1.5`}>{label}</div>
      <div className={`text-[20px] font-bold leading-none truncate ${textPrimary}`} title={value}>{value}</div>
    </div>
  );
}

function StatCells({ stats, currency }: { stats: AppleAdsStats; currency: string | null }) {
  return (
    <>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(stats.spend, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.impressions)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.taps)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>
        {stats.ttr != null ? fmtPct(stats.ttr * 100) : "—"}
      </td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.installs)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.avgCpt, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.avgCpa, currency)}</td>
      <td className={`${TD} text-right pr-5 tabular-nums ${textMuted}`}>
        {stats.conversionRate != null ? fmtPct(stats.conversionRate * 100) : "—"}
      </td>
    </>
  );
}

const STAT_HEADERS = ["Spend", "Impressions", "Taps", "TTR", "Installs", "Avg CPT", "Avg CPA", "Conv. Rate"];

function fmtMoneyUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
    amount,
  );
}

/** Like useApi, but surfaces the server's error message (Apple's report
 * errors carry the reason, e.g. when a grouping is unsupported). */
function useCountryBreakdown(path: string | null) {
  const [data, setData] = useState<AppleAdsCountryBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(path != null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (path == null) return;
    let live = true;
    setLoading(true);
    setError(null);
    apiGet<AppleAdsCountryBreakdownResponse>(path)
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

function CountryStatsTable({
  countries,
  currency,
  revenueAvailable,
}: {
  countries: AppleAdsCountryStats[];
  currency: string | null;
  revenueAvailable: boolean;
}) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>
          <th className={TH}>Country</th>
          {STAT_HEADERS.map((h) => (
            <th key={h} className={`${TH} text-right ${h === "Conv. Rate" && !revenueAvailable ? "pr-5" : ""}`}>
              {h}
            </th>
          ))}
          {revenueAvailable && (
            <>
              <th className={`${TH} text-right`}>Trials</th>
              <th className={`${TH} text-right pr-5`}>Proceeds</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => (
          <tr key={c.countryOrRegion}>
            <td className={TD}>
              {c.countryOrRegion === "unknown" ? (
                <span className={textMuted}>Unknown</span>
              ) : (
                <>
                  <span className={`font-medium ${textPrimary}`}>{countryName(c.countryOrRegion)}</span>{" "}
                  <span className={textMuted}>{c.countryOrRegion}</span>
                </>
              )}
            </td>
            <StatCells stats={c} currency={currency} />
            {revenueAvailable && (
              <>
                <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.trials)}</td>
                <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                  {fmtMoneyUsd(c.proceedsUsd)}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeywordCountries({
  campaignId,
  adGroupId,
  keywordId,
  currency,
  query,
}: {
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  currency: string | null;
  query: string;
}) {
  const { data, loading, error } = useCountryBreakdown(
    `/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/keywords/${keywordId}/countries${query}`,
  );
  if (loading) return <div className={`text-[12px] ${textMuted}`}>Loading…</div>;
  if (error || !data) return <div className={`text-[12px] ${textMuted}`}>{error ?? "Failed to load country data"}</div>;
  if (data.countries.length === 0) return <div className={`text-[12px] ${textMuted}`}>No country data for this period.</div>;
  return (
    <div className="overflow-x-auto">
      <CountryStatsTable countries={data.countries} currency={currency} revenueAvailable={data.revenueAvailable} />
    </div>
  );
}

export default function AnalyticsAdsCampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [expandedAdGroup, setExpandedAdGroup] = useState<string | null>(null);
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);
  const [kwSortCol, setKwSortCol] = useState<KeywordSortCol>("spend");
  const [kwSortDir, setKwSortDir] = useState<SortDir>("desc");
  const [kwFilter, setKwFilter] = useState<KeywordFilters>(EMPTY_KEYWORD_FILTERS);
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const query = useMemo(
    () => rangeToParams(range, customStart, customEnd).replace(/^&/, "?"),
    [range, customStart, customEnd],
  );
  const rangeDeps = [range, customStart, customEnd];

  const { data: campaignsData } = useApi<{ campaigns: AppleAdsCampaign[] }>(`/apple-ads/campaigns${query}`, rangeDeps, true);
  const campaign = campaignsData?.campaigns.find((c) => c.id === campaignId) ?? null;

  const {
    data: detail,
    loading,
    error,
  } = useApi<AppleAdsCampaignDetail>(`/apple-ads/campaigns/${campaignId}/details${query}`, [campaignId, ...rangeDeps], true);

  const {
    data: revenueData,
    loading: revenueLoading,
    error: revenueError,
  } = useApi<AppleAdsCampaignRevenue>(`/apple-ads/campaign-revenue${query}`, rangeDeps, true);
  const campaignRevenue = campaignId ? revenueData?.byCampaign[campaignId] : undefined;

  const {
    data: dailySpend,
    loading: spendLoading,
    error: spendError,
  } = useApi<AppleAdsDailySpendResponse>(`/apple-ads/campaigns/${campaignId}/daily-spend${query}`, [campaignId, ...rangeDeps], true);

  const {
    data: countriesData,
    loading: countriesLoading,
    error: countriesError,
  } = useCountryBreakdown(campaignId ? `/apple-ads/campaigns/${campaignId}/countries${query}` : null);

  const { canManageTeam } = usePermissions();
  const {
    data: negativesData,
    loading: negativesLoading,
    error: negativesError,
    refetch: refetchNegatives,
  } = useApi<AppleAdsNegativesResponse>(`/apple-ads/campaigns/${campaignId}/negatives`, [campaignId], true);
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

  const TEXT_SORT_COLS: KeywordSortCol[] = ["keyword", "matchType"];
  function handleKwSort(col: KeywordSortCol) {
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
    col: KeywordSortCol;
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
    setKwFilter(EMPTY_KEYWORD_FILTERS);
    setKwSortCol("spend");
    setKwSortDir("desc");
  }

  const setKwFilterValue = (key: keyof KeywordFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setKwFilter((prev) => ({ ...prev, [key]: e.target.value }));

  const kwFilterInput =
    `h-7 w-full min-w-[56px] px-1.5 text-[11px] border ${borderDefault} rounded-lg ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2] tabular-nums`;
  const kwFilterCell = "px-4 py-1.5 border-b border-[#f3f4f6] dark:border-[#2a2f3d]";
  const kwTableModified = isFilterActive(kwFilter) || kwSortCol !== "spend" || kwSortDir !== "desc";
  const kwRevenueById = campaignRevenue?.byKeyword;
  // Only one ad group expands at a time, so one shared filtered/sorted view is enough.
  const visibleKeywords = useMemo(() => {
    const group = adGroups.find((g) => g.id === expandedAdGroup);
    if (!group) return [];
    return sortKeywordRows(
      filterKeywordRows(group.keywords, kwFilter, kwRevenueById),
      kwSortCol,
      kwSortDir,
      kwRevenueById,
    );
  }, [adGroups, expandedAdGroup, kwFilter, kwSortCol, kwSortDir, kwRevenueById]);

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
          <StatTile label="Countries" value={campaign.countriesOrRegions?.join(", ") || "—"} />
          <StatTile label="Spend" value={fmtMoney(campaign.spend, campaign.currency)} />
          <StatTile label="Impressions" value={fmtNumber(campaign.impressions)} />
          <StatTile label="Taps" value={fmtNumber(campaign.taps)} />
          <StatTile label="TTR" value={campaign.ttr != null ? fmtPct(campaign.ttr * 100) : "—"} />
          <StatTile label="Installs" value={fmtNumber(campaign.installs)} />
          <StatTile label="Avg CPT" value={fmtMoney(campaign.avgCpt, campaign.currency)} />
          <StatTile label="Avg CPA" value={fmtMoney(campaign.avgCpa, campaign.currency)} />
          <StatTile
            label="Conv. Rate"
            value={campaign.conversionRate != null ? fmtPct(campaign.conversionRate * 100) : "—"}
          />
        </div>
      )}

      <AppleAdsCampaignChart
        spendDays={dailySpend?.days}
        startDate={dailySpend?.startDate}
        endDate={dailySpend?.endDate}
        revenue={campaignRevenue}
        currency={currency}
        loading={spendLoading || revenueLoading}
        error={!!spendError}
        revenueError={!!revenueError}
      />

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Countries</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Spend and performance by country for the selected period
            {!countriesLoading && countriesData && !countriesData.revenueAvailable && (
              <> · connect RevenueCat for trials &amp; proceeds</>
            )}
          </div>
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
            <CountryStatsTable
              countries={countriesData.countries}
              currency={currency}
              revenueAvailable={countriesData.revenueAvailable}
            />
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
            <div className={`text-[13px] ${textMuted}`}>Failed to load negative keywords</div>
          ) : (
            <NegativeKeywordManager
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
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Failed to load ad groups</div>
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
                          {fmtMoney(g.defaultBidAmount, g.currency ?? currency)}
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
                                <div className={`text-[12px] ${textMuted}`}>Failed to load negative keywords</div>
                              ) : (
                                <NegativeKeywordManager
                                  campaignId={campaignId}
                                  adGroupId={g.id}
                                  negatives={negativesByGroup.get(g.id) ?? []}
                                  canEdit={canManageTeam}
                                  onChanged={handleNegativesChanged}
                                />
                              )}
                            </div>
                            <div className={`text-[12px] font-semibold ${textPrimary} mb-2 flex items-center justify-between gap-2`}>
                              <span>
                                Keywords {g.cpaGoal != null && (
                                  <span className={`font-normal ${textMuted}`}>
                                    · CPA goal {fmtMoney(g.cpaGoal, g.currency ?? currency)}
                                  </span>
                                )}
                              </span>
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
                                      <th className={TH}></th>
                                      <KwSortTh col="keyword">Keyword</KwSortTh>
                                      <KwSortTh col="matchType">Match Type</KwSortTh>
                                      <KwSortTh col="bid" right>Bid</KwSortTh>
                                      <KwSortTh col="spend" right>Spend</KwSortTh>
                                      <KwSortTh col="impressions" right>Impressions</KwSortTh>
                                      <KwSortTh col="taps" right>Taps</KwSortTh>
                                      <KwSortTh col="ttr" right>TTR</KwSortTh>
                                      <KwSortTh col="installs" right>Installs</KwSortTh>
                                      <KwSortTh col="avgCpt" right>Avg CPT</KwSortTh>
                                      <KwSortTh col="avgCpa" right>Avg CPA</KwSortTh>
                                      <KwSortTh col="convRate" right>Conv. Rate</KwSortTh>
                                      <KwSortTh col="rcTxns" right>Txns</KwSortTh>
                                      <KwSortTh col="rcProceeds" right last>Proceeds</KwSortTh>
                                    </tr>
                                    <tr>
                                      <th className={kwFilterCell}>
                                        {isFilterActive(kwFilter) && (
                                          <span className={`text-[11px] tabular-nums ${textMuted}`}>
                                            {visibleKeywords.length}/{g.keywords.length}
                                          </span>
                                        )}
                                      </th>
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
                                        <input value={kwFilter.taps} onChange={setKwFilterValue("taps")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.ttr} onChange={setKwFilterValue("ttr")} placeholder="min %" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.installs} onChange={setKwFilterValue("installs")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.avgCpt} onChange={setKwFilterValue("avgCpt")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.avgCpa} onChange={setKwFilterValue("avgCpa")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.convRate} onChange={setKwFilterValue("convRate")} placeholder="min %" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={kwFilterCell}>
                                        <input value={kwFilter.rcTxns} onChange={setKwFilterValue("rcTxns")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                      <th className={`${kwFilterCell} pr-5`}>
                                        <input value={kwFilter.rcProceeds} onChange={setKwFilterValue("rcProceeds")} placeholder="min" inputMode="decimal" className={`${kwFilterInput} text-right`} />
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {visibleKeywords.map((k) => {
                                      const kwExpanded = expandedKeyword === k.id;
                                      const kwRevenue = campaignRevenue?.byKeyword[k.id];
                                      return (
                                        <Fragment key={k.id}>
                                          <tr
                                            onClick={() => setExpandedKeyword(kwExpanded ? null : k.id)}
                                            className="cursor-pointer hover:bg-[#f7f8fa] dark:hover:bg-[#252b38]"
                                          >
                                            <td className={`${TD} w-5`}>
                                              <ChevronRight
                                                className={`w-3.5 h-3.5 ${textMuted} transition-transform shrink-0 ${kwExpanded ? "rotate-90" : ""}`}
                                              />
                                            </td>
                                            <td className={TD}>
                                              <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                                                {statusDot(k.status)}
                                                {k.text}
                                              </span>
                                            </td>
                                            <td className={`${TD} ${textMuted}`}>{k.matchType}</td>
                                            <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                                              {fmtMoney(k.bidAmount, k.currency ?? g.currency ?? currency)}
                                            </td>
                                            <StatCells stats={k} currency={k.currency ?? g.currency ?? currency} />
                                            <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                                              {revenueLoading ? "…" : revenueError ? "—" : fmtNumber(kwRevenue?.transactions.length ?? 0)}
                                            </td>
                                            <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                                              {revenueLoading ? "…" : revenueError ? "—" : fmtMoneyUsd(kwRevenue?.proceedsUsd ?? 0)}
                                            </td>
                                          </tr>
                                          {kwExpanded && campaignId && (
                                            <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                                              <td colSpan={14} className="px-4 py-3">
                                                <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>
                                                  Countries
                                                </div>
                                                <div className={kwRevenue ? "mb-4" : ""}>
                                                  <KeywordCountries
                                                    campaignId={campaignId}
                                                    adGroupId={g.id}
                                                    keywordId={k.id}
                                                    currency={k.currency ?? g.currency ?? currency}
                                                    query={query}
                                                  />
                                                </div>
                                                {kwRevenue && (
                                                  <>
                                                    <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>
                                                      Revenue
                                                    </div>
                                                    <table className="w-full text-[12px]">
                                                      <thead>
                                                        <tr>
                                                          <th className={TH}>Date</th>
                                                          <th className={TH}>App</th>
                                                          <th className={TH}>Product</th>
                                                          <th className={TH}>Event</th>
                                                          <th className={TH}>Country</th>
                                                          <th className={`${TH} text-right`}>Proceeds (USD)</th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {kwRevenue.transactions.map((t) => (
                                                          <tr key={t.id}>
                                                            <td className={TD}>{t.date.slice(0, 10)}</td>
                                                            <td className={TD}>{t.app}</td>
                                                            <td className={TD}>{t.product}</td>
                                                            <td className={TD}>{t.eventType.replace(/_/g, " ")}</td>
                                                            <td className={TD}>{t.country ?? "—"}</td>
                                                            <td className={`${TD} text-right tabular-nums`}>{fmtMoneyUsd(t.proceedsUsd)}</td>
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  </>
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

      {campaignId && <AppleAdsCampaignHistory campaignId={campaignId} refreshToken={historyToken} />}
    </div>
  );
}
