import { useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import type { VisibilityData } from "../../types";
import { fmtShortDate } from "../../utils/formatters";

interface Props {
  data: VisibilityData;
}

const RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const ACCENT = "#8b5cf6";

export default function VisibilityChart({ data }: Props) {
  const [range, setRange] = useState(30);

  const filtered = data.series.slice(-range);
  const current = filtered.length ? filtered[filtered.length - 1].score : null;
  const first = filtered.length ? filtered[0].score : null;
  const delta = current != null && first != null ? Math.round((current - first) * 10) / 10 : null;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className={`text-[15px] font-semibold ${textPrimary}`}>Visibility over time</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Popularity-weighted ranking across {data.trackedKeywords} tracked keyword
            {data.trackedKeywords === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.days)}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
                range === r.days
                  ? "bg-[#595DD2] text-white"
                  : `bg-[#f3f4f6] dark:bg-[#252b38] ${textSecondary} hover:bg-[#e5e7eb] dark:hover:bg-[#2a2f3d]`
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={`flex flex-col items-center justify-center h-48 gap-2 text-[13px] ${textMuted}`}>
          No ranking history yet.
          <Link to="/keywords" className="text-[#595DD2] font-medium hover:underline">
            Add keywords to start tracking
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2.5 mb-3">
            <span className={`text-[26px] font-semibold tabular-nums leading-none ${textPrimary}`}>
              {current != null ? current.toFixed(1) : "—"}
            </span>
            {delta != null && delta !== 0 && (
              <span
                className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${
                  delta > 0 ? "text-emerald-500" : "text-rose-500"
                }`}
              >
                {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(delta).toFixed(1)}
              </span>
            )}
            <span className={`text-[12px] ${textMuted}`}>
              {data.top10} in top 10 · {data.top50} in top 50
            </span>
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={filtered} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="visibilityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtShortDate}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, "auto"]}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 12,
                  border: "1px solid #eef0f3",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                }}
                labelFormatter={(label) => fmtShortDate(String(label))}
                formatter={(value) => [typeof value === "number" ? value.toFixed(1) : "—", "Visibility"]}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke={ACCENT}
                strokeWidth={2}
                fill="url(#visibilityFill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: ACCENT }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
