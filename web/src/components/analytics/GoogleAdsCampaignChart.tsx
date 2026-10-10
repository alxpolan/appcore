import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GoogleAdsDailySpendResponse } from "../../types";
import { borderDefault, textMuted, textPrimary } from "../../styles";

type ChartDay = { date: string; spend: number };

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function axisMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function chartDate(value: string): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}`;
}

function DailyTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { payload: ChartDay }[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  return (
    <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl px-3 py-2 shadow-lg text-[12px]`}>
      <div className={`font-semibold ${textPrimary} mb-1`}>{day.date}</div>
      <div className={textMuted}>Spend: {money(day.spend, currency)}</div>
    </div>
  );
}

export default function GoogleAdsCampaignChart({
  spendDays,
  startDate,
  endDate,
  currency,
  loading,
  error,
}: {
  spendDays?: GoogleAdsDailySpendResponse["days"];
  startDate?: string;
  endDate?: string;
  currency: string;
  loading: boolean;
  error: boolean;
}) {
  // Day buckets follow the resolved backend range; fall back to the last 30
  // days while the range is still loading.
  const fallbackEnd = new Date();
  fallbackEnd.setUTCHours(0, 0, 0, 0);
  const fallbackStart = new Date(fallbackEnd);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 29);
  const rangeStart = startDate ?? fallbackStart.toISOString().slice(0, 10);
  const rangeEnd = endDate ?? fallbackEnd.toISOString().slice(0, 10);
  const byDay = new Map<string, ChartDay>();
  for (
    let cursor = new Date(`${rangeStart}T00:00:00Z`);
    cursor <= new Date(`${rangeEnd}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = cursor.toISOString().slice(0, 10);
    byDay.set(key, { date: key, spend: 0 });
  }
  for (const day of spendDays ?? []) {
    const point = byDay.get(day.date);
    if (point) point.spend += day.spend;
  }
  const days = [...byDay.values()];
  const tooltip = <DailyTooltip currency={currency} />;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className={`text-[16px] font-semibold ${textPrimary}`}>Campaign performance</div>
      <div className={`text-[12px] ${textMuted} mt-0.5 mb-5`}>
        Daily spend · {chartDate(rangeStart)} – {chartDate(rangeEnd)} · UTC
      </div>
      {loading ? (
        <div className={`h-72 flex items-center justify-center text-[13px] ${textMuted}`}>Loading chart…</div>
      ) : error ? (
        <div className={`h-72 flex items-center justify-center text-[13px] ${textMuted}`}>
          Failed to load daily spend
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
            <span className={`inline-flex items-center gap-2 text-[12px] font-medium ${textPrimary}`}>
              <span className="h-0.5 w-4 bg-[#6366f1]" />
              Spend ({currency})
            </span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={days} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={1}>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={chartDate}
                minTickGap={28}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="money"
                axisLine={false}
                tickLine={false}
                width={48}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={axisMoney}
              />
              <Tooltip content={tooltip} />
              <Line
                yAxisId="money"
                type="monotone"
                dataKey="spend"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className={`flex justify-between text-[11px] ${textMuted} mt-1`}>
            <span>Spend ({currency})</span>
          </div>
        </div>
      )}
    </div>
  );
}
