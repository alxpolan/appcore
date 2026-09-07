import { useState } from "react";
import { textMuted, textPrimary, borderDefault, btnPrimary } from "../../styles";
import { ClipboardList, ChevronDown } from "lucide-react";
import { getLocaleFlag, getLocaleName } from "../../utils/localeUtils";

function LocaleFlag({ locale }: { locale: string }) {
  return (
    <img
      src={`/country-flags/${getLocaleFlag(locale)}.svg`}
      alt=""
      className="w-4 h-3 rounded-xs object-cover shrink-0"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
import { useApi, apiPost, getActiveBundleId } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import SuggestionCard from "./SuggestionCard";
import SuggestionDetail from "./SuggestionDetail";
import type { Suggestion } from "../../types";
import { usePostHog } from "@posthog/react";

interface SuggestionsData {
  suggestions: Record<string, Suggestion[]>;
  total: number;
}
interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Suggestions({ addToast }: Props) {
  const posthog = usePostHog();
  const { canWrite } = usePermissions();
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const filterQ = [statusFilter && `status=${statusFilter}`, typeFilter && `type=${typeFilter}`]
    .filter(Boolean)
    .join("&");
  const { data, loading, refetch } = useApi<SuggestionsData>(`/suggestions${filterQ ? `?${filterQ}` : ""}`, [
    statusFilter,
    typeFilter,
  ]);
  const [activeLocale, setActiveLocale] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const runAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await apiPost("/actions/analyze", { bundleId: getActiveBundleId() });
      posthog?.capture("ai_analysis_started", { bundle_id: getActiveBundleId() });
      addToast(res.message || "AI analysis started", "success");
      setTimeout(refetch, 5000);
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const groups = data?.suggestions || {};
  const locales = Object.keys(groups);
  const currentLocale = activeLocale || locales[0] || "en-US";
  const items = (groups[currentLocale] || []).filter((s) => s.status !== "APPLIED");

  const selectedItem =
    items.length > 0 ? (selectedId ? (items.find((i) => i.id === selectedId) ?? items[0]) : items[0]) : null;
  const selectedIndex = selectedItem ? items.findIndex((i) => i.id === selectedItem.id) : -1;

  const handleAction = async (id: string, action: "approve" | "reject" | "apply") => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return;
    }
    setActing(id);
    try {
      const item = items.find((s) => s.id === id);
      await apiPost(`/suggestions/${id}/${action}`);
      const eventMap = { approve: "suggestion_approved", reject: "suggestion_rejected", apply: "suggestion_applied" } as const;
      posthog?.capture(eventMap[action], { suggestion_id: id, type: item?.type, locale: item?.locale });
      addToast(
        `Suggestion ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "applied"}`,
        "success",
      );
      refetch();
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setActing(null);
    }
  };

  const navigateItem = (dir: -1 | 1) => {
    const next = items[selectedIndex + dir];
    if (next) setSelectedId(next.id);
  };

  return (
    <div className="-mx-7 -my-6 flex overflow-hidden" style={{ height: "calc(100vh - 52px)" }}>
      <div className={`w-[300px] shrink-0 flex flex-col border-r ${borderDefault} overflow-hidden`}>
        <div className={`flex items-center justify-between px-4 py-4 border-b ${borderDefault} shrink-0`}>
          <h1 className={`text-[17px] font-semibold ${textPrimary}`}>Suggestions</h1>
          <button
            onClick={runAnalyze}
            disabled={analyzing || !canWrite}
            title={!canWrite ? "Viewer role cannot run actions" : undefined}
            className={btnPrimary}
          >
            {analyzing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Analyzing…
              </>
            ) : (
              "Run AI"
            )}
          </button>
        </div>

        {locales.length > 0 && (
          <div className={`flex items-center gap-1.5 px-3 py-2.5 border-b ${borderDefault} shrink-0 flex-wrap`}>
            {locales.map((loc) => (
              <button
                key={loc}
                onClick={() => {
                  setActiveLocale(loc);
                  setSelectedId(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-[6px] rounded-xl text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  currentLocale === loc
                    ? "bg-[#111827] dark:bg-[#e8eaf0] text-white dark:text-[#111827] shadow-sm"
                    : `bg-[#fafbfc] dark:bg-[#252b38] border ${borderDefault} ${textPrimary} hover:border-[#d1d5db] dark:hover:border-[#3a4050]`
                }`}
              >
                <LocaleFlag locale={loc} />
                {getLocaleName(loc)}
              </button>
            ))}
          </div>
        )}

        <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${borderDefault} shrink-0`}>
          <div className="relative flex-1">
            <select
              className={`w-full appearance-none pl-2.5 pr-7 py-1.5 text-[12px] border ${borderDefault} rounded-lg bg-white dark:bg-[#1c2028] ${textPrimary} outline-none cursor-pointer focus:border-[#595DD2] transition-colors`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <ChevronDown
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 ${textMuted} pointer-events-none`}
            />
          </div>
          <div className="relative flex-1">
            <select
              className={`w-full appearance-none pl-2.5 pr-7 py-1.5 text-[12px] border ${borderDefault} rounded-lg bg-white dark:bg-[#1c2028] ${textPrimary} outline-none cursor-pointer focus:border-[#595DD2] transition-colors`}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              <option value="TITLE">Title</option>
              <option value="SUBTITLE">Subtitle</option>
              <option value="KEYWORDS">Keywords</option>
              <option value="DESCRIPTION">Description</option>
            </select>
            <ChevronDown
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 ${textMuted} pointer-events-none`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2">
              <div className="spinner" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ClipboardList className={`w-8 h-8 ${textMuted} opacity-30`} />
              <div className={`text-sm ${textMuted}`}>No suggestions</div>
            </div>
          ) : (
            items.map((s, i) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                selected={s.id === selectedItem?.id}
                onClick={() => setSelectedId(s.id)}
                isLast={i === items.length - 1}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {selectedItem ? (
          <SuggestionDetail
            suggestion={selectedItem}
            index={selectedIndex}
            total={items.length}
            acting={acting}
            onAction={handleAction}
            onNavigate={navigateItem}
          />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <ClipboardList className={`w-10 h-10 ${textMuted} opacity-20`} />
            <div className={`text-sm ${textMuted}`}>Select a suggestion to view details</div>
          </div>
        )}
      </div>
    </div>
  );
}
