import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Ban, Check, Megaphone, Pause, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, X, CircleDollarSign, DollarSign, Download, Eye, MousePointerClick, Percent, Receipt, Tag, TrendingUp } from "lucide-react";
import { apiGet, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { GoogleAdsAppleRevenueResponse, GoogleAdsCampaign, GoogleAdsCampaignDetail, GoogleAdsCountryBreakdownResponse, GoogleAdsCountryStats, GoogleAdsDailySpendResponse, GoogleAdsNegativesResponse, GoogleAdsStats } from "../../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary } from "../../styles";
import { countryName, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
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
import GoogleAdsProfitCalculator from "./GoogleAdsProfitCalculator";
import GoogleAdsAppleRevenue from "./GoogleAdsAppleRevenue";
import { GoogleNegativeKeywordManager } from "./GoogleAdsNegativeKeywords";
import GoogleAdsCampaignHistory from "./GoogleAdsCampaignHistory";
import { StatCard } from "../StatCard";

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

function fmtMoneyUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
    amount,
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

type NegativesModalTarget = { scope: "campaign" } | { scope: "adGroup"; id: string; name: string };

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

  const { data: campaignsData, loading: campaignsLoading } = useApi<{ campaigns: GoogleAdsCampaign[] }>(
    `/google-ads/campaigns${query}`,
    rangeDeps,
    true,
  );
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
    data: revenueData,
    loading: revenueLoading,
    error: revenueError,
    refetch: refetchRevenue,
  } = useApi<GoogleAdsAppleRevenueResponse>(`/google-ads/campaigns/${campaignId}/apple-revenue${query}`, [campaignId, ...rangeDeps], true);
  const revenueTotals = revenueData?.mapped ? revenueData.totals : undefined;
  const trialEconomics = useMemo(() => {
    const downloads = revenueTotals?.downloads ?? 0;
    const started = revenueTotals?.trials ?? 0;
    const converted = revenueTotals?.purchases ?? 0;
    const proceeds = revenueTotals?.proceedsUsd ?? 0;
    const campaignAvg = converted > 0 ? proceeds / converted : 0;
    return {
      downloads,
      started,
      converted,
      proceedsPerConverted: campaignAvg > 0 ? campaignAvg : (revenueData?.avgTrialValueUsd ?? 0),
    };
  }, [revenueTotals, revenueData?.avgTrialValueUsd]);

  const {
    data: countriesData,
    loading: countriesLoading,
    error: countriesError,
  } = useCountryBreakdown(campaignId ? `/google-ads/campaigns/${campaignId}/countries${query}` : null);

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
  const [negativesModal, setNegativesModal] = useState<NegativesModalTarget | null>(null);
  const handleNegativesChanged = useCallback(() => {
    refetchNegatives();
    setHistoryToken((t) => t + 1);
  }, [refetchNegatives]);

  const adGroups = detail?.adGroups ?? [];
  const currency = campaign?.currency ?? adGroups.find((g) => g.currency)?.currency ?? "USD";

  const statDays = useMemo(() => {
    const raw = dailySpend?.days ?? [];
    const byDate = new Map(raw.map((d) => [d.date, d]));
    const proceedsByDate = new Map<string, number>();
    const installsByDate = new Map<string, number>();
    for (const t of revenueData?.days ?? []) {
      proceedsByDate.set(t.date, (proceedsByDate.get(t.date) ?? 0) + t.proceedsUsd);
      installsByDate.set(t.date, (installsByDate.get(t.date) ?? 0) + t.downloads);
    }
    const start = dailySpend?.startDate ?? raw[0]?.date;
    const end = dailySpend?.endDate ?? raw[raw.length - 1]?.date;
    if (!start || !end) return [];
    const points: { spend: number; impressions: number; clicks: number; installs: number; proceeds: number }[] = [];
    for (
      let cursor = new Date(`${start}T00:00:00Z`);
      cursor <= new Date(`${end}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      const d = byDate.get(key);
      points.push({
        spend: d?.spend ?? 0,
        impressions: d?.impressions ?? 0,
        clicks: d?.clicks ?? 0,
        installs: installsByDate.get(key) ?? 0,
        proceeds: proceedsByDate.get(key) ?? 0,
      });
    }
    return points;
  }, [dailySpend, revenueData]);

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
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setNegativesModal({ scope: "campaign" })}
            className={btnSecSm}
            title="Campaign-level negative keywords"
          >
            <Ban className="w-3.5 h-3.5" /> Negative Keywords
            {!negativesLoading && negativesData && (
              <span className={`text-[11px] ${textMuted} tabular-nums`}>({negativesData.campaign.length})</span>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <StatCard
          label="Spend"
          value={campaignsLoading || !campaign ? "—" : fmtMoney(campaign.spend, campaign.currency)}
          sub={rangeLabel(range)}
          sparkline={statDays.map((d) => d.spend)}
          icon={<DollarSign className="w-4 h-4" />}
          color="#f59e0b"
        />
        <StatCard
          label="Impressions"
          value={campaignsLoading || !campaign ? "—" : fmtNumber(campaign.impressions)}
          sub={rangeLabel(range)}
          sparkline={statDays.map((d) => d.impressions)}
          icon={<Eye className="w-4 h-4" />}
          color="#0ea5e9"
        />
        <StatCard
          label="Clicks"
          value={campaignsLoading || !campaign ? "—" : fmtNumber(campaign.clicks)}
          sub={rangeLabel(range)}
          sparkline={statDays.map((d) => d.clicks)}
          icon={<MousePointerClick className="w-4 h-4" />}
          color="#6366f1"
        />
        <StatCard
          label="CTR"
          value={campaignsLoading || !campaign ? "—" : campaign.ctr != null ? fmtPct(campaign.ctr * 100) : "—"}
          sub="Clicks / Impressions"
          sparkline={statDays.map((d) => (d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0))}
          icon={<TrendingUp className="w-4 h-4" />}
          color="#8b5cf6"
        />
        <StatCard
          label="Installs"
          value={revenueLoading ? "—" : revenueError || !revenueTotals ? "—" : fmtNumber(revenueTotals.downloads)}
          sub={rangeLabel(range)}
          dim={!revenueLoading && !revenueTotals}
          note={!revenueLoading && !revenueError && !revenueTotals ? "Link a campaign token below" : undefined}
          sparkline={statDays.map((d) => d.installs)}
          icon={<Download className="w-4 h-4" />}
          color="#10b981"
        />
        <StatCard
          label="Avg CPC"
          value={campaignsLoading || !campaign ? "—" : fmtMoney(campaign.avgCpc, campaign.currency)}
          sub="Spend / Clicks"
          sparkline={statDays.map((d) => (d.clicks > 0 ? d.spend / d.clicks : 0))}
          icon={<Tag className="w-4 h-4" />}
          color="#14b8a6"
        />
        <StatCard
          label="Avg CPA"
          value={
            campaignsLoading || revenueLoading || !campaign || revenueError || !revenueTotals || revenueTotals.downloads <= 0
              ? "—"
              : fmtMoney(campaign.spend / revenueTotals.downloads, campaign.currency)
          }
          sub="Spend / Installs"
          dim={!revenueLoading && !revenueTotals}
          sparkline={statDays.map((d) => (d.installs > 0 ? d.spend / d.installs : 0))}
          icon={<Receipt className="w-4 h-4" />}
          color="#f43f5e"
        />
        <StatCard
          label="Conv. Rate"
          value={
            campaignsLoading || revenueLoading || !campaign || revenueError || !revenueTotals || campaign.clicks <= 0
              ? "—"
              : fmtPct((revenueTotals.downloads / campaign.clicks) * 100)
          }
          sub="Installs / Clicks"
          dim={!revenueLoading && !revenueTotals}
          sparkline={statDays.map((d) => (d.clicks > 0 ? (d.installs / d.clicks) * 100 : 0))}
          icon={<Percent className="w-4 h-4" />}
          color="#D94412"
        />
        <StatCard
          label="Proceeds"
          value={
            revenueLoading ? "—" : revenueError || !revenueTotals ? "—" : fmtMoneyUsd(revenueTotals.proceedsUsd)
          }
          sub={rangeLabel(range)}
          dim={!revenueLoading && !revenueTotals}
          note={!revenueLoading && !revenueError && !revenueTotals ? "Link a campaign token below" : undefined}
          sparkline={statDays.map((d) => d.proceeds)}
          icon={<CircleDollarSign className="w-4 h-4" />}
          color="#16a34a"
        />
      </div>

      <GoogleAdsCampaignChart
        spendDays={dailySpend?.days}
        startDate={dailySpend?.startDate}
        endDate={dailySpend?.endDate}
        revenue={revenueData ?? undefined}
        currency={currency}
        loading={spendLoading || revenueLoading}
        error={!!spendError}
        revenueError={!!revenueError}
      />

      <GoogleAdsProfitCalculator
        campaign={campaign}
        mapped={revenueData?.mapped === true && !revenueError}
        downloads={trialEconomics.downloads}
        trialStarts={trialEconomics.started}
        convertedTrials={trialEconomics.converted}
        proceedsPerConverted={trialEconomics.proceedsPerConverted}
        loading={campaignsLoading || revenueLoading}
      />

      {campaignId && (
        <GoogleAdsAppleRevenue
          campaignId={campaignId}
          query={query}
          rangeDeps={rangeDeps}
          canManageTeam={canManageTeam}
          data={revenueData}
          loading={revenueLoading}
          error={revenueError}
          refetch={refetchRevenue}
        />
      )}

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
                            <div className="mb-3">
                              <button
                                onClick={() => setNegativesModal({ scope: "adGroup", id: g.id, name: g.name })}
                                className={btnSecSm}
                                title="Ad-group-level negative keywords"
                              >
                                <Ban className="w-3.5 h-3.5" /> Negative Keywords
                                {!negativesLoading && !negativesError && (
                                  <span className={`text-[11px] ${textMuted} tabular-nums`}>
                                    ({(negativesByGroup.get(g.id) ?? []).length})
                                  </span>
                                )}
                              </button>
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

      {negativesModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10 px-4">
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setNegativesModal(null)} />
            <div
              className={`relative w-full max-w-2xl max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
                <div>
                  <h2 className={`text-lg font-semibold ${textPrimary}`}>Negative Keywords</h2>
                  <div className={`text-[12px] ${textMuted} mt-0.5`}>
                    {negativesModal.scope === "campaign"
                      ? "Campaign level — apply to all ad groups"
                      : `Ad group "${negativesModal.name}" — apply to this ad group only`}
                  </div>
                </div>
                <button
                  onClick={() => setNegativesModal(null)}
                  aria-label="Close"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto">
                {negativesLoading ? (
                  <div className={`text-[13px] ${textMuted}`}>Loading…</div>
                ) : negativesError || !negativesData || !campaignId ? (
                  <div className={`text-[13px] ${textMuted}`}>Failed to load negative keywords</div>
                ) : (
                  <GoogleNegativeKeywordManager
                    campaignId={campaignId}
                    adGroupId={negativesModal.scope === "campaign" ? null : negativesModal.id}
                    negatives={
                      negativesModal.scope === "campaign"
                        ? negativesData.campaign
                        : (negativesByGroup.get(negativesModal.id) ?? [])
                    }
                    canEdit={canManageTeam}
                    onChanged={handleNegativesChanged}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
