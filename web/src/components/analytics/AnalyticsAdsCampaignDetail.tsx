import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Megaphone,
  Settings,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  X,
  Ban,
  CircleDollarSign,
  DollarSign,
  Download,
  Eye,
  MousePointerClick,
  Percent,
  Receipt,
  Tag,
  TrendingUp,
} from "lucide-react";
import { apiPatch, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { useCountryBreakdown } from "../../hooks/useCountryBreakdown";
import CppProposals from "../cpp/CppProposals";
import AdGroupCppSettings from "./AdGroupCppSettings";
import type {
  AppleAdsCampaign,
  AppleAdsCampaignDetail,
  AppleAdsCampaignMilestonesResponse,
  AppleAdsCampaignRevenue,
  AppleAdsCountryBreakdownResponse,
  AppleAdsCountryStats,
  AppleAdsDailySpendResponse,
  AppleAdsNegativesResponse,
  AppleAdsSearchTermsResponse,
  AppleAdsStats,
} from "../../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary } from "../../styles";
import { countryName, fmtMoney, fmtNumber, fmtPct, rateTrafficColor } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
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
import AppleAdsProfitCalculator from "./AppleAdsProfitCalculator";
import { NegativeKeywordManager } from "./AppleAdsNegativeKeywords";
import AppleAdsCampaignHistory from "./AppleAdsCampaignHistory";
import { KeywordDevices } from "./AppleAdsKeywordDevices";
import { TransactionTypeBadge, adsTransactionType, prettyProductName } from "../TransactionTypeBadge";
import { StatCard } from "../StatCard";
import { StatusDot } from "../StatusDot";

function StatCells({
  stats,
  currency,
  ttrTrafficLight,
}: {
  stats: AppleAdsStats;
  currency: string | null;
  ttrTrafficLight?: boolean;
}) {
  const ttrColor = ttrTrafficLight ? rateTrafficColor(stats.ttr) : undefined;
  return (
    <>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(stats.spend, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.impressions)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.taps)}</td>
      <td
        className={`${TD} text-right tabular-nums ${ttrColor ? "font-semibold" : textMuted}`}
        style={ttrColor ? { color: ttrColor } : undefined}
      >
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
            <StatCells stats={c} currency={currency} ttrTrafficLight />
            {revenueAvailable && (
              <>
                <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.trials)}</td>
                <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                  {fmtMoney(c.proceedsUsd, "USD")}
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
  const { data, loading, error } = useCountryBreakdown<AppleAdsCountryBreakdownResponse>(
    `/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/keywords/${keywordId}/countries${query}`,
  );
  if (loading) return <div className={`text-[12px] ${textMuted}`}>Loading…</div>;
  if (error || !data) return <div className={`text-[12px] ${textMuted}`}>{error ?? "Failed to load country data"}</div>;
  if (data.countries.length === 0)
    return <div className={`text-[12px] ${textMuted}`}>No country data for this period.</div>;
  return (
    <div className="overflow-x-auto">
      <CountryStatsTable countries={data.countries} currency={currency} revenueAvailable={data.revenueAvailable} />
    </div>
  );
}

type NegativesModalTarget = { scope: "campaign" } | { scope: "adGroup"; id: string; name: string };

const DETAIL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "keywords", label: "Keywords" },
  { key: "countries", label: "Countries" },
  { key: "activity", label: "Activity" },
] as const;

