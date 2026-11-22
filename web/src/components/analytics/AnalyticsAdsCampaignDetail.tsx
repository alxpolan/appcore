import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Megaphone,
  Settings,
  ChevronRight,
  X,
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
import type {
  AppleAdsCampaign,
  AppleAdsCampaignDetail,
  AppleAdsCampaignMilestonesResponse,
  AppleAdsCampaignRevenue,
  AppleAdsCountryBreakdownResponse,
  AppleAdsDailySpendResponse,
  AppleAdsNegativesResponse,
  AppleAdsSearchTermsResponse,
} from "../../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary } from "../../styles";
import AdGroupKeywordsPanel from "./AdGroupKeywordsPanel";
import AppleAdsNegativesModal, { type NegativesModalTarget } from "./AppleAdsNegativesModal";
import { fmtMoney, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
import AppleAdsCampaignChart from "./AppleAdsCampaignChart";
import AppleAdsProfitCalculator from "./AppleAdsProfitCalculator";
import AppleAdsCampaignHistory from "./AppleAdsCampaignHistory";
import AppleAdsMilestoneRows from "./AppleAdsMilestoneRows";
import { StatCard } from "../StatCard";
import { StatusDot } from "../StatusDot";
import { STAT_HEADERS, StatCells } from "./AppleAdsStatCells";
import { CountryStatsTable } from "./AppleAdsCountryTable";
import { NegativeKeywordManager } from "./AppleAdsNegativeKeywords";


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
              <AppleAdsMilestoneRows
                milestones={milestonesData.milestones}
                variants={milestonesData.variants}
                basisInstalls={campaign?.installs}
                fallbackTotal={milestonesData.totalInstalls}
              />
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
                                <Link
                                  to={`/apple-ads/${campaignId}/adgroups/${g.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="hover:text-[#595DD2] hover:underline transition-colors"
                                >
                                  {g.name}
                                </Link>
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
                                <AdGroupKeywordsPanel
                                  campaignId={campaignId}
                                  group={g}
                                  currency={currency}
                                  revenueByKeyword={campaignRevenue?.byKeyword}
                                  revenueLoading={revenueLoading}
                                  revenueError={revenueError}
                                  rangeQuery={query}
                                  canWrite={canWrite}
                                  negativeCount={
                                    negativesLoading || negativesError
                                      ? null
                                      : (negativesByGroup.get(g.id) ?? []).length
                                  }
                                  onOpenNegatives={() => setNegativesModal({ scope: "adGroup", id: g.id, name: g.name })}
                                  addToast={addToast}
                                />
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

      <AppleAdsNegativesModal
        target={negativesModal}
        campaignId={campaignId}
        negatives={
          !negativesModal
            ? []
            : negativesModal.scope === "campaign"
              ? (negativesData?.campaign ?? [])
              : (negativesByGroup.get(negativesModal.id) ?? [])
        }
        negativesLoading={negativesLoading}
        negativesError={negativesError}
        canEdit={canManageTeam}
        onChanged={handleNegativesChanged}
        onClose={() => setNegativesModal(null)}
      />

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
