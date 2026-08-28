import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, usePlotArea } from "recharts";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber, fmtShortDate, fmtLargeNum } from "../../utils/formatters";
import type { DownloadsData } from "../../types";

interface Props {
  data: DownloadsData;
}

const SOURCE_ORDER = [
  "App Store search",
  "App Store browse",
  "App referrer",
  "Web referrer",
  "Unavailable",
  "Institutional purchase",
  "Other",
];

const SOURCE_COLORS: Record<string, { light: string; dark: string }> = {
  "App Store search": { light: "#2a78d6", dark: "#3987e5" },
  "App Store browse": { light: "#eb6834", dark: "#d95926" },
  "App referrer": { light: "#1baf7a", dark: "#199e70" },
  "Web referrer": { light: "#eda100", dark: "#c98500" },
  Unavailable: { light: "#e87ba4", dark: "#d55181" },
  "Institutional purchase": { light: "#008300", dark: "#008300" },
  Other: { light: "#9ca3af", dark: "#5c6478" },
};

// Index ranges where a series has data, extended by one day on each side so
// the clip region covers the area's taper down to zero.
function dataRuns(byDay: DownloadsData["bySourceDay"], key: string): [number, number][] {
  const runs: [number, number][] = [];
  let start: number | null = null;
  byDay.forEach((d, i) => {
    const v = typeof d[key] === "number" ? (d[key] as number) : 0;
    if (v > 0 && start === null) start = Math.max(0, i - 1);
    if (v <= 0 && start !== null) {
      runs.push([start, i]);
      start = null;
    }
  });
  if (start !== null) runs.push([start, byDay.length - 1]);
  return runs;
}

// Per-series clipPaths so each Area (fill + its edge stroke) only renders
// where the series has data — a stacked Area's stroke would otherwise trace
// the stack top across the whole chart even at zero height. Must be rendered
// as a chart child because usePlotArea needs the chart context.
function SourceClipDefs({ byDay, orderedTypes }: { byDay: DownloadsData["bySourceDay"]; orderedTypes: string[] }) {
  const plot = usePlotArea();
  if (!plot || byDay.length < 2) return null;
  const step = plot.width / (byDay.length - 1);
  return (
    <defs>
      {orderedTypes.map((key, idx) => (
        <clipPath id={`src-run-clip-${idx}`} key={key}>
          {dataRuns(byDay, key).map(([a, b]) => (
            <rect
              key={a}
              x={plot.x + a * step}
              y={-10000}
              width={Math.max((b - a) * step, 0)}
              height={20000}
            />
          ))}
        </clipPath>
      ))}
    </defs>
  );
}

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

function SourceTooltip({ active, payload, label, dark }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p: any) => typeof p.value === "number" && p.value > 0 && !String(p.dataKey).startsWith("__"))
    .sort((a: any, b: any) => b.value - a.value);
  if (!rows.length) return null;
  const total = rows.reduce((sum: number, r: any) => sum + r.value, 0);

  return (
    <div
      style={{
        background: dark ? "#252b38" : "#fff",
        border: `1px solid ${dark ? "#2a2f3d" : "#eef0f3"}`,
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        fontSize: 12,
        minWidth: 190,
      }}
    >
      <div style={{ color: dark ? "#5c6478" : "#9ca3af", marginBottom: 6, fontSize: 11 }}>
        {fmtShortDate(String(label))}
      </div>
      {rows.map((r: any) => (
        <div
          key={r.dataKey}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "2px 0" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: dark ? "#8b93a5" : "#6b7280" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: r.color }} />
            {r.name}
          </span>
          <span style={{ fontWeight: 600, color: dark ? "#e8eaf0" : "#111827" }}>{fmtNumber(r.value)}</span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${dark ? "#2a2f3d" : "#eef0f3"}`,
          fontWeight: 600,
          color: dark ? "#e8eaf0" : "#111827",
        }}
      >
        <span>Total</span>
        <span>{fmtNumber(total)}</span>
      </div>
    </div>
  );
}

export default function DownloadSourcesChart({ data }: Props) {
  const dark = useDarkMode();
  const surface = dark ? "#1c2028" : "#ffffff";
  const sourceTypes = data.sourceTypes ?? [];
  const byDay = data.bySourceDay ?? [];

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const day of byDay) {
      for (const key of sourceTypes) {
        const v = day[key];
        if (typeof v === "number") t[key] = (t[key] ?? 0) + v;
      }
    }
    return t;
  }, [byDay, sourceTypes]);

  const orderedTypes = SOURCE_ORDER.filter((t) => sourceTypes.includes(t));
  const grandTotal = orderedTypes.reduce((sum, k) => sum + (totals[k] ?? 0), 0);

  if (orderedTypes.length === 0) return null;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className={`text-[15px] font-semibold ${textPrimary} mb-4`}>Downloads by source</div>
      {byDay.length === 0 ? (
        <div className={`flex items-center justify-center h-48 text-[13px] ${textMuted}`}>
          No source data yet — sync to fetch the breakdown.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="0"
                stroke={dark ? "#2a2f3d" : "#f0f1f3"}
                vertical={false}
                strokeWidth={1}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
                tickFormatter={(v: string) => fmtShortDate(v)}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
                tickFormatter={(v: number) => fmtLargeNum(v)}
                width={36}
              />
              <Tooltip
                content={<SourceTooltip dark={dark} />}
                cursor={{ stroke: dark ? "#5c6478" : "#c3c9d4", strokeWidth: 1 }}
              />
              <SourceClipDefs byDay={byDay} orderedTypes={orderedTypes} />
              {orderedTypes.map((key, idx) => {
                const color = SOURCE_COLORS[key]?.[dark ? "dark" : "light"] ?? (dark ? "#5c6478" : "#9ca3af");
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="src"
                    stroke={color}
                    strokeWidth={1.5}
                    fill={color}
                    fillOpacity={0.12}
                    clipPath={`url(#src-run-clip-${idx})`}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: surface, fill: color }}
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>

          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 pt-4 border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
            {orderedTypes.map((key) => {
              const color = SOURCE_COLORS[key]?.[dark ? "dark" : "light"] ?? (dark ? "#5c6478" : "#9ca3af");
              const total = totals[key] ?? 0;
              const share = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-2 text-[12px]">
                  <span className="inline-block w-2 h-2 rounded-[2px]" style={{ backgroundColor: color }} />
                  <span className={textSecondary}>{key}</span>
                  <span className={`font-medium tabular-nums ${textPrimary}`}>{fmtNumber(total)}</span>
                  <span className={textMuted}>({share.toFixed(0)}%)</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
