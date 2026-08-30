import { useState, useMemo, type ReactNode } from "react";
import { DollarSign, TrendingUp, Users, ShoppingBag } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import type { AnalyticsSummary, DashboardData, DownloadsData, LtvData, PurchaseData } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber, fmtRevenue, fmtRevenueShort, fmtShortDate } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams, rangeLabel } from "../../utils/analyticsRange";
import DemoModeFrame from "../DemoModeFrame";
import AscConnectCard from "../AscConnectCard";
import {
  generateDemoDownloads,
  generateDemoSummary,
  generateDemoLtv,
  generateDemoPurchases,
} from "../../utils/demoAnalyticsData";

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
}) {
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
  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);

  const { data: summary, loading: sumLoading } = useApi<AnalyticsSummary>(
    `/analytics/summary?bundleId=${bundleId}${params}`,
  );
  const { data: downloads } = useApi<DownloadsData>(`/analytics/downloads?bundleId=${bundleId}${params}`);
  const { data: ltv } = useApi<LtvData>(`/analytics/ltv?bundleId=${bundleId}${params}`);
  const { data: purchases, loading: purchasesLoading } = useApi<PurchaseData[]>(
    `/analytics/purchases?bundleId=${bundleId}&limit=100`,
  );

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;
  const demoDownloads = useMemo(() => generateDemoDownloads(range), [range]);
  const demoSummary = useMemo(() => generateDemoSummary(demoDownloads), [demoDownloads]);
  const demoLtv = useMemo(() => generateDemoLtv(demoDownloads), [demoDownloads]);
  const demoPurchases = useMemo(() => generateDemoPurchases(20), []);

  const effSummary = hasASC ? summary : demoSummary;
  const effDownloads = hasASC ? downloads : demoDownloads;
  const effLtv = hasASC ? ltv : demoLtv;
  const effPurchases = hasASC ? purchases : demoPurchases;
  const summaryLoading = hasASC && sumLoading;
  const effPurchasesLoading = hasASC && purchasesLoading;

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
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
      </div>

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
                <th className={TH}>Date</th>
                <th className={TH}>Product</th>
                <th className={TH}>Payment Method</th>
                <th className={TH}>Territory</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right pr-5`}>Proceeds</th>
              </tr>
            </thead>
            <tbody>
              {(effPurchases ?? []).map((p, i) => (
                <tr key={i} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                  <td className={TD}>{p.date}</td>
                  <td className={TD}>
                    <span className={`font-medium ${textPrimary}`}>{p.contentName}</span>
                    <span className={`text-[11px] ${textMuted} ml-2`}>{p.purchaseType}</span>
                  </td>
                  <td className={`${TD} ${textMuted}`}>{p.paymentMethod}</td>
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
                  <td className={`${TD} text-right pr-5 tabular-nums ${textPrimary}`}>{fmtRevenue(p.proceedsUsd)}</td>
                </tr>
              ))}
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
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#D94412]`}
            />
            <span className={`${textMuted} text-[12px]`}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#D94412]`}
            />
          </div>
        )}
      </div>

      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key to pull real revenue, LTV and transaction data."
          addToast={addToast}
        />
      )}

      {hasASC ? financialContent : <DemoModeFrame>{financialContent}</DemoModeFrame>}
    </div>
  );
}
