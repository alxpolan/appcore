import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { borderDefault, textMuted, textPrimary } from "../../styles";
import { fmtShortDate, fmtLargeNum } from "../../utils/formatters";
import type { RatingsData } from "../../types";

interface Props {
  data: RatingsData;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-4 py-3`}
      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.08)", minWidth: 150 }}
    >
      <div className={`text-[11px] ${textMuted} mb-2 font-medium`}>{fmtShortDate(String(label))}</div>
      <div className="flex items-center justify-between gap-3 text-[12px] mb-1">
        <span className={textMuted}>Rating</span>
        <span className={`font-semibold ${textPrimary} tabular-nums`}>{point?.rating?.toFixed(2)}</span>
      </div>
      {point?.ratingsCount != null && (
        <div className="flex items-center justify-between gap-3 text-[12px]">
          <span className={textMuted}>Total ratings</span>
          <span className={`font-semibold ${textPrimary} tabular-nums`}>{fmtLargeNum(point.ratingsCount)}</span>
        </div>
      )}
    </div>
  );
};

export default function RatingTrendChart({ data }: Props) {
  const byDay = data.byDay ?? [];

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={`text-[16px] font-semibold ${textPrimary}`}>Rating over time</div>
        {data.current.rating != null && (
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[16px] font-semibold ${textPrimary}`}>{data.current.rating.toFixed(1)}</span>
            {data.current.ratingsCount != null && (
              <span className={`text-[12px] ${textMuted}`}>({fmtLargeNum(data.current.ratingsCount)} ratings)</span>
            )}
          </div>
        )}
      </div>

      {byDay.length < 2 ? (
        <div className={`flex items-center justify-center h-48 text-[13px] ${textMuted}`}>
          Not enough history yet — the App Store rating is scraped every 12h.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="0" stroke="#f0f1f3" vertical={false} strokeWidth={1} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickFormatter={(v: string) => fmtShortDate(v)}
              interval="preserveStartEnd"
              minTickGap={32}
            />
            <YAxis
              domain={[1, 5]}
              ticks={[1, 2, 3, 4, 5]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              width={24}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#c3c9d4", strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="rating"
              name="Rating"
              stroke="#eda100"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: "#eda100" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
