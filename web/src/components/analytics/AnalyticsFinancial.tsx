import { useState, useMemo, useEffect, Fragment, type ReactNode } from "react";
import {
  DollarSign,
  TrendingUp,
  Users,
  ShoppingBag,
  Hourglass,
  RefreshCw,
  ChevronRight,
  CirclePlus,
  CircleCheck,
  CircleDashed,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useApi, apiPost, getActiveBundleId } from "../../hooks/useApi";
import type {
  AnalyticsSummary,
  DashboardData,
  DownloadsData,
  LtvData,
  PurchaseData,
  TrialPotential,
} from "../../types";
import { TD, TH, borderDefault, btnPrimary, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import {
  countryName,
  fmtNumber,
  fmtRelativeDateTime,
  fmtRevenue,
  fmtRevenueShort,
  fmtShortDate,
} from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams, rangeLabel } from "../../utils/analyticsRange";
import DemoModeFrame from "../DemoModeFrame";
import AscConnectCard from "../AscConnectCard";
import {
  generateDemoDownloads,
  generateDemoSummary,
  generateDemoLtv,
  generateDemoPurchases,
} from "../../utils/demoAnalyticsData";

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: ReactNode }) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-[13px] font-semibold ${textPrimary}`}>{label}</span>
        {icon && <span className={textMuted}>{icon}</span>}
      </div>
      <div className={`text-[32px] font-bold leading-none mb-2 ${textPrimary}`}>{value}</div>
      {sub && <div className={`text-[12px] ${textMuted}`}>{sub}</div>}
    </div>
  );
}

const ChartCard = ({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) => (
  <div
    className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
  >
    <div className="mb-4">
      <div className={`text-[16px] font-semibold ${textPrimary}`}>{title}</div>
      {sub && <div className={`text-[12px] ${textMuted} mt-0.5`}>{sub}</div>}
    </div>
    {children}
  </div>
);

function DetailField({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] uppercase tracking-wide ${textMuted}`}>{label}</div>
      <div className={`truncate ${textPrimary} ${mono ? "font-mono text-[11px]" : ""}`} title={value}>
        {value}
      </div>
      {sub && <div className={`text-[11px] ${textMuted}`}>{sub}</div>}
    </div>
  );
}

function TransactionTypeBadge({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  let label = type;
  let Icon = CircleCheck;
  let color = "bg-slate-100 text-slate-600 dark:bg-[#2a2f3d] dark:text-[#a6aec0]";
  let iconColor = "text-slate-500 dark:text-[#a6aec0]";

  if (normalized === "new subscription" || normalized === "subscription") {
    label = normalized === "new subscription" ? "New Sub" : type;
    Icon = CirclePlus;
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  } else if (normalized === "one time") {
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  } else if (normalized === "trial") {
    Icon = CircleDashed;
    color = "bg-orange-50 text-slate-800 dark:bg-[#3d2a1e] dark:text-white";
    iconColor = "text-[#f97316] dark:text-[#fb923c]";
  } else if (normalized === "trial converted") {
    color = "bg-emerald-50 text-slate-800 dark:bg-[#203c30] dark:text-white";
    iconColor = "text-[#10b981] dark:text-[#32e4a5]";
  } else if (normalized === "trial canceled" || normalized === "trial cancelled" || normalized === "trial ended") {
    Icon = CircleDashed;
    color = "bg-red-50 text-slate-800 dark:bg-[#3c2427] dark:text-white";
    iconColor = "text-[#ef4444] dark:text-[#ff4d63]";
  } else if (normalized === "renewal") {
    Icon = RefreshCw;
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${color}`}
      title={type}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 stroke-[2.7] ${iconColor}`} aria-hidden="true" />
      {label}
    </span>
  );
}

const RevenueTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-4 py-3`}
      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
    >
      <div className={`text-[11px] ${textMuted} mb-1 font-medium`}>{fmtShortDate(String(label))}</div>
      <div className={`text-[13px] font-semibold ${textPrimary} tabular-nums`}>{fmtRevenue(payload[0].value)}</div>
    </div>
  );
};

const LtvTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-4 py-3`}
      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
    >
      <div className={`text-[11px] ${textMuted} mb-1 font-medium`}>{fmtShortDate(String(label))}</div>
      <div className={`text-[13px] font-semibold ${textPrimary} tabular-nums`}>{fmtRevenue(payload[0].value)}</div>
      <div className={`text-[11px] ${textSecondary} mt-0.5`}>per install, cumulative</div>
    </div>
  );
};

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsFinancial({ addToast }: Props) {
  const bundleId = getActiveBundleId() ?? "";
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);

  const {
    data: summary,
    loading: sumLoading,
    refetch: refetchSummary,
  } = useApi<AnalyticsSummary>(`/analytics/summary?bundleId=${bundleId}${params}`);
  const { data: downloads, refetch: refetchDownloads } = useApi<DownloadsData>(
    `/analytics/downloads?bundleId=${bundleId}${params}`,
  );
  const { data: ltv, refetch: refetchLtv } = useApi<LtvData>(`/analytics/ltv?bundleId=${bundleId}${params}`);
  const {
    data: purchases,
    loading: purchasesLoading,
    refetch: refetchPurchases,
  } = useApi<PurchaseData[]>(`/analytics/purchases?bundleId=${bundleId}&limit=100`);
  const {
    data: trialPotential,
    loading: trialsLoading,
    error: trialsError,
    refetch: refetchTrialPotential,
  } = useApi<TrialPotential>(`/analytics/trial-potential?bundleId=${bundleId}`);

  // A previous empty report may be in the client cache; refresh on each visit.
  useEffect(() => {
    refetchTrialPotential();
  }, [refetchTrialPotential]);

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;
  const hasRevenueCat = dash?.config?.hasRevenueCat ?? false;
  const hasAnySource = hasASC || hasRevenueCat;
  const demoDownloads = useMemo(() => generateDemoDownloads(range), [range]);
  const demoSummary = useMemo(() => generateDemoSummary(demoDownloads), [demoDownloads]);
  const demoLtv = useMemo(() => generateDemoLtv(demoDownloads), [demoDownloads]);
  const demoPurchases = useMemo(() => generateDemoPurchases(20), []);

  const effSummary = hasAnySource ? summary : demoSummary;
  const effDownloads = hasAnySource ? downloads : demoDownloads;
  const effLtv = hasAnySource ? ltv : demoLtv;
  const effPurchases = hasAnySource ? purchases : demoPurchases;
  const summaryLoading = hasAnySource && sumLoading;
  const effPurchasesLoading = hasAnySource && purchasesLoading;

  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiPost("/analytics/sync", { bundleId });
      addToast("Sync started — data will appear shortly", "info");
      setTimeout(() => {
        refetchSummary();
        refetchDownloads();
        refetchLtv();
        refetchPurchases();
      }, 3000);
    } catch (err: any) {
      addToast(err.message ?? "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };
  const effTrialPotential: TrialPotential | null = hasASC
    ? trialPotential
    : {
        reportDate: new Date().toISOString().slice(0, 10),
        trialCount: 24,
        potentialProceedsUsd: 164.42,
        unpricedTrials: 0,
        countryTotals: [
          { country: "US", trialCount: 14, proceedsUsd: 97.86 },
          { country: "DE", trialCount: 10, proceedsUsd: 66.56 },
        ],
      };

  const trialSub = trialsError
    ? "Trial data unavailable"
    : !effTrialPotential?.reportDate
      ? "No subscription report yet"
      : effTrialPotential.unpricedTrials > 0
        ? `${fmtNumber(effTrialPotential.trialCount)} active trials · country price unavailable for ${fmtNumber(effTrialPotential.unpricedTrials)}`
        : `${fmtNumber(effTrialPotential.trialCount)} active trials · country proceeds · as of ${fmtShortDate(effTrialPotential.reportDate)}`;

  const revenueByDay = effDownloads?.byDay.map((d) => ({ date: d.date, proceeds: d.proceeds })) ?? [];
  const ltvByDay = effLtv?.byDay ?? [];

  const avgTransactionValue = useMemo(() => {
    const rows = effPurchases ?? [];
    const totalProceeds = rows.reduce((s, r) => s + r.proceedsUsd, 0);
    const totalQty = rows.reduce((s, r) => s + r.purchases, 0);
    return totalQty > 0 ? totalProceeds / totalQty : 0;
  }, [effPurchases]);

  const financialContent = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <StatCard
          label="Revenue"
          value={summaryLoading ? "—" : fmtRevenue(effSummary?.totalProceeds ?? 0)}
          sub={rangeLabel(range)}
          icon={<DollarSign className="w-4 h-4" />}
        />
        <StatCard
          label="LTV"
          value={fmtRevenue(effLtv?.currentLtv ?? 0)}
          sub="proceeds per install, all time"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Paying Users"
          value={summaryLoading ? "—" : fmtNumber(effSummary?.totalPayingUsers ?? 0)}
          sub={rangeLabel(range)}
          icon={<Users className="w-4 h-4" />}
        />
        <StatCard
          label="Avg. Transaction"
          value={fmtRevenue(avgTransactionValue)}
          sub="last 100 transactions"
          icon={<ShoppingBag className="w-4 h-4" />}
        />
        <StatCard
          label="Trial Potential"
          value={hasASC && (trialsLoading || trialsError) ? "—" : fmtRevenue(effTrialPotential?.potentialProceedsUsd)}
          sub={trialSub}
          icon={<Hourglass className="w-4 h-4" />}
        />
      </div>

      {(effTrialPotential?.countryTotals.length ?? 0) > 0 && (
        <details className={`mb-5 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-5 py-4`}>
          <summary className={`cursor-pointer text-[13px] font-medium ${textSecondary}`}>
            Trial value by country
          </summary>
          <div className={`text-[12px] ${textMuted} mt-2 mb-3`}>
            First paid period at each country’s current subscription proceeds.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <th className={`${TH} pl-0`}>Country</th>
                  <th className={`${TH} text-right`}>Trials</th>
                  <th className={`${TH} text-right pr-0`}>Proceeds</th>
                </tr>
              </thead>
              <tbody>
                {effTrialPotential!.countryTotals.map((row) => (
                  <tr key={row.country}>
                    <td className={`${TD} pl-0`}>{countryName(row.country)}</td>
                    <td className={`${TD} text-right`}>{fmtNumber(row.trialCount)}</td>
                    <td className={`${TD} text-right pr-0`}>{fmtRevenue(row.proceedsUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <ChartCard title="Revenue over time" sub="Developer proceeds, by day">
          {revenueByDay.length === 0 ? (
            <div className={`flex items-center justify-center h-52 text-[13px] ${textMuted}`}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueByDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#f0f1f3" vertical={false} strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtShortDate}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={fmtRevenueShort}
                />
                <Tooltip content={<RevenueTooltip />} cursor={{ fill: "rgba(245,158,11,0.06)" }} />
                <Bar dataKey="proceeds" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="LTV over time" sub="Cumulative proceeds ÷ cumulative installs">
          {ltvByDay.length === 0 ? (
            <div className={`flex items-center justify-center h-52 text-[13px] ${textMuted}`}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={ltvByDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#f0f1f3" vertical={false} strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtShortDate}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={fmtRevenueShort}
                />
                <Tooltip content={<LtvTooltip />} />
                <Line
                  type="monotoneX"
                  dataKey="ltv"
                  stroke="#D94412"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: "#D94412" }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
          <ShoppingBag className={`w-4 h-4 ${textMuted}`} />
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Recent Transactions</div>
        </div>
        {effPurchasesLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : (effPurchases ?? []).length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No purchases synced yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={`${TH} pl-5`}></th>
                <th className={TH}>Date</th>
                <th className={TH}>Product</th>
                <th className={TH}>Type</th>
                <th className={TH}>Territory</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right pr-5`}>Proceeds</th>
              </tr>
            </thead>
            <tbody>
              {(effPurchases ?? []).map((p, i) => {
                const rc = p.revenueCat;
                const expanded = expandedRow === i;
                return (
                  <Fragment key={i}>
                    <tr
                      onClick={() => setExpandedRow(expanded ? null : i)}
                      className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer"
                    >
                      <td className={`${TD} pl-5 w-5`}>
                        <ChevronRight
                          className={`w-3.5 h-3.5 ${textMuted} transition-transform ${expanded ? "rotate-90" : ""}`}
                        />
                      </td>
                      <td className={TD}>{p.date}</td>
                      <td className={TD}>
                        <span className={`font-medium ${textPrimary}`}>{p.contentName}</span>
                      </td>
                      <td className={TD}>
                        <TransactionTypeBadge type={p.type} />
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <img
                            src={`/country-flags/${p.territory.toLowerCase()}.svg`}
                            alt={p.territory}
                            className="w-5 h-4 rounded-xs object-cover shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                          <span className={textPrimary}>{p.territory}</span>
                        </div>
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(p.purchases)}</td>
                      <td className={`${TD} text-right pr-5 tabular-nums ${textPrimary}`}>
                        {fmtRevenue(p.proceedsUsd)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-[12px]">
                            <DetailField
                              label="Source"
                              value={p.source === "RevenueCat" ? "RevenueCat" : rc ? "ASC + RevenueCat" : "ASC"}
                            />
                            <DetailField label="Payment Method" value={p.paymentMethod} />
                            {rc && (
                              <>
                                <DetailField label="RevenueCat ID" value={rc.id} mono />
                                {rc.transactionId && (
                                  <DetailField label="Transaction ID" value={rc.transactionId} mono />
                                )}
                                <DetailField label="Customer ID" value={rc.customerId} mono />
                                <DetailField label="Product ID" value={rc.productId} mono />
                                <DetailField label="Store" value={rc.store} />
                                <DetailField label="Environment" value={rc.environment} />
                                <DetailField label="Period Type" value={rc.periodType} />
                                {rc.renewalNumber != null && (
                                  <DetailField label="Renewal #" value={String(rc.renewalNumber)} />
                                )}
                                <DetailField
                                  label="Device"
                                  value={
                                    rc.customer?.platform
                                      ? `${rc.customer.platform}${rc.customer.platformVersion ? " " + rc.customer.platformVersion : ""}`
                                      : "—"
                                  }
                                />
                                <DetailField label="App Version" value={rc.customer?.appVersion ?? "—"} />
                                {p.source === "App Store Connect" && (
                                  <DetailField
                                    label="RevenueCat Proceeds"
                                    value={fmtRevenue(rc.proceedsUsd)}
                                    sub={`vs ${fmtRevenue(p.proceedsUsd)} from ASC`}
                                  />
                                )}
                              </>
                            )}
                          </div>
                          {!rc && (
                            <div className={`mt-2 text-[11px] ${textMuted}`}>
                              No RevenueCat record for this transaction.
                            </div>
                          )}
                          {rc?.customer && Object.keys(rc.customer.attributes).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                              <div className={`text-[11px] font-medium ${textMuted} mb-1.5`}>
                                Subscriber attributes (set by the app via RevenueCat's SDK — may include ad attribution)
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[12px]">
                                {Object.entries(rc.customer.attributes).map(([key, value]) => (
                                  <DetailField key={key} label={key} value={value ?? "—"} mono />
                                ))}
                              </div>
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
        )}
      </div>
    </>
  );

  return (
    <div className="max-w-[1440px] mx-auto">
      <h1 className={`${pageTitle} mb-6`}>Financial</h1>

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
        {hasAnySource && (
          <div className="flex items-center gap-3 ml-auto">
            {summary?.lastSyncAt && (
              <span className={`text-[12px] ${textMuted}`}>Last synced {fmtRelativeDateTime(summary.lastSyncAt)}</span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`${btnPrimary} inline-flex items-center gap-1.5 disabled:opacity-60`}
            >
              {syncing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync Now
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {!hasAnySource && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key, or RevenueCat, to pull real revenue, LTV and transaction data."
          addToast={addToast}
        />
      )}

      {hasAnySource ? financialContent : <DemoModeFrame>{financialContent}</DemoModeFrame>}
    </div>
  );
}
