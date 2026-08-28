import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber, fmtShortDate, fmtLargeNum } from "../../utils/formatters";
import type { DownloadsData } from "../../types";

interface Props {
  data: DownloadsData;
}

const INSTALLS_COLOR = "#D94412";
const DELETIONS_COLOR = { light: "#2a78d6", dark: "#3987e5" };

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

function DeletionsTooltip({ active, payload, label, dark }: any) {
  if (!active || !payload?.length) return null;
  const installs = payload.find((p: any) => p.dataKey === "installs")?.value ?? 0;
  const deletions = payload.find((p: any) => p.dataKey === "deletions")?.value ?? 0;

  return (
    <div
      style={{
        background: dark ? "#252b38" : "#fff",
        border: `1px solid ${dark ? "#2a2f3d" : "#eef0f3"}`,
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        fontSize: 12,
        minWidth: 170,
      }}
    >
      <div style={{ color: dark ? "#5c6478" : "#9ca3af", marginBottom: 6, fontSize: 11 }}>
        {fmtShortDate(String(label))}
      </div>
      {payload.map((p: any) => (
        <div
          key={p.dataKey}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "2px 0" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: dark ? "#8b93a5" : "#6b7280" }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: p.color }} />
            {p.name}
          </span>
          <span style={{ fontWeight: 600, color: dark ? "#e8eaf0" : "#111827" }}>{fmtNumber(p.value)}</span>
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
        <span>Net</span>
        <span>{installs - deletions >= 0 ? "+" : ""}{fmtNumber(installs - deletions)}</span>
      </div>
    </div>
  );
}

export default function DeletionsChart({ data }: Props) {
  const dark = useDarkMode();
  const surface = dark ? "#1c2028" : "#ffffff";
  const byDay = data.byDay ?? [];
  const hasData = byDay.some((d) => (d.installs ?? 0) > 0 || (d.deletions ?? 0) > 0);

  const totalInstalls = byDay.reduce((sum, d) => sum + (d.installs ?? 0), 0);
  const totalDeletions = byDay.reduce((sum, d) => sum + (d.deletions ?? 0), 0);
  const deletionRate = totalInstalls > 0 ? (totalDeletions / totalInstalls) * 100 : null;
  const deletionsColor = DELETIONS_COLOR[dark ? "dark" : "light"];

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className={`text-[15px] font-semibold ${textPrimary} mb-4`}>Installs & deletions</div>
      {!hasData ? (
        <div className={`flex items-center justify-center h-48 text-[13px] ${textMuted}`}>
          No deletion data yet — sync to fetch it from Apple.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                content={<DeletionsTooltip dark={dark} />}
                cursor={{ stroke: dark ? "#5c6478" : "#c3c9d4", strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="installs"
                name="Installs"
                stroke={INSTALLS_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: surface, fill: INSTALLS_COLOR }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="deletions"
                name="Deletions"
                stroke={deletionsColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: surface, fill: deletionsColor }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>

          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 pt-4 border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="inline-block w-2 h-2 rounded-[2px]" style={{ backgroundColor: INSTALLS_COLOR }} />
              <span className={textSecondary}>Installs</span>
              <span className={`font-medium tabular-nums ${textPrimary}`}>{fmtNumber(totalInstalls)}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="inline-block w-2 h-2 rounded-[2px]" style={{ backgroundColor: deletionsColor }} />
              <span className={textSecondary}>Deletions</span>
              <span className={`font-medium tabular-nums ${textPrimary}`}>{fmtNumber(totalDeletions)}</span>
            </div>
            {deletionRate != null && (
              <div className="flex items-center gap-2 text-[12px]">
                <span className={textSecondary}>Deletion rate</span>
                <span className={`font-medium tabular-nums ${textPrimary}`}>{deletionRate.toFixed(0)}%</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
