import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Megaphone,
  ArrowRight,
  Check,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  MousePointerClick,
  Pause,
  Percent,
  Plus,
  TrendingUp,
  X,
} from "lucide-react";
import { getActiveBundleId, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { AppItem, GoogleAdsCampaign, GoogleAdsDailyStatsResponse, GoogleAdsStatus } from "../../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
import AnalyticsGoogleAdsCreateCampaign from "./AnalyticsGoogleAdsCreateCampaign";
import { StatCard } from "../StatCard";

function fmtMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function statusDot(status: string) {
  const isOn = status === "ENABLED";
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

export default function AnalyticsGoogleAds() {
  const navigate = useNavigate();
  const { canManageTeam } = usePermissions();
  const [showCreate, setShowCreate] = useState(false);
  const { data: status } = useApi<GoogleAdsStatus>("/google-ads/status", [], true);
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const activeBundleId = getActiveBundleId();
  const activeAppId =
    apps?.find((a) => a.bundleId === activeBundleId)?.id ?? apps?.[0]?.id ?? null;
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const query = useMemo(() => {
    const base = rangeToParams(range, customStart, customEnd).replace(/^&/, "?");
    return activeAppId ? `${base}&appId=${activeAppId}` : base;
  }, [range, customStart, customEnd, activeAppId]);
  const rangeDeps = [range, customStart, customEnd];
  const {
    data: campaignsData,
    loading,
    error,
    refetch: refetchCampaigns,
  } = useApi<{ campaigns: GoogleAdsCampaign[] }>(
    `/google-ads/campaigns${query}`,
    [status?.connected, activeAppId, ...rangeDeps],
    false,
  );
  const { data: dailyData } = useApi<GoogleAdsDailyStatsResponse>(
    `/google-ads/daily${query}`,
    [status?.connected, activeAppId, ...rangeDeps],
    false,
  );
  const days = dailyData?.days ?? [];

  const campaigns = campaignsData?.campaigns ?? [];
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      installs: acc.installs + (c.apple?.downloads ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, installs: 0 },
  );
  const currency = campaigns.find((c) => c.currency)?.currency ?? "USD";

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className={`${pageTitle} mb-1`}>Google Ads</h1>
      </div>

      {!status?.connected ? (
        <div className={`rounded-2xl border ${borderDefault} bg-white dark:bg-[#1c2028] p-5`}>
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl bg-black flex items-center justify-center shrink-0 shadow-sm`}>
              <Megaphone className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[15px] font-bold ${textPrimary}`}>Connect Google Ads</div>
              <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>
                Connect your Google Ads account in Integrations to see campaign spend and performance here.
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

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <StatCard
              label="Spend"
              value={loading ? "—" : fmtMoney(totals.spend, currency)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.spend)}
              icon={<DollarSign className="w-4 h-4" />}
              color="#f59e0b"
            />
            <StatCard
              label="Impressions"
              value={loading ? "—" : fmtNumber(totals.impressions)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.impressions)}
              icon={<Eye className="w-4 h-4" />}
              color="#0ea5e9"
            />
            <StatCard
              label="Clicks"
              value={loading ? "—" : fmtNumber(totals.clicks)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.clicks)}
              icon={<MousePointerClick className="w-4 h-4" />}
              color="#6366f1"
            />
            <StatCard
              label="Installs"
              value={loading ? "—" : fmtNumber(totals.installs)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.installs ?? 0)}
              icon={<Download className="w-4 h-4" />}
              color="#10b981"
            />
            <StatCard
              label="CTR"
              value={loading ? "—" : totals.impressions > 0 ? fmtPct((totals.clicks / totals.impressions) * 100) : "—"}
              sub="Clicks / Impressions"
              sparkline={days.map((d) => (d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0))}
              icon={<TrendingUp className="w-4 h-4" />}
              color="#8b5cf6"
            />
            <StatCard
              label="Conversion Rate"
              value={loading ? "—" : totals.clicks > 0 ? fmtPct((totals.installs / totals.clicks) * 100) : "—"}
              sub="Installs / Clicks"
              sparkline={days.map((d) => (d.clicks > 0 ? ((d.installs ?? 0) / d.clicks) * 100 : 0))}
              icon={<Percent className="w-4 h-4" />}
              color="#D94412"
            />
          </div>

          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
              <Megaphone className={`w-4 h-4 ${textMuted}`} />
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Campaigns</div>
              {canManageTeam && (
                <button onClick={() => setShowCreate(true)} className={`${btnSecSm} ml-auto`}>
                  <Plus className="w-3.5 h-3.5" /> New Campaign
                </button>
              )}
            </div>
            {loading ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
            ) : error ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>{error}</div>
            ) : campaigns.length === 0 ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                {activeAppId ? (
                  <>
                    No campaigns assigned to this app yet. Assign them in{" "}
                    <Link to="/integrations" className="font-medium text-[#595DD2] hover:underline">
                      Integrations
                    </Link>
                    .
                  </>
                ) : (
                  "No campaigns found"
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1400px]">
                  <thead>
                    <tr>
                      <th className={TH}>Campaign</th>
                      <th className={`${TH} text-right`}>Daily Budget</th>
                      <th className={`${TH} text-right`}>Spend</th>
                      <th className={`${TH} text-right`}>Impressions</th>
                      <th className={`${TH} text-right`}>Clicks</th>
                      <th className={`${TH} text-right`}>Avg CPC</th>
                      <th className={`${TH} text-right`} title="Spend per Apple download">
                        CPA
                      </th>
                      <th className={`${TH} text-right`} title="Apple trial starts attributed to the campaign token">
                        Trials
                      </th>
                      <th className={`${TH} text-right`} title="Apple purchases attributed to the campaign token">
                        Purchases
                      </th>
                      <th className={`${TH} text-right`} title="Apple proceeds attributed to the campaign token">
                        Proceeds
                      </th>
                      <th className={`${TH} pr-5`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/google-ads/${c.id}`)}
                        className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer"
                      >
                        <td className={TD}>
                          <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                            {statusDot(c.status)}
                            {c.name}
                          </span>
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.dailyBudget != null ? fmtMoney(c.dailyBudget, c.currency) : "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {fmtMoney(c.spend, c.currency)}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.impressions)}</td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.clicks)}</td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.avgCpc != null ? fmtMoney(c.avgCpc, c.currency) : "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.apple && c.apple.downloads > 0
                            ? fmtMoney(c.spend / c.apple.downloads, c.currency)
                            : "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.apple ? fmtNumber(c.apple.trials) : "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.apple ? fmtNumber(c.apple.purchases) : "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                          {c.apple ? fmtMoney(c.apple.proceedsUsd, "USD") : "—"}
                        </td>
                        <td className={`${TD} text-right pr-5`}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/google-ads/${c.id}`);
                            }}
                            className={`inline-flex items-center gap-1 text-[12px] font-medium text-[#595DD2] hover:underline`}
                          >
                            Details <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && !error && campaigns.length > 0 && (
              <div
                className={`px-5 py-3 border-t border-[#f3f4f6] dark:border-[#2a2f3d] text-[11px] ${textMuted}`}
              >
                CPA, Trials, Purchases and Proceeds come from Apple campaign attribution. Assign the
                campaign token in{" "}
                <Link to="/integrations" className="font-medium text-[#595DD2] hover:underline">
                  Integrations
                </Link>
                .
              </div>
            )}
          </div>
          {showCreate && (
            <AnalyticsGoogleAdsCreateCampaign
              onClose={() => setShowCreate(false)}
              onCreated={() => {
                setShowCreate(false);
                refetchCampaigns();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
