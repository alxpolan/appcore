import { Fragment, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Megaphone, ChevronRight } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import type { AppleAdsCampaign, AppleAdsCampaignDetail, AppleAdsCampaignRevenue, AppleAdsStats } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";

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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className={`text-[11px] ${textMuted} mb-1.5`}>{label}</div>
      <div className={`text-[20px] font-bold leading-none ${textPrimary}`}>{value}</div>
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

export default function AnalyticsAdsCampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [expandedAdGroup, setExpandedAdGroup] = useState<string | null>(null);
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);

  const { data: campaignsData } = useApi<{ campaigns: AppleAdsCampaign[] }>("/apple-ads/campaigns", [], true);
  const campaign = campaignsData?.campaigns.find((c) => c.id === campaignId) ?? null;

  const {
    data: detail,
    loading,
    error,
  } = useApi<AppleAdsCampaignDetail>(`/apple-ads/campaigns/${campaignId}/details`, [campaignId], true);

  const {
    data: revenueData,
    loading: revenueLoading,
    error: revenueError,
  } = useApi<AppleAdsCampaignRevenue>("/apple-ads/campaign-revenue", [], true);
  const campaignRevenue = campaignId ? revenueData?.byCampaign[campaignId] : undefined;

  const adGroups = detail?.adGroups ?? [];
  const currency = campaign?.currency ?? adGroups.find((g) => g.currency)?.currency ?? "USD";

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
            {campaign && statusBadge(campaign.status)}
          </div>
          <p className={`text-sm ${textMuted}`}>
            {campaign?.countriesOrRegions?.join(", ") || "—"} · last 30 days
          </p>
        </div>
      </div>

      {campaign && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
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

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
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
                              Keywords {g.cpaGoal != null && (
                                <span className={`font-normal ${textMuted}`}>
                                  · CPA goal {fmtMoney(g.cpaGoal, g.currency ?? currency)}
                                </span>
                              )}
                            </div>
                            {g.keywords.length === 0 ? (
                              <div className={`text-[12px] ${textMuted}`}>No keywords in this ad group.</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-[12px] min-w-[1200px]">
                                  <thead>
                                    <tr>
                                      <th className={TH}></th>
                                      <th className={TH}>Keyword</th>
                                      <th className={TH}>Match Type</th>
                                      <th className={TH}>Status</th>
                                      <th className={`${TH} text-right`}>Bid</th>
                                      {STAT_HEADERS.map((h) => (
                                        <th key={h} className={`${TH} text-right`}>
                                          {h}
                                        </th>
                                      ))}
                                      <th className={`${TH} text-right`}>RC Txns</th>
                                      <th className={`${TH} text-right pr-5`}>RC Proceeds</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.keywords.map((k) => {
                                      const kwExpanded = expandedKeyword === k.id;
                                      const kwRevenue = campaignRevenue?.byKeyword[k.id];
                                      return (
                                        <Fragment key={k.id}>
                                          <tr
                                            onClick={() => kwRevenue && setExpandedKeyword(kwExpanded ? null : k.id)}
                                            className={kwRevenue ? "cursor-pointer hover:bg-[#f7f8fa] dark:hover:bg-[#252b38]" : ""}
                                          >
                                            <td className={`${TD} w-5`}>
                                              {kwRevenue && (
                                                <ChevronRight
                                                  className={`w-3.5 h-3.5 ${textMuted} transition-transform shrink-0 ${kwExpanded ? "rotate-90" : ""}`}
                                                />
                                              )}
                                            </td>
                                            <td className={`${TD} font-medium ${textPrimary}`}>{k.text}</td>
                                            <td className={`${TD} ${textMuted}`}>{k.matchType}</td>
                                            <td className={TD}>{statusBadge(k.status)}</td>
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
                                          {kwExpanded && kwRevenue && (
                                            <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                                              <td colSpan={15} className="px-4 py-3">
                                                <table className="w-full text-[12px]">
                                                  <thead>
                                                    <tr>
                                                      <th className={TH}>Date</th>
                                                      <th className={TH}>App</th>
                                                      <th className={TH}>Product</th>
                                                      <th className={TH}>Event</th>
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
                                                        <td className={`${TD} text-right tabular-nums`}>{fmtMoneyUsd(t.proceedsUsd)}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
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
    </div>
  );
}