type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsAdsCampaignDetail({ addToast }: Props) {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: DetailTabKey = DETAIL_TABS.some((t) => t.key === tabParam) ? (tabParam as DetailTabKey) : "overview";

  const setTab = (next: DetailTabKey) => {
    const params = new URLSearchParams(searchParams);

    if (next === "overview") params.delete("tab");
    else params.set("tab", next);

    setSearchParams(params, { replace: true });
  };

  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
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

  const {
    data: campaignsData,
    loading: campaignsLoading,
    refetch: refetchCampaigns,
  } = useApi<{ campaigns: AppleAdsCampaign[] }>(`/apple-ads/campaigns${query}`, rangeDeps, true);

  const campaign = campaignsData?.campaigns.find((c) => c.id === campaignId) ?? null;
  const campaignStatus = statusOverride ?? campaign?.status ?? null;

  useEffect(() => {
    setStatusOverride(null);
  }, [campaignId, campaignsData]);

  const {
    data: detail,
    loading,
    error,
  } = useApi<AppleAdsCampaignDetail>(
    `/apple-ads/campaigns/${campaignId}/details${query}`,
    [campaignId, ...rangeDeps],
    true,
  );

  const {
    data: searchTermsData,
    loading: searchTermsLoading,
    error: searchTermsError,
  } = useApi<AppleAdsSearchTermsResponse>(
    `/apple-ads/campaigns/${campaignId}/search-terms${query}`,
    [campaignId, ...rangeDeps],
    true,
  );

  const {
    data: revenueData,
    loading: revenueLoading,
    error: revenueError,
  } = useApi<AppleAdsCampaignRevenue>(`/apple-ads/campaign-revenue${query}`, rangeDeps, true);
  const campaignRevenue = campaignId ? revenueData?.byCampaign[campaignId] : undefined;
  const trialEconomics = useMemo(() => {
    const txs = campaignRevenue?.transactions ?? [];
    const started = txs.filter((t) => t.isTrial).length;
    const converted = txs.filter((t) => t.isConvertedTrial).length;
    const priced = txs.filter((t) => t.isTrial && t.potentialProceedsUsd > 0);
    const avgPotential = priced.length ? priced.reduce((sum, t) => sum + t.potentialProceedsUsd, 0) / priced.length : 0;
    const proceeds = campaignRevenue?.proceedsUsd ?? 0;
    const proceedsPerConverted = converted > 0 ? proceeds / converted : avgPotential;
    return {
      started,
      converted,
      proceedsPerConverted,
      directBase: Math.max(0, proceeds - converted * proceedsPerConverted),
    };
  }, [campaignRevenue]);

  const {
    data: dailySpend,
    loading: spendLoading,
    error: spendError,
  } = useApi<AppleAdsDailySpendResponse>(
    `/apple-ads/campaigns/${campaignId}/daily-spend${query}`,
    [campaignId, ...rangeDeps],
    true,
  );

  const {
    data: countriesData,
    loading: countriesLoading,
    error: countriesError,
  } = useCountryBreakdown<AppleAdsCountryBreakdownResponse>(
    campaignId ? `/apple-ads/campaigns/${campaignId}/countries${query}` : null,
  );

  const {
    data: milestonesData,
    loading: milestonesLoading,
    error: milestonesError,
  } = useApi<AppleAdsCampaignMilestonesResponse>(
    `/apple-ads/campaigns/${campaignId}/milestones${query}`,
    [campaignId, ...rangeDeps],
    true,
  );

  const { canManageTeam, canWrite } = usePermissions();
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
  const [negativesModal, setNegativesModal] = useState<NegativesModalTarget | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const handleNegativesChanged = useCallback(() => {
    refetchNegatives();
    setHistoryToken((t) => t + 1);
  }, [refetchNegatives]);

  const handleToggleStatus = async () => {
    if (!canManageTeam || toggling || !campaign || !campaignId) return;

    const nextStatus = campaignStatus === "ENABLED" ? "PAUSED" : "ENABLED";

    if (nextStatus === "ENABLED" && !confirm(`Resume campaign "${campaign.name}"? It will start spending again.`))
      return;

    setToggling(true);
    setStatusOverride(nextStatus);

    try {
      await apiPatch(`/apple-ads/campaigns/${campaignId}/status`, { status: nextStatus });
      addToast(nextStatus === "ENABLED" ? `Resumed "${campaign.name}"` : `Paused "${campaign.name}"`, "success");
      refetchCampaigns();
      setHistoryToken((t) => t + 1);
    } catch (e: any) {
      setStatusOverride(null);
      addToast(e.message, "error");
    } finally {
      setToggling(false);
    }
  };

  const adGroups = detail?.adGroups ?? [];
  const currency = campaign?.currency ?? adGroups.find((g) => g.currency)?.currency ?? "USD";

  // One aligned day axis for every sparkline: full range buckets, gaps as zero.
  const statDays = useMemo(() => {
    const raw = dailySpend?.days ?? [];
    const byDate = new Map(raw.map((d) => [d.date, d]));
    const proceedsByDate = new Map<string, number>();
    for (const t of campaignRevenue?.transactions ?? []) {
      const key = (t.cohortDate ?? t.date).slice(0, 10);
      proceedsByDate.set(key, (proceedsByDate.get(key) ?? 0) + t.proceedsUsd);
    }
    const start = dailySpend?.startDate ?? raw[0]?.date;
    const end = dailySpend?.endDate ?? raw[raw.length - 1]?.date;
    if (!start || !end) return [];
    const points: { spend: number; impressions: number; taps: number; installs: number; proceeds: number }[] = [];
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
        taps: d?.taps ?? 0,
        installs: d?.installs ?? 0,
        proceeds: proceedsByDate.get(key) ?? 0,
      });
    }
    return points;
  }, [dailySpend, campaignRevenue]);
  const lastDayOpen = (dailySpend?.endDate ?? "") >= new Date().toISOString().slice(0, 10);

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

  const setKwFilterValue =
    (key: keyof KeywordFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setKwFilter((prev) => ({ ...prev, [key]: e.target.value }));

  const kwFilterInput = `h-7 w-full min-w-[56px] px-1.5 text-[11px] border ${borderDefault} rounded-lg ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2] tabular-nums`;
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
            {campaignStatus && <StatusDot status={campaignStatus} />}
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
          <button onClick={() => setShowSettings(true)} className={btnSecSm} title="Campaign settings">
            <Settings className="w-3.5 h-3.5" /> Settings
            {!negativesLoading && negativesData && negativesData.campaign.length > 0 && (
              <span className={`text-[11px] ${textMuted} tabular-nums`}>({negativesData.campaign.length})</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl mb-5 self-start">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              tab === t.key
                ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <StatCard
              label="Spend"
              value={campaignsLoading || !campaign ? "—" : fmtMoney(campaign.spend, campaign.currency)}
              sub={rangeLabel(range)}
              sparkline={statDays.map((d) => d.spend)}
              icon={<DollarSign className="w-4 h-4" />}
              color="#f59e0b"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Impressions"
              value={campaignsLoading || !campaign ? "—" : fmtNumber(campaign.impressions)}
              sub={rangeLabel(range)}
              sparkline={statDays.map((d) => d.impressions)}
              icon={<Eye className="w-4 h-4" />}
              color="#0ea5e9"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Taps"
              value={campaignsLoading || !campaign ? "—" : fmtNumber(campaign.taps)}
              sub={rangeLabel(range)}
              sparkline={statDays.map((d) => d.taps)}
              icon={<MousePointerClick className="w-4 h-4" />}
              color="#6366f1"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="TTR"
              value={campaignsLoading || !campaign ? "—" : campaign.ttr != null ? fmtPct(campaign.ttr * 100) : "—"}
              sub="Taps / Impressions"
              sparkline={statDays.map((d) => (d.impressions > 0 ? (d.taps / d.impressions) * 100 : 0))}
              icon={<TrendingUp className="w-4 h-4" />}
              color="#8b5cf6"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Installs"
              value={campaignsLoading || !campaign ? "—" : fmtNumber(campaign.installs)}
              sub={rangeLabel(range)}
              sparkline={statDays.map((d) => d.installs)}
              icon={<Download className="w-4 h-4" />}
              color="#10b981"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Avg CPT"
              value={campaignsLoading || !campaign ? "—" : fmtMoney(campaign.avgCpt, campaign.currency)}
              sub="Spend / Taps"
              sparkline={statDays.map((d) => (d.taps > 0 ? d.spend / d.taps : 0))}
              icon={<Tag className="w-4 h-4" />}
              color="#14b8a6"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Avg CPA"
              value={campaignsLoading || !campaign ? "—" : fmtMoney(campaign.avgCpa, campaign.currency)}
              sub="Spend / Installs"
              sparkline={statDays.map((d) => (d.installs > 0 ? d.spend / d.installs : 0))}
              icon={<Receipt className="w-4 h-4" />}
              color="#f43f5e"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Conv. Rate"
              value={
                campaignsLoading || !campaign
                  ? "—"
                  : campaign.conversionRate != null
                    ? fmtPct(campaign.conversionRate * 100)
                    : "—"
              }
              sub="Installs / Taps"
              sparkline={statDays.map((d) => (d.taps > 0 ? (d.installs / d.taps) * 100 : 0))}
              icon={<Percent className="w-4 h-4" />}
              color="#D94412"
              dashedTail={lastDayOpen}
            />
            <StatCard
              label="Proceeds"
              value={
                revenueLoading
                  ? "—"
                  : revenueError || !campaignRevenue
                    ? "—"
                    : fmtMoney(campaignRevenue.proceedsUsd, "USD")
              }
              sub={rangeLabel(range)}
              sparkline={statDays.map((d) => d.proceeds)}
              icon={<CircleDollarSign className="w-4 h-4" />}
              color="#16a34a"
              dashedTail={lastDayOpen}
            />
          </div>

          <AppleAdsCampaignChart
            spendDays={dailySpend?.days}
            startDate={dailySpend?.startDate}
            endDate={dailySpend?.endDate}
            revenue={campaignRevenue}
            currency={currency}
            loading={spendLoading || revenueLoading}
            error={!!spendError}
            revenueError={!!revenueError}
            campaignId={campaignId}
          />

          <AppleAdsProfitCalculator
            campaign={campaign}
            trialStarts={trialEconomics.started}
            convertedTrials={trialEconomics.converted}
            proceedsPerConverted={trialEconomics.proceedsPerConverted}
            directBase={trialEconomics.directBase}
            loading={campaignsLoading || revenueLoading}
          />
        </>
      )}

      {tab === "countries" && (
        <>
          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Countries</div>
              {!countriesLoading && countriesData && !countriesData.revenueAvailable && (
                <div className={`text-[12px] ${textMuted} mt-0.5`}>Connect RevenueCat for trials &amp; proceeds</div>
              )}
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
        </>
      )}

      {tab === "overview" && (
        <>
          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Product Engagement</div>
            </div>
            {milestonesLoading ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
            ) : milestonesError || !milestonesData ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                {milestonesError ?? "Failed to load PostHog milestones"}
              </div>
            ) : !milestonesData.available ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                {milestonesData.reason === "no-app-mapped"
                  ? "No app mapped to this campaign's org — map one in Integrations."
                  : milestonesData.reason === "no-revenuecat"
                    ? "Connect RevenueCat for this app to track engagement."
                    : "Connect PostHog in Integrations to track engagement."}
              </div>
            ) : milestonesData.milestones.length === 0 ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                No milestones configured yet — add some in App Settings.
              </div>
            ) : (
              <div className="px-5 py-4 flex flex-col gap-5">
                {milestonesData.milestones.map((m) => {
                  const basis = campaign?.installs ?? milestonesData.totalInstalls;
                  const pct = basis > 0 ? Math.min(100, (m.completed / basis) * 100) : 0;
                  return (
                    <div key={m.label} className="flex items-center gap-4">
                      <div className="w-44 shrink-0">
                        <div className={`text-[12px] ${textMuted} truncate`} title={m.label}>
                          {m.label}
                        </div>
                        <div className={`text-[20px] font-semibold ${textPrimary} tabular-nums`}>
                          {fmtNumber(m.completed)} / {fmtNumber(basis)}
                        </div>
                        <div className={`text-[12px] ${textMuted} tabular-nums`}>{fmtPct(pct)} reached</div>
                      </div>
                      <div className="flex-1">
                        <div className="h-10 rounded-lg bg-[#595DD2] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "keywords" && (
        <>
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
                                <StatusDot status={g.status} />
                                {g.name}
                              </span>
                            </td>
                            <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                              {fmtMoney(g.defaultBidAmount, g.currency ?? currency)}
                            </td>
                            <StatCells stats={g} currency={g.currency ?? currency} ttrTrafficLight />
                          </tr>
                          {expanded && (
                            <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                              <td colSpan={10} className="px-5 py-4">
                                <div className="mb-3 flex items-center gap-3 flex-wrap">
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
                                <div className="mb-3">
                                  <AdGroupCppSettings
                                    campaignId={campaignId}
                                    adGroupId={g.id}
                                    canWrite={canWrite}
                                    addToast={addToast}
                                  />
                                </div>
                                <div
                                  className={`text-[12px] font-semibold ${textPrimary} mb-2 flex items-center justify-between gap-2`}
                                >
                                  <span>
                                    Keywords{" "}
                                    {g.cpaGoal != null && (
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
                                  <div className={`text-[12px] ${textMuted}`}>
                                    No keywords match the current filters.
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-[12px] min-w-[1200px]">
                                      <thead>
                                        <tr>
                                          <th className={TH}></th>
                                          <KwSortTh col="keyword">Keyword</KwSortTh>
                                          <KwSortTh col="matchType">Match Type</KwSortTh>
                                          <KwSortTh col="bid" right>
                                            Bid
                                          </KwSortTh>
                                          <KwSortTh col="spend" right>
                                            Spend
                                          </KwSortTh>
                                          <KwSortTh col="impressions" right>
                                            Impressions
                                          </KwSortTh>
                                          <KwSortTh col="taps" right>
                                            Taps
                                          </KwSortTh>
                                          <KwSortTh col="ttr" right>
                                            TTR
                                          </KwSortTh>
                                          <KwSortTh col="installs" right>
                                            Installs
                                          </KwSortTh>
                                          <KwSortTh col="avgCpt" right>
                                            Avg CPT
                                          </KwSortTh>
                                          <KwSortTh col="avgCpa" right>
                                            Avg CPA
                                          </KwSortTh>
                                          <KwSortTh col="convRate" right>
                                            Conv. Rate
                                          </KwSortTh>
                                          <KwSortTh col="rcTxns" right>
                                            Txns
                                          </KwSortTh>
                                          <KwSortTh col="rcProceeds" right last>
                                            Proceeds
                                          </KwSortTh>
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
                                            <select
                                              value={kwFilter.matchType}
                                              onChange={setKwFilterValue("matchType")}
                                              className={kwFilterInput}
                                            >
                                              <option value="">All</option>
                                              {[...new Set(g.keywords.map((k) => k.matchType))].sort().map((v) => (
                                                <option key={v} value={v}>
                                                  {v}
                                                </option>
                                              ))}
                                            </select>
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.bid}
                                              onChange={setKwFilterValue("bid")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.spend}
                                              onChange={setKwFilterValue("spend")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.impressions}
                                              onChange={setKwFilterValue("impressions")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.taps}
                                              onChange={setKwFilterValue("taps")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.ttr}
                                              onChange={setKwFilterValue("ttr")}
                                              placeholder="min %"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.installs}
                                              onChange={setKwFilterValue("installs")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.avgCpt}
                                              onChange={setKwFilterValue("avgCpt")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.avgCpa}
                                              onChange={setKwFilterValue("avgCpa")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.convRate}
                                              onChange={setKwFilterValue("convRate")}
                                              placeholder="min %"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={kwFilterCell}>
                                            <input
                                              value={kwFilter.rcTxns}
                                              onChange={setKwFilterValue("rcTxns")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
                                          </th>
                                          <th className={`${kwFilterCell} pr-5`}>
                                            <input
                                              value={kwFilter.rcProceeds}
                                              onChange={setKwFilterValue("rcProceeds")}
                                              placeholder="min"
                                              inputMode="decimal"
                                              className={`${kwFilterInput} text-right`}
                                            />
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
                                                  <span
                                                    className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}
                                                  >
                                                    <StatusDot status={k.status} />
                                                    {k.text}
                                                  </span>
                                                </td>
                                                <td className={`${TD} ${textMuted}`}>{k.matchType}</td>
                                                <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                                                  {fmtMoney(k.bidAmount, k.currency ?? g.currency ?? currency)}
                                                </td>
                                                <StatCells
                                                  stats={k}
                                                  currency={k.currency ?? g.currency ?? currency}
                                                  ttrTrafficLight
                                                />
                                                <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                                                  {revenueLoading
                                                    ? "…"
                                                    : revenueError
                                                      ? "—"
                                                      : fmtNumber(kwRevenue?.transactions.length ?? 0)}
                                                </td>
                                                <td
                                                  className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}
                                                >
                                                  {revenueLoading
                                                    ? "…"
                                                    : revenueError
                                                      ? "—"
                                                      : fmtMoney(kwRevenue?.proceedsUsd ?? 0, "USD")}
                                                </td>
                                              </tr>
                                              {kwExpanded && campaignId && (
                                                <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                                                  <td colSpan={14} className="px-4 py-3">
                                                    <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>
                                                      Countries
                                                    </div>
                                                    <div className="mb-4">
                                                      <KeywordCountries
                                                        campaignId={campaignId}
                                                        adGroupId={g.id}
                                                        keywordId={k.id}
                                                        currency={k.currency ?? g.currency ?? currency}
                                                        query={query}
                                                      />
                                                    </div>
                                                    <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>
                                                      Devices
                                                    </div>
                                                    <div className={kwRevenue ? "mb-4" : ""}>
                                                      <KeywordDevices
                                                        campaignId={campaignId}
                                                        adGroupId={g.id}
                                                        keywordId={k.id}
                                                        currency={k.currency ?? g.currency ?? currency}
                                                        query={query}
                                                      />
                                                    </div>
                                                    {kwRevenue && (
                                                      <>
                                                        <div
                                                          className={`text-[12px] font-semibold ${textPrimary} mb-2`}
                                                        >
                                                          Revenue
                                                        </div>
                                                        <table className="w-full text-[12px]">
                                                          <thead>
                                                            <tr>
                                                              <th className={TH}>Date</th>
                                                              <th className={TH}>App</th>
                                                              <th className={TH}>Product</th>
                                                              <th className={TH}>Type</th>
                                                              <th className={TH}>Country</th>
                                                              <th className={`${TH} text-right`}>Proceeds</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {kwRevenue.transactions.map((t) => (
                                                              <tr key={t.id}>
                                                                <td className={TD}>{t.date.slice(0, 10)}</td>
                                                                <td className={TD}>{t.app}</td>
                                                                <td className={TD}>
                                                                  <span
                                                                    className={`font-medium ${textPrimary}`}
                                                                    title={t.product}
                                                                  >
                                                                    {prettyProductName(t.product)}
                                                                  </span>
                                                                </td>
                                                                <td className={TD}>
                                                                  <TransactionTypeBadge type={adsTransactionType(t)} />
                                                                </td>
                                                                <td className={TD}>
                                                                  {t.country ? (
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                      <img
                                                                        src={`/country-flags/${t.country.toLowerCase()}.svg`}
                                                                        alt={t.country}
                                                                        className="w-4 h-3 rounded-xs object-cover shrink-0"
                                                                        onError={(e) => {
                                                                          (e.target as HTMLImageElement).style.display =
                                                                            "none";
                                                                        }}
                                                                      />
                                                                      {t.country}
                                                                    </span>
                                                                  ) : (
                                                                    <span className={textMuted}>—</span>
                                                                  )}
                                                                </td>
                                                                <td className={`${TD} text-right tabular-nums`}>
                                                                  {fmtMoney(t.proceedsUsd, "USD")}
                                                                </td>
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
        </>
      )}

      {tab === "activity" && (
        <>{campaignId && <AppleAdsCampaignHistory campaignId={campaignId} refreshToken={historyToken} />}</>
      )}

      {tab === "keywords" && (
        <>
          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Search Terms</div>
            </div>
            {searchTermsLoading ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
            ) : searchTermsError || !searchTermsData ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                {searchTermsError ?? "Failed to load search terms"}
              </div>
            ) : searchTermsData.searchTerms.length === 0 ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No search terms for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] text-[12px]">
                  <thead>
                    <tr>
                      <th className={TH}>Search Term</th>
                      <th className={TH}>Ad Group</th>
                      <th className={TH}>Keyword</th>
                      <th className={TH}>Match</th>
                      {STAT_HEADERS.map((h) => (
                        <th key={h} className={`${TH} text-right ${h === "Conv. Rate" ? "pr-5" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {searchTermsData.searchTerms.map((t) => (
                      <tr
                        key={`${t.adGroupId}::${t.keywordId}::${t.searchTerm}`}
                        className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors"
                      >
                        <td className={TD}>
                          <span className={`font-medium ${textPrimary}`}>{t.searchTerm}</span>
                          {t.keywordTotal && <span className={`text-[11px] ${textMuted}`}> · keyword total</span>}
                        </td>
                        <td className={`${TD} ${textMuted}`}>{t.adGroupName ?? "—"}</td>
                        <td className={TD}>{t.keyword ?? "—"}</td>
                        <td className={`${TD} ${textMuted}`}>{t.matchType ?? "—"}</td>
                        <StatCells stats={t} currency={currency} ttrTrafficLight />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {campaignId && <CppProposals campaignId={campaignId} canWrite={canWrite} addToast={addToast} />}
        </>
      )}

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
                  <NegativeKeywordManager
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

      {showSettings &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10 px-4">
            <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setShowSettings(false)} />
            <div
              className={`relative w-full max-w-2xl max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
            >
              <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
                <div>
                  <h2 className={`text-lg font-semibold ${textPrimary}`}>Campaign Settings</h2>
                  <div className={`text-[12px] ${textMuted} mt-0.5`}>{campaign?.name ?? "Campaign"}</div>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  aria-label="Close"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex flex-col gap-6">
                {canManageTeam && (campaignStatus === "ENABLED" || campaignStatus === "PAUSED") && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {campaignStatus && <StatusDot status={campaignStatus} />}
                      <span className={`text-[13px] ${textPrimary}`}>
                        {campaignStatus === "ENABLED" ? "Campaign is live and spending" : "Campaign is paused"}
                      </span>
                    </div>
                    <button
                      onClick={handleToggleStatus}
                      disabled={toggling}
                      className={btnSecSm}
                      title={campaignStatus === "ENABLED" ? "Pause campaign" : "Resume campaign"}
                    >
                      {campaignStatus === "ENABLED" ? "Pause" : "Resume"}
                    </button>
                  </div>
                )}
                <div>
                  <div className={`text-[13px] font-semibold ${textPrimary} mb-1`}>
                    Negative Keywords
                    {!negativesLoading && negativesData && (
                      <span className={`font-normal ${textMuted}`}> ({negativesData.campaign.length})</span>
                    )}
                  </div>
                  <div className={`text-[12px] ${textMuted} mb-3`}>Campaign level — apply to all ad groups</div>
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
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
