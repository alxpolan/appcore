import { badgeOutline, borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import type { Suggestion } from "../../types";
export type { Suggestion };

interface Props {
  suggestion: Suggestion;
  selected: boolean;
  onClick: () => void;
  isLast: boolean;
}

export default function SuggestionCard({ suggestion: s, selected, onClick, isLast }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 transition-colors relative cursor-pointer ${
        selected ? "bg-[#f1f2fd] dark:bg-[#23253f]" : "hover:bg-[#fafbfc] dark:hover:bg-[#252b38]"
      } ${!isLast ? `border-b ${borderDefault}` : ""}`}
    >
      {selected && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#595DD2] rounded-r-sm" />}
      <p className={`text-[13px] ${textPrimary} line-clamp-2 leading-snug mb-2`}>{s.suggestedValue}</p>
      {s.confidenceScore != null && (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex-1 h-[6px] rounded-full bg-[#f3f4f6] dark:bg-[#2a2f3d] overflow-hidden">
            <div className="h-[6px] rounded-full bg-emerald-500" style={{ width: `${s.confidenceScore * 100}%` }} />
          </div>
          <span className={`text-[11px] tabular-nums ${textMuted}`}>{Math.round(s.confidenceScore * 100)}%</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className={badgeOutline(s.type.toLowerCase())}>{s.type.charAt(0) + s.type.slice(1).toLowerCase()}</span>
        <span className={badgeOutline(s.status.toLowerCase())}>
          {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
        </span>
      </div>
      <div className={`text-[11px] ${textSecondary}`}>
        {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {s.aiModel}
      </div>
    </button>
  );
}
