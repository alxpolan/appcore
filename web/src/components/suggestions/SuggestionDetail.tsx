import { ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { badgeOutline, borderDefault, btnPrimary, textMuted, textSecondary, textPrimary } from "../../styles";
import { usePermissions } from "../../hooks/usePermissions";
import type { Suggestion } from "../../types";

interface Props {
  suggestion: Suggestion;
  index: number;
  total: number;
  acting: string | null;
  onAction: (id: string, action: "approve" | "reject" | "apply") => void;
  onNavigate: (dir: -1 | 1) => void;
}

export default function SuggestionDetail({ suggestion: s, index, total, acting, onAction, onNavigate }: Props) {
  const { canWrite } = usePermissions();
  const tip = !canWrite ? "Viewer role cannot perform this action" : undefined;
  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center justify-between gap-4 px-6 py-4 border-b ${borderDefault} shrink-0`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={badgeOutline(s.type.toLowerCase())}>{s.type.charAt(0) + s.type.slice(1).toLowerCase()}</span>
          <span className={badgeOutline(s.status.toLowerCase())}>
            {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
          </span>
          {s.confidenceScore != null && (
            <span className={`flex items-center gap-1.5 text-[12px] ${textMuted}`}>
              <span className="w-14 h-1.5 rounded-full bg-[#f3f4f6] dark:bg-[#2a2f3d] overflow-hidden inline-block align-middle">
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{ width: `${s.confidenceScore * 100}%` }}
                />
              </span>
              {Math.round(s.confidenceScore * 100)}%
            </span>
          )}
          <span className={`text-[12px] ${textMuted} font-mono`}>{s.aiModel}</span>
        </div>
        {total > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[12px] ${textMuted} mr-1`}>
              {index + 1} / {total}
            </span>
            <button
              onClick={() => onNavigate(-1)}
              disabled={index === 0}
              className={`p-1.5 rounded-lg border ${borderDefault} bg-white dark:bg-[#1c2028] ${textSecondary} hover:border-[#d1d5db] dark:hover:border-[#3a4050] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onNavigate(1)}
              disabled={index === total - 1}
              className={`p-1.5 rounded-lg border ${borderDefault} bg-white dark:bg-[#1c2028] ${textSecondary} hover:border-[#d1d5db] dark:hover:border-[#3a4050] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
        <div>
          <p className={`text-[13px] font-semibold ${textSecondary} mb-3`}>Change preview</p>

          {s.currentValue ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={`text-[11px] font-medium ${textMuted} mb-1.5`}>Current</p>
                {s.type === "KEYWORDS" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {s.currentValue.split(",").map((kw, i) => (
                      <span
                        key={i}
                        className={`inline-flex px-2.5 py-1 text-[12px] rounded-lg bg-[#f3f4f6] dark:bg-[#252b38] ${textSecondary} font-medium`}
                      >
                        {kw.trim()}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div
                    className={`text-[13px] ${textPrimary} whitespace-pre-wrap break-words rounded-xl px-3.5 py-3 border ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38] min-h-[60px]`}
                  >
                    {s.currentValue}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">New</p>
                {s.type === "KEYWORDS" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {s.suggestedValue.split(",").map((kw, i) => (
                      <span
                        key={i}
                        className="inline-flex px-2.5 py-1 text-[12px] rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-medium"
                      >
                        {kw.trim()}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap break-words rounded-xl px-3.5 py-3 border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/[0.08] min-h-[60px]">
                    {s.suggestedValue}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">Suggested</p>
              {s.type === "KEYWORDS" ? (
                <div className="flex flex-wrap gap-1.5">
                  {s.suggestedValue.split(",").map((kw, i) => (
                    <span
                      key={i}
                      className="inline-flex px-2.5 py-1 text-[12px] rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 font-medium"
                    >
                      {kw.trim()}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-emerald-800 dark:text-emerald-300 whitespace-pre-wrap break-words rounded-xl px-3.5 py-3 border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/[0.08]">
                  {s.suggestedValue}
                </div>
              )}
            </div>
          )}
        </div>

        {s.reasoning && (
          <div>
            <p className={`text-[13px] font-semibold ${textSecondary} mb-3`}>AI reasoning</p>
            <div
              className={`text-[13px] ${textSecondary} leading-relaxed rounded-xl px-3.5 py-3 border ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
            >
              {s.reasoning}
            </div>
          </div>
        )}
      </div>

      {(s.status === "PENDING" || s.status === "APPROVED") && (
        <div className={`px-6 py-4 border-t ${borderDefault} flex items-center gap-2 shrink-0`}>
          {s.status === "PENDING" && (
            <>
              <button
                className={btnPrimary}
                disabled={acting === s.id || !canWrite}
                title={tip}
                onClick={() => onAction(s.id, "approve")}
              >
                Approve
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-4 py-[8px] rounded-xl text-[13px] font-medium border border-[#fecaca] dark:border-red-900/40 bg-white dark:bg-[#1c2028] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                disabled={acting === s.id || !canWrite}
                title={tip}
                onClick={() => onAction(s.id, "reject")}
              >
                Reject
              </button>
            </>
          )}
          <button
            className={`inline-flex items-center gap-2 pl-3.5 pr-3 py-[8px] rounded-xl text-[13px] font-medium border ${borderDefault} bg-white dark:bg-[#1c2028] ${textPrimary} hover:border-[#595DD2] hover:text-[#595DD2] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
            disabled={acting === s.id || !canWrite}
            title={tip}
            onClick={() => onAction(s.id, "apply")}
          >
            <Upload className="w-4 h-4" />
            Push to ASC
          </button>
        </div>
      )}
    </div>
  );
}
