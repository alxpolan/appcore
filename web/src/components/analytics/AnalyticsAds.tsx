import { Fragment, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Megaphone, ArrowRight, ChevronRight, ExternalLink } from "lucide-react";
import { useApi, apiPost } from "../../hooks/useApi";
import type { AppleAdsCampaign, AppleAdsCampaignRevenue, AppleAdsOrgsResponse, AppleAdsStatus } from "../../types";
import { TD, TH, borderDefault, inputCls, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber } from "../../utils/formatters";

function fmtMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function statusBadge(status: string) {
  const isOn = status === "ENABLED";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
        isOn
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          : "bg-gray-100 text-gray-600 dark:bg-[#252b38] dark:text-[#8b93a5]"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AnalyticsAds() {
  const navigate = useNavigate();
  const { data: status, refetch: refetchStatus } = useApi<AppleAdsStatus>("/apple-ads/status", [], true);
  const {
    data: orgsData,
    refetch: refetchOrgs,
  } = useApi<AppleAdsOrgsResponse>("/apple-ads/orgs", [status?.connected], true);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const {
    data: campaignsData,
    loading,
    error,
    refetch: refetchCampaigns,
  } = useApi<{ campaigns: AppleAdsCampaign[] }>("/apple-ads/campaigns", [status?.connected, status?.orgId], true);
  const { data: revenueData, loading: revenueLoading, error: revenueError, refetch: refetchRevenue } =
    useApi<AppleAdsCampaignRevenue>("/apple-ads/campaign-revenue", [status?.connected, status?.orgId], true);

  const handleOrgChange = async (orgId: string) => {
    setSwitchingOrg(true);
    try {
      await apiPost("/apple-ads/org", { orgId });
      await Promise.all([refetchStatus(), refetchOrgs()]);
      refetchCampaigns();
      refetchRevenue();
      setExpandedCampaign(null);
    } finally {
      setSwitchingOrg(false);
    }
  };

  const campaigns = campaignsData?.campaigns ?? [];
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      taps: acc.taps + c.taps,
      installs: acc.installs + c.installs,
    }),
    { spend: 0, impressions: 0, taps: 0, installs: 0 },
  );
  const currency = campaigns.find((c) => c.currency)?.currency ?? "USD";

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className={`${pageTitle} mb-1`}>Ads</h1>
          <p className={`text-[13px] ${textSecondary}`}>Apple Search Ads campaigns and attributed RevenueCat transactions, last 30 days.</p>
        </div>
        {status?.connected && orgsData && orgsData.orgs.length > 0 && (
          <label className="flex flex-col items-end gap-1 shrink-0">
            <span className={`text-[11px] ${textMuted}`}>Campaign Group</span>
            <select
              className={`${inputCls} min-w-[220px]`}
              value={status.orgId ?? ""}
              disabled={switchingOrg}
              onChange={(e) => handleOrgChange(e.target.value)}
            >
              {orgsData.orgs.map((o) => (
                <option key={o.orgId} value={o.orgId}>
                  {o.orgName} ({o.orgId})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!status?.connected ? (
        <div className={`rounded-2xl border ${borderDefault} bg-white dark:bg-[#1c2028] p-5`}>
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-xl bg-black flex items-center justify-center shrink-0 shadow-sm`}
            >
              <Megaphone className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[15px] font-bold ${textPrimary}`}>Connect Apple Search Ads</div>
              <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>
                Connect your Apple Search Ads account in Integrations to see campaign spend and performance here.
              </p>
              <Link
                to="/integrations"
                className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#1a1a2e] text-white dark:bg-[#e8eaf0] dark:text-[#1a1a2e] hover:opacity-90 transition-all"
              >
                Go to Integrations
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {[
              { label: "Spend", value: fmtMoney(totals.spend, currency) },
              { label: "Impressions", value: fmtNumber(totals.impressions) },
              { label: "Taps", value: fmtNumber(totals.taps) },
              { label: "Installs", value: fmtNumber(totals.installs) },
            ].map((s) => (
              <div
                key={s.label}
                className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
              >
                <div className={`text-[13px] font-semibold ${textPrimary} mb-2`}>{s.label}</div>
                <div className={`text-[28px] font-bold leading-none ${textPrimary}`}>{s.value}</div>
              </div>
            ))}
          </div>

          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
              <Megaphone className={`w-4 h-4 ${textMuted}`} />
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Campaigns</div>
            </div>
            <div className={`px-5 py-2 text-[11px] ${textMuted} border-b border-[#f3f4f6] dark:border-[#2a2f3d]`}>
              RevenueCat proceeds are in USD and include later purchases by customers attributed to each Apple Ads campaign.
            </div>
            {loading ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
            ) : error ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Failed to load campaigns</div>
            ) : campaigns.length === 0 ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No campaigns found</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <thead>
                  <tr>
                    <th className={TH}>Campaign</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} text-right`}>Daily Budget</th>
                    <th className={`${TH} text-right`}>Spend</th>
                    <th className={`${TH} text-right`}>Impressions</th>
                    <th className={`${TH} text-right`}>Taps</th>
                    <th className={`${TH} text-right`}>Installs</th>
                    <th className={`${TH} text-right`}>Transactions</th>
                    <th className={`${TH} text-right`}>RC Proceeds</th>
                    <th className={`${TH} pr-5`}></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (<Fragment key={c.id}>
                    <tr onClick={() => setExpandedCampaign(expandedCampaign === c.id ? null : c.id)} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer">
                      <td className={TD}>
                        <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                          <ChevronRight className={`w-3.5 h-3.5 ${textMuted} transition-transform ${expandedCampaign === c.id ? "rotate-90" : ""}`} />
                          {c.name}
                        </span>
                      </td>
                      <td className={TD}>{statusBadge(c.status)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {c.dailyBudget != null ? fmtMoney(c.dailyBudget, c.currency) : "—"}
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(c.spend, c.currency)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.impressions)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.taps)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.installs)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {revenueLoading ? "…" : revenueError ? "—" : fmtNumber(revenueData?.byCampaign[c.id]?.transactions.length ?? 0)}
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {revenueLoading ? "…" : revenueError ? "—" : fmtMoney(revenueData?.byCampaign[c.id]?.proceedsUsd ?? 0, "USD")}
                      </td>
                      <td className={`${TD} text-right pr-5`}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/analytics/ads/${c.id}`);
                          }}
                          className={`inline-flex items-center gap-1 text-[12px] font-medium text-[#595DD2] hover:underline`}
                        >
                          Details <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                    {expandedCampaign === c.id && (
                      <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                        <td colSpan={10} className="px-5 py-4">
                          <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>RevenueCat transactions</div>
                          {revenueLoading ? (
                            <div className={`text-[12px] ${textMuted}`}>Loading…</div>
                          ) : revenueError ? (
                            <div className="text-[12px] text-red-500">Could not load attributed transactions.</div>
                          ) : !revenueData?.byCampaign[c.id]?.transactions.length ? (
                            <div className={`text-[12px] ${textMuted}`}>No attributed transactions in the last 30 days.</div>
                          ) : (
                            <div className="max-h-80 overflow-auto">
                              <table className="w-full text-[12px]">
                                <thead><tr>
                                  <th className={TH}>Date</th><th className={TH}>App</th><th className={TH}>Product</th>
                                  <th className={TH}>Event</th><th className={`${TH} text-right`}>Proceeds (USD)</th>
                                </tr></thead>
                                <tbody>{revenueData.byCampaign[c.id].transactions.map((transaction) => (
                                  <tr key={transaction.id}>
                                    <td className={TD}>{transaction.date.slice(0, 10)}</td>
                                    <td className={TD}>{transaction.app}</td>
                                    <td className={TD}>{transaction.product}</td>
                                    <td className={TD}>{transaction.eventType.replace(/_/g, " ")}</td>
                                    <td className={`${TD} text-right tabular-nums`}>{fmtMoney(transaction.proceedsUsd, "USD")}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
