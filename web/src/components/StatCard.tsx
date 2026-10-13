import { useId, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { borderDefault, textMuted, textPrimary } from "../styles";

export function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  if (!data || data.length < 2) return null;
  const w = 200;
  const h = 60;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const allZero = max === 0;
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: allZero ? h - 2 : h - ((v - min) / range) * (h - 8) - 4,
  }));
  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = `M0,${h} ${pts.map((p) => `L${p.x},${p.y}`).join(" ")} L${w},${h} Z`;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={allZero ? 0 : 0.2} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  sub,
  dim,
  note,
  sparkline,
  icon,
  color = "#6366f1",
}: {
  label: string;
  value: string | number;
  sub?: string;
  dim?: boolean;
  note?: string;
  sparkline?: number[];
  icon?: ReactNode;
  color?: string;
}) {
  const hasSparkline = !dim && sparkline && sparkline.length >= 2;
  const gradId = `sg_${useId().replace(/\W/g, "")}`;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between mb-3">
          <span className={`text-[13px] font-semibold ${textPrimary}`}>{label}</span>
          {icon && <span className={`${textMuted}`}>{icon}</span>}
        </div>
        <div className={`text-[40px] font-bold leading-none mb-2 ${dim ? textMuted : textPrimary}`}>{value}</div>
        {sub && (
          <div className={`flex items-center gap-1.5 text-[13px] ${textMuted}`}>
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {sub}
          </div>
        )}
        {note && <div className="text-[11px] text-[#c4c9d4] dark:text-[#3a4050] mt-1 leading-tight">{note}</div>}
      </div>
      <div className="h-16">{hasSparkline && <Sparkline data={sparkline!} color={color} id={gradId} />}</div>
    </div>
  );
}
