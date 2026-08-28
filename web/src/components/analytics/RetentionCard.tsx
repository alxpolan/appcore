import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useApi } from "../../hooks/useApi";
import { borderDefault, textMuted, textPrimary } from "../../styles";
import { fmtNumber } from "../../utils/formatters";
import type { RetentionData } from "../../types";

interface Props {
  bundleId: string;
}

const ACCENT = "#D94412";

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[12px] ${textMuted}`}>{label}</span>
      <span className={`text-[14px] font-semibold tabular-nums ${textPrimary}`}>{value}</span>
    </div>
  );
}

export default function RetentionCard({ bundleId }: Props) {
  const dark = useDarkMode();
  const { data } = useApi<RetentionData>(`/analytics/retention?bundleId=${bundleId}`);
  const curve = data?.curve ?? [];
  const hasData = curve.length > 0;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <div className={`text-[15px] font-semibold ${textPrimary}`}>Retention</div>
        {hasData && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {data?.d1 != null && <Stat label="D1" value={`${data.d1.toFixed(0)}%`} />}
            {data?.d7 != null && <Stat label="D7" value={`${data.d7.toFixed(0)}%`} />}
            {data?.d30 != null && <Stat label="D30" value={`${data.d30.toFixed(0)}%`} />}
            {data?.avgSessionSeconds != null && data.avgSessionSeconds > 0 && (
              <Stat label="Avg session" value={fmtDuration(data.avgSessionSeconds)} />
            )}
          </div>
        )}
      </div>
      {!hasData ? (
        <div className={`flex items-center justify-center h-40 text-[13px] ${textMuted}`}>
          No retention data yet — sync to fetch session cohorts from Apple.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="retentionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.15} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="0"
              stroke={dark ? "#2a2f3d" : "#f0f1f3"}
              vertical={false}
              strokeWidth={1}
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
              tickFormatter={(v: number) => `D${v}`}
              ticks={[0, 1, 7, 14, 21, 30]}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
              tickFormatter={(v: number) => `${v}%`}
              width={40}
              domain={[0, 100]}
            />
            <Tooltip
              cursor={{ stroke: dark ? "#5c6478" : "#c3c9d4", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as RetentionData["curve"][number];
                return (
                  <div
                    className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-3.5 py-2.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.1)]`}
                  >
                    <div className={`${textMuted} mb-1 text-[11px]`}>
                      {d.day === 0 ? "Install day" : `Day ${d.day} after install`}
                    </div>
                    <div className={`font-semibold ${textPrimary} tabular-nums`}>{d.retention.toFixed(1)}% active</div>
                    <div className={`${textMuted} tabular-nums`}>
                      {fmtNumber(d.activeDevices)} of {fmtNumber(d.cohortDevices)} devices
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="retention"
              stroke={ACCENT}
              strokeWidth={2}
              fill="url(#retentionGrad)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? "#1c2028" : "#fff", fill: ACCENT }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
