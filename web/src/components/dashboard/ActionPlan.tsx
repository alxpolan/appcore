import { Link } from "react-router-dom";
import {
  Search,
  Type,
  Tag,
  Image as ImageIcon,
  Users,
  AlignLeft,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  Globe,
  Sparkles,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { borderDefault, cardCls, textMuted, textPrimary, textSecondary } from "../../styles";
import AscConnectCard from "../AscConnectCard";

type Impact = "high" | "med" | "low";

interface ScanFinding {
  key: string;
  title: string;
  desc: string;
  impact: Impact;
  metric?: [string, string];
  suggestion?: string;
}

interface ScanResult {
  ready: boolean;
  score?: number;
  target?: number;
  findings?: ScanFinding[];
  aiSummary?: string | null;
}

const IMPACT_STYLE: Record<Impact, { cls: string; label: string }> = {
  high: { cls: "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400", label: "High impact" },
  med: { cls: "text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400", label: "Medium" },
  low: { cls: "text-slate-600 bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400", label: "Minor" },
};

interface CtaMeta {
  to: string;
  label: string;
  icon: LucideIcon;
}

const CTA_BY_KEY: Record<string, CtaMeta> = {
  title: { to: "/versions", label: "Edit metadata", icon: Type },
  subtitle: { to: "/versions", label: "Edit metadata", icon: Tag },
  description: { to: "/versions", label: "Edit description", icon: AlignLeft },
  screenshots: { to: "/versions", label: "Manage screenshots", icon: ImageIcon },
  keyword: { to: "/keywords", label: "Open Keywords", icon: Search },
  competitor: { to: "/competitors", label: "Find competitors", icon: Users },
  localization: { to: "/versions", label: "Add languages", icon: Globe },
  minOsVersion: { to: "/analytics", label: "View breakdown", icon: Smartphone },
};

const FALLBACK_CTA: CtaMeta = { to: "/keywords", label: "Open Keywords", icon: Search };

export default function ActionPlan({
  hasASC,
  addToast,
}: {
  hasASC: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data: scan } = useApi<ScanResult>("/asc/scan");
  const findings = scan?.ready ? (scan.findings ?? []) : [];

  return (
    <>
      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Add your App Store Connect API key to push metadata, sync versions, and apply AI suggestions straight to your listing. Without it, Marteso can only read your public data."
          addToast={addToast}
        />
      )}

      {scan?.ready && (
        <div className={`${cardCls} mb-5`}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className={`text-[15px] font-bold ${textPrimary}`}>Your ASO action plan</div>
              <p className={`text-[13px] ${textMuted} mt-0.5`}>
                {findings.length === 0
                  ? "No open gaps right now — your listing is in good shape."
                  : `${findings.length} quick win${findings.length === 1 ? "" : "s"} to climb the rankings.`}
              </p>
            </div>
            {scan.score != null && (
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <div className={`text-2xl font-bold leading-none ${textPrimary}`}>{scan.score}</div>
                  <div className={`text-[10px] uppercase tracking-wide ${textMuted} mt-0.5`}>ASO score</div>
                </div>
                {scan.target != null && scan.target > scan.score && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-full px-2 py-1 self-center">
                    <TrendingUp className="w-3 h-3" />~{scan.target}
                  </span>
                )}
              </div>
            )}
          </div>

          {scan.aiSummary && (
            <div className="flex items-start gap-2.5 mb-3 px-3.5 py-2.5 rounded-xl bg-gradient-to-br from-[#D94412]/[0.06] to-[#C4001E]/[0.06] border border-[#D94412]/15">
              <Sparkles className="w-3.5 h-3.5 text-[#C4001E] shrink-0 mt-0.5" />
              <p className={`text-[12.5px] ${textSecondary} leading-snug`}>{scan.aiSummary}</p>
            </div>
          )}

          {findings.length === 0 ? (
            <div className="flex items-center gap-2.5 py-2 text-[13px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              All caught up. Keep tracking keywords and competitors to stay ahead.
            </div>
          ) : (
            <div className="flex flex-col">
              {findings.map((f, i) => {
                const cta = CTA_BY_KEY[f.key] ?? FALLBACK_CTA;
                const Icon = cta.icon;
                const style = IMPACT_STYLE[f.impact] ?? IMPACT_STYLE.med;
                return (
                  <div
                    key={f.key}
                    className={`flex flex-col sm:flex-row items-start gap-3.5 py-3 ${
                      i > 0 ? `border-t ${borderDefault}` : ""
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px] text-[#C4001E] shrink-0 mt-0.5" />
                    <div className="min-w-0 w-full flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13.5px] font-semibold ${textPrimary}`}>{f.title}</span>
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${style.cls}`}
                        >
                          {style.label}
                        </span>
                      </div>
                      <div className={`text-[12.5px] ${textSecondary} leading-snug mt-0.5`}>{f.desc}</div>
                      {f.suggestion && (
                        <div className="mt-2 flex items-start gap-1.5 text-[12px] bg-[#C4001E]/[0.05] rounded-lg px-2.5 py-1.5">
                          <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-[#C4001E]" />
                          <span className={textSecondary}>
                            <span className="font-semibold text-[#C4001E] dark:text-orange-300">Try:</span>{" "}
                            {f.suggestion}
                          </span>
                        </div>
                      )}
                    </div>
                    <Link
                      to={cta.to}
                      className={`w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold border ${borderDefault} bg-white dark:bg-[#1c2028] ${textPrimary} hover:border-[#D94412] hover:text-[#D94412] transition-all`}
                    >
                      {cta.label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
