import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtLargeNum, fmtShortDate, fmtShortDateWithWeekday } from "../../utils/formatters";

export interface PerformanceDayInput {
  date: string;
  spend: number;
  impressions: number;
  actions: number;
  installs: number;
}

interface ChartMetric {
  key: string;
  label: string;
  color: string;
  axis: "left" | "right";
  kind: "money" | "count" | "pct";
}

function fmtMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

const CustomTooltip = ({ active, payload, label, currency, metrics }: any) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value !== null && p.value !== undefined);
  const kindOf = (key: string) => (metrics as ChartMetric[]).find((m) => m.key === key)?.kind;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-4 py-3`}
      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.08)", minWidth: 160 }}
    >
      <div className={`text-[11px] ${textMuted} mb-2 font-medium`}>{fmtShortDateWithWeekday(String(label))}</div>
      {rows.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 text-[12px] mb-1">
          <span className={`flex items-center gap-1.5 ${textSecondary}`}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className={`font-semibold ${textPrimary} tabular-nums`}>
            {kindOf(p.dataKey) === "money"
              ? fmtMoney(Number(p.value), currency)
              : kindOf(p.dataKey) === "pct"
                ? `${Number(p.value).toFixed(1)}%`
                : Number(p.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AdsOverviewChart({
  days,
  startDate,
  endDate,
  currency,
  loading,
  actionLabel,
  rateLabel,
}: {
  days: PerformanceDayInput[];
  startDate?: string;
  endDate?: string;
  currency: string;
  loading: boolean;
  actionLabel: string;
  rateLabel: string;
}) {
  const metrics: ChartMetric[] = useMemo(
    () => [
      { key: "spend", label: "Spend", color: "#f59e0b", axis: "right", kind: "money" },
      { key: "impressions", label: "Impressions", color: "#0ea5e9", axis: "left", kind: "count" },
      { key: "actions", label: actionLabel, color: "#6366f1", axis: "left", kind: "count" },
      { key: "installs", label: "Installs", color: "#10b981", axis: "left", kind: "count" },
      { key: "rate", label: rateLabel, color: "#8b5cf6", axis: "right", kind: "pct" },
      { key: "conversionRate", label: "Conv. Rate", color: "#D94412", axis: "right", kind: "pct" },
    ],
    [actionLabel, rateLabel],
  );
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(new Set(["spend", "actions", "installs"]));

  const chartData = useMemo(() => {
    if (!startDate || !endDate) return days;
    const byDate = new Map(days.map((d) => [d.date, d]));
    const points: {
      date: string;
      spend: number;
      impressions: number;
      actions: number;
      installs: number;
      rate: number;
      conversionRate: number;
    }[] = [];
    for (
      let cursor = new Date(`${startDate}T00:00:00Z`);
      cursor <= new Date(`${endDate}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      const d = byDate.get(key);
      const impressions = d?.impressions ?? 0;
      const actions = d?.actions ?? 0;
      const installs = d?.installs ?? 0;
      
      points.push({
        date: key,
        spend: d?.spend ?? 0,
        impressions,
        actions,
        installs,
        rate: impressions > 0 ? (actions / impressions) * 100 : 0,
        conversionRate: actions > 0 ? (installs / actions) * 100 : 0,
      });
    }
    return points;
  }, [days, startDate, endDate]);

  const showRightAxis = metrics.some((m) => m.axis === "right" && activeMetrics.has(m.key));

  function toggleMetric(key: string) {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Performance over time</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {metrics.map((m) => {
            const active = activeMetrics.has(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-colors cursor-pointer ${
                  active
                    ? "border-transparent text-white"
                    : `bg-white dark:bg-[#252b38] ${borderDefault} ${textMuted} hover:border-[#d1d5db] dark:hover:border-[#5c6478] hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
                }`}
                style={active ? { background: m.color, borderColor: m.color } : undefined}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: active ? "rgba(255,255,255,0.8)" : m.color }}
                />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className={`flex items-center justify-center h-52 text-[13px] ${textMuted}`}>Loading chart…</div>
      ) : days.length === 0 ? (
        <div className={`flex items-center justify-center h-52 text-[13px] ${textMuted}`}>No data for this range.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 4, right: showRightAxis ? 4 : 16, left: 0, bottom: 0 }}>
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
              yAxisId="left"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={fmtLargeNum}
            />
            {showRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={fmtLargeNum}
              />
            )}
            <Tooltip content={<CustomTooltip currency={currency} metrics={metrics} />} />
            {metrics
              .filter((m) => activeMetrics.has(m.key))
              .map((m) => (
                <Line
                  key={m.key}
                  yAxisId={m.axis}
                  type="monotoneX"
                  dataKey={m.key}
                  name={m.label}
                  stroke={m.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: m.color }}
                />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
