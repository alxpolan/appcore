import { textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";
import type { AppleAdsCampaignVariantBreakdown, PostHogMilestoneCompletion } from "../../types";

const VARIANT_BAR_COLORS = ["#16a34a", "#d97706", "#0284c7", "#7c3aed"];

interface Props {
  milestones: PostHogMilestoneCompletion[];
  variants?: AppleAdsCampaignVariantBreakdown[];
  basisInstalls: number | undefined;
  fallbackTotal: number;
}

export default function AppleAdsMilestoneRows({ milestones, variants, basisInstalls, fallbackTotal }: Props) {
  return (
    <div className="px-5 py-4 flex flex-col gap-5">
      {milestones.map((m, mi) => {
        const basis = basisInstalls ?? fallbackTotal;
        const pct = basis > 0 ? Math.min(100, (m.completed / basis) * 100) : 0;
        return (
          <div key={m.label}>
            <div className="flex items-center gap-4">
              <div className="w-44 shrink-0">
                <div className={`text-[12px] ${textMuted} truncate`} title={m.label}>
                  {m.label}
                </div>
                <div className={`text-[20px] font-semibold ${textPrimary} tabular-nums`}>
                  {fmtNumber(m.completed)} / {fmtNumber(basis)}
                </div>
                <div className={`text-[12px] ${textMuted} tabular-nums`}>{fmtPct(pct)} reached</div>
              </div>
              <div className="flex-1">
                <div className="h-10 rounded-lg bg-[#595DD2] transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {(variants ?? []).map((v, vi) => {
              if (v.totalInstalls === 0) return null;

              const completed = v.completed[mi] ?? 0;
              const vpct = v.totalInstalls > 0 ? Math.min(100, (completed / v.totalInstalls) * 100) : 0;
              const funnel = v.funnel[mi];
              const barColor = VARIANT_BAR_COLORS[vi % VARIANT_BAR_COLORS.length];
              return (
                <div key={`${v.key}:${m.label}`} className="flex items-center gap-4 mt-2.5">
                  <div className="w-44 shrink-0 pl-4">
                    <div className={`text-[12px] font-medium truncate ${textPrimary}`} title={v.label}>
                      {v.label}
                    </div>
                    <div className={`text-[15px] font-semibold tabular-nums ${textPrimary}`}>
                      {fmtNumber(completed)} / {fmtNumber(v.totalInstalls)}
                    </div>
                    <div className={`text-[11px] tabular-nums ${textMuted}`}>
                      {fmtPct(vpct)} reached
                      {mi > 0 && funnel != null && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {" "}
                          → {fmtPct(funnel * 100)} vom vorherigen Schritt
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div
                      className="h-7 rounded-lg transition-all"
                      style={{ width: `${vpct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
