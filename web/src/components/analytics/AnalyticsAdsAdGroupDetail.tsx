import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Megaphone, MousePointerClick, Download, Tag, Receipt, Percent, CircleDollarSign } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { useCountryBreakdown } from "../../hooks/useCountryBreakdown";
import AdGroupKeywordsPanel from "./AdGroupKeywordsPanel";
import AppleAdsMilestoneRows from "./AppleAdsMilestoneRows";
import AppleAdsNegativesModal, { type NegativesModalTarget } from "./AppleAdsNegativesModal";
import { StatCard } from "../StatCard";
import { StatusDot } from "../StatusDot";
import { STAT_HEADERS, StatCells } from "./AppleAdsStatCells";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtMoney, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
import type {
  AppleAdsCampaign,
  AppleAdsCampaignDetail,
  AppleAdsCampaignMilestonesResponse,
  AppleAdsCampaignRevenue,
  AppleAdsNegativesResponse,
  AppleAdsRevenueBucket,
  AppleAdsSearchTermsResponse,
} from "../../types";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsAdsAdGroupDetail({ addToast }: Props) {
  const { campaignId, adGroupId } = useParams<{ campaignId: string; adGroupId: string }>();
  const { canWrite, canManageTeam } = usePermissions();
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const query = useMemo(() => rangeToParams(range, customStart, customEnd).replace(/^&/, "?"), [range, customStart, customEnd]);
  const [negativesModal, setNegativesModal] = useState<NegativesModalTarget | null>(null);

  const { data: campaignsData } = useApi<{ campaigns: AppleAdsCampaign[] }>(
    `/apple-ads/campaigns${query}`,
    [query],
    true,
  );
  const campaign = campaignsData?.campaigns.find((c) => c.id === campaignId) ?? null;

  const { data: detail } = useApi<AppleAdsCampaignDetail>(`/apple-ads/campaigns/${campaignId}/details${query}`, [
    campaignId,
    query,
  ]);
  const group = detail?.adGroups.find((g) => g.id === adGroupId) ?? null;

  const { data: revenueData, loading: revenueLoading } = useApi<AppleAdsCampaignRevenue>(
    `/apple-ads/campaign-revenue${query}`,
    [query],
    true,
  );
  const groupRevenue = useMemo(() => {
    if (!group) return undefined;
    const byKeyword = revenueData?.byCampaign[campaignId ?? ""]?.byKeyword;
    const txns = group.keywords.flatMap((k) => byKeyword?.[k.id]?.transactions ?? []);
    const proceeds = txns.reduce((sum, t) => sum + (t.proceedsUsd ?? 0), 0);
    return { txns, proceeds };
  }, [group, revenueData, campaignId]);

  const revenueByKeyword = useMemo(() => {
    if (!group) return undefined;
    const byKeyword = revenueData?.byCampaign[campaignId ?? ""]?.byKeyword;
    if (!byKeyword) return undefined;
    const out: Record<string, AppleAdsRevenueBucket> = {};
    for (const k of group.keywords) {
      if (byKeyword[k.id]) out[k.id] = byKeyword[k.id];
    }
    return out;
  }, [group, revenueData, campaignId]);

  const { data: searchTermsData } = useApi<AppleAdsSearchTermsResponse>(
    `/apple-ads/campaigns/${campaignId}/search-terms${query}`,
    [campaignId, query],
    true,
  );
  const groupSearchTerms = useMemo(
    () => (searchTermsData?.searchTerms ?? []).filter((t) => t.adGroupId === adGroupId),
    [searchTermsData, adGroupId],
  );

  const { data: milestonesData, loading: milestonesLoading } = useCountryBreakdown<AppleAdsCampaignMilestonesResponse>(
    campaignId && adGroupId ? `/apple-ads/campaigns/${campaignId}/milestones${query}&adGroupId=${adGroupId}` : null,
  );

  const {
    data: negativesData,
    loading: negativesLoading,
    error: negativesError,
    refetch: refetchNegatives,
  } = useApi<AppleAdsNegativesResponse>(`/apple-ads/campaigns/${campaignId}/negatives`, [campaignId], true);
  const groupNegatives = adGroupId ? (negativesData?.adGroups.find((a) => a.id === adGroupId)?.negatives ?? []) : [];

  const currency = group?.currency ?? campaign?.currency ?? "USD";

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to={`/apple-ads/${campaignId}`}
          className={`p-1.5 rounded-lg hover:bg-[#f3f4f6] dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className={`w-9 h-9 rounded-xl bg-black flex items-center justify-center shrink-0`}>
          <Megaphone className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className={`${pageTitle} leading-tight truncate`}>{group?.name ?? "Ad Group"}</h1>
            {group && <StatusDot status={group.status} />}
          </div>
          {campaign && <div className={`text-[12px] ${textMuted} truncate`}>{campaign.name}</div>}
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

      {group && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          <StatCard
            label="Spend"
            value={fmtMoney(group.spend, group.currency ?? currency)}
            sub={rangeLabel(range)}
            icon={<CircleDollarSign className="w-4 h-4" />}
            color="#f59e0b"
          />
          <StatCard
            label="Taps"
            value={fmtNumber(group.taps)}
            sub={rangeLabel(range)}
            icon={<MousePointerClick className="w-4 h-4" />}
            color="#6366f1"
          />
          <StatCard
            label="Installs"
            value={fmtNumber(group.installs)}
            sub={rangeLabel(range)}
            icon={<Download className="w-4 h-4" />}
            color="#10b981"
          />
          <StatCard
            label="Avg CPT"
            value={fmtMoney(group.avgCpt, group.currency ?? currency)}
            sub="Spend / Taps"
            icon={<Tag className="w-4 h-4" />}
            color="#14b8a6"
          />
          <StatCard
            label="Avg CPA"
            value={fmtMoney(group.avgCpa, group.currency ?? currency)}
            sub="Spend / Installs"
            icon={<Receipt className="w-4 h-4" />}
            color="#f43d5e"
          />
          <StatCard
            label="Proceeds"
            value={revenueLoading ? "…" : fmtMoney(groupRevenue?.proceeds ?? 0, "USD")}
            sub={rangeLabel(range)}
            icon={<Percent className="w-4 h-4" />}
            color="#16a34a"
          />
        </div>
      )}

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Product Engagement</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            How far installs from this ad group actually got in the app, from PostHog
          </div>
        </div>
        {milestonesLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : !milestonesData ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Failed to load engagement data</div>
        ) : !milestonesData.available ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {milestonesData.reason === "no-app-mapped"
              ? "No app mapped to this campaign's org — map one in Integrations."
              : milestonesData.reason === "no-revenuecat"
                ? "Connect RevenueCat for this app to track engagement."
                : milestonesData.reason === "no-posthog"
                  ? "Connect PostHog in Integrations to track engagement."
                  : "No milestones configured yet — add some in App Settings."}
          </div>
        ) : milestonesData.milestones.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No milestones configured yet.</div>
        ) : (
          <AppleAdsMilestoneRows
            milestones={milestonesData.milestones}
            variants={milestonesData.variants}
            basisInstalls={group?.installs}
            fallbackTotal={milestonesData.totalInstalls}
          />
        )}
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Keywords</div>
        </div>
        <div className="px-5 py-4">
          {!group ? (
            <div className={`text-[13px] ${textMuted}`}>Loading…</div>
          ) : (
            <AdGroupKeywordsPanel
              campaignId={campaignId}
              group={group}
              currency={currency}
              revenueByKeyword={revenueByKeyword}
              revenueLoading={revenueLoading}
              revenueError={null}
              rangeQuery={query}
              canWrite={canWrite}
              negativeCount={negativesLoading || negativesError ? null : groupNegatives.length}
              onOpenNegatives={() => setNegativesModal({ scope: "adGroup", id: group.id, name: group.name })}
              addToast={addToast}
            />
          )}
        </div>
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Search Terms</div>
        </div>
        {groupSearchTerms.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No search terms for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-[12px]">
              <thead>
                <tr>
                  <th className={TH}>Search Term</th>
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
                {groupSearchTerms.map((t) => (
                  <tr
                    key={`${t.adGroupId}::${t.keywordId}::${t.searchTerm}`}
                    className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors"
                  >
                    <td className={TD}>
                      <span className={`font-medium ${textPrimary}`}>{t.searchTerm}</span>
                      {t.keywordTotal && <span className={`text-[11px] ${textMuted}`}> · keyword total</span>}
                    </td>
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

      <AppleAdsNegativesModal
        target={negativesModal}
        campaignId={campaignId}
        negatives={groupNegatives}
        negativesLoading={negativesLoading}
        negativesError={negativesError}
        canEdit={canManageTeam}
        onChanged={refetchNegatives}
        onClose={() => setNegativesModal(null)}
      />
    </div>
  );
}
