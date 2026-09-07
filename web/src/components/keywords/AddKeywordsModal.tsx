import { useEffect, useMemo, useRef, useState, useCallback, KeyboardEvent } from "react";
import { Plus, Search, Sparkles, X } from "lucide-react";
import { borderDefault, btnSecondary, textMuted, textPrimary, textSecondary } from "../../styles";
import { useClickOutside } from "../../hooks/useClickOutside";
import { apiGet, apiPost, getActiveBundleId } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { countryName } from "../../utils/formatters";
import { COUNTRIES, LANGUAGE_BY_COUNTRY } from "./storefronts";

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const langOf = (c: string) => {
  const lang = LANGUAGE_BY_COUNTRY[c] ?? "en";
  try {
    return languageNames.of(lang) ?? lang.toUpperCase();
  } catch {
    return lang.toUpperCase();
  }
};

interface AiSuggestion {
  id: string;
  term: string;
  popularity: number | null;
  difficulty: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaultCountry: string;
  onAdded: (added: { id: string; updatedAt: string }[]) => void;
  onSuggestionsChanged?: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  remaining: number | null;
  limit: number;
}

export default function AddKeywordsModal({
  open,
  onClose,
  defaultCountry,
  onAdded,
  onSuggestionsChanged,
  addToast,
  remaining,
  limit,
}: Props) {
  const { canWrite } = usePermissions();
  const [query, setQuery] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [country, setCountry] = useState(defaultCountry || "de");
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const marketRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(
    marketRef,
    useCallback(() => setMarketOpen(false), []),
  );

  useEffect(() => {
    if (open) {
      setCountry(defaultCountry || "de");
      setQuery("");
      setStaged([]);
      setTimeout(() => inputRef.current?.focus(), 50);
      apiGet<{ items: AiSuggestion[] }>("/keywords/suggestions")
        .then((res) => setSuggestions(res.items))
        .catch(() => setSuggestions([]));
    }
  }, [open, defaultCountry]);

  const dismissSuggestion = async (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    try {
      await apiPost(`/keywords/suggestions/${id}/dismiss`, { bundleId: getActiveBundleId() });
      onSuggestionsChanged?.();
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const normalize = (s: string) => s.trim().toLowerCase();
  const stageTerm = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const key = normalize(t);
    setStaged((prev) => {
      if (prev.some((x) => normalize(x) === key)) return prev;
      if (remaining !== null && prev.length >= remaining) {
        addToast(
          `Free plan is limited to ${limit} keywords per app. Upgrade to Pro to track more.`,
          "info",
        );
        return prev;
      }
      return [...prev, t];
    });
  };

  const handleSubmitQuery = () => {
    const parts = query
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    parts.forEach(stageTerm);
    setQuery("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmitQuery();
    } else if (e.key === ",") {
      e.preventDefault();
      handleSubmitQuery();
    } else if (e.key === "Backspace" && query === "" && staged.length > 0) {
      setStaged((prev) => prev.slice(0, -1));
    }
  };

  const submit = async () => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return;
    }
    if (staged.length === 0) return;
    if (remaining !== null && staged.length > remaining) {
      addToast(`Free plan is limited to ${limit} keywords per app. Upgrade to Pro to track more.`, "error");
      return;
    }
    setAdding(true);
    const c = COUNTRIES.find((x) => x.code === country) ?? COUNTRIES[0];
    try {
      const results = await Promise.all(
        staged.map((term) =>
          apiPost<{ keyword: { id: string; updatedAt: string } }>("/keywords", {
            term,
            country: c.code,
            language: c.lang,
            bundleId: getActiveBundleId(),
          }),
        ),
      );
      addToast(
        staged.length === 1
          ? `Keyword "${staged[0]}" (${c.code.toUpperCase()}) added`
          : `${staged.length} keywords (${c.code.toUpperCase()}) added`,
        "success",
      );
      onAdded(results.map((r) => r.keyword));
      onSuggestionsChanged?.();
      onClose();
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setAdding(false);
    }
  };

  const previewMatchesQuery = useMemo(() => {
    const q = normalize(query);
    if (!q) return null;
    if (staged.some((x) => normalize(x) === q)) return null;
    return query.trim();
  }, [query, staged]);

  const opp = (pop: number, diff: number) => Math.round((pop * (100 - diff)) / 100);
  const oppTagCls = (s: number) =>
    s > 50
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/50"
      : s > 25
        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/50"
        : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/25 dark:text-red-300 dark:ring-red-800/50";
  const visibleSuggestions = suggestions.filter((s) => !staged.some((x) => normalize(x) === normalize(s.term)));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]`}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className={`text-base font-semibold ${textPrimary}`}>Add keywords</h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>Type a phrase and press Enter to stage it for tracking.</p>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {remaining !== null && (
          <div
            className={`mx-5 mb-2 px-3 py-2 rounded-lg text-[12px] ${remaining - staged.length <= 0
              ? "bg-[#595DD2]/10 text-[#595DD2]"
              : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
          >
            Free plan: {Math.max(0, remaining - staged.length)} of {limit} keyword slots left for this app. Upgrade to
            Pro for unlimited tracking.
          </div>
        )}

        <div className="px-5 pb-3">
          <div
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${borderDefault} bg-gray-50/60 dark:bg-[#181c24] focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:focus-within:border-blue-400`}
          >
            <Search className={`w-4 h-4 ${textMuted} shrink-0`} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="e.g. workout timer"
              className={`flex-1 bg-transparent outline-none text-[13px] ${textPrimary} placeholder:text-[#9ca3af] dark:placeholder:text-[#5c6478]`}
            />
            {query.trim() && (
              <button
                onClick={handleSubmitQuery}
                title="Stage keyword"
                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[#595DD2] hover:bg-[#595DD2]/10 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2 min-h-[120px]">
          {previewMatchesQuery && (
            <button
              onClick={handleSubmitQuery}
              className={`w-full group flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left`}
            >
              <span className={`text-[13px] ${textPrimary} truncate`}>{previewMatchesQuery}</span>
              <span className={`flex items-center gap-3 shrink-0 text-[11px] ${textMuted}`}>
                <span className="tabular-nums">POP —</span>
                <span className="tabular-nums">DIFF —</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-gray-50 text-gray-500 ring-gray-200 dark:bg-[#252b38] dark:text-[#8b93a5] dark:ring-[#2a2f3d]`}
                >
                  —
                </span>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[#595DD2] group-hover:bg-[#595DD2]/10">
                  <Plus className="w-4 h-4" />
                </span>
              </span>
            </button>
          )}

          {visibleSuggestions.length > 0 && (
            <div className="mb-1">
              <div
                className={`flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}
              >
                <Sparkles className="w-3 h-3 text-[#595DD2]" />
                Suggested by AI
              </div>
              {visibleSuggestions.map((s) => {
                const hasScores = s.popularity != null && s.difficulty != null;
                const o = hasScores ? opp(s.popularity!, s.difficulty!) : null;
                return (
                  <div
                    key={s.id}
                    className="w-full group flex items-center justify-between gap-2 pl-3 pr-2 py-2 rounded-lg hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                  >
                    <button onClick={() => stageTerm(s.term)} className="flex-1 min-w-0 text-left">
                      <span className={`text-[13px] ${textPrimary} truncate`}>{s.term}</span>
                    </button>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className={`text-[11px] tabular-nums ${textMuted}`}>
                        POP {s.popularity != null ? Math.round(s.popularity) : "—"}
                      </span>
                      <span className={`text-[11px] tabular-nums ${textMuted}`}>
                        DIFF {s.difficulty != null ? Math.round(s.difficulty) : "—"}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset tabular-nums ${o != null
                          ? oppTagCls(o)
                          : "bg-gray-50 text-gray-500 ring-gray-200 dark:bg-[#252b38] dark:text-[#8b93a5] dark:ring-[#2a2f3d]"
                          }`}
                      >
                        {o != null ? o : "—"}
                      </span>
                      <button
                        onClick={() => stageTerm(s.term)}
                        title="Stage keyword"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[#595DD2] hover:bg-[#595DD2]/10"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => dismissSuggestion(s.id)}
                        title="Dismiss suggestion"
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${textMuted} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {staged.length === 0 && !previewMatchesQuery && visibleSuggestions.length === 0 && (
            <div className={`flex items-center justify-center py-10 text-xs ${textMuted}`}>
              Type a phrase above and press Enter to stage it
            </div>
          )}

          {staged.map((term) => (
            <div
              key={term}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors`}
            >
              <span className={`text-[13px] font-medium ${textPrimary} truncate`}>{term}</span>
              <span className="flex items-center gap-3 shrink-0">
                <span className={`text-[11px] tabular-nums ${textMuted}`}>POP —</span>
                <span className={`text-[11px] tabular-nums ${textMuted}`}>DIFF —</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-gray-50 text-gray-500 ring-gray-200 dark:bg-[#252b38] dark:text-[#8b93a5] dark:ring-[#2a2f3d]`}
                >
                  —
                </span>
                <button
                  onClick={() => setStaged((prev) => prev.filter((x) => x !== term))}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${textMuted} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20`}
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>

        <div className={`flex items-center justify-between gap-3 px-5 py-3 border-t ${borderDefault}`}>
          <div className="flex items-center gap-2 min-w-0">
            <div ref={marketRef} className="relative">
              <button
                onClick={() => setMarketOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full border ${borderDefault} bg-white dark:bg-[#1c2028] text-[12px] font-medium ${textPrimary} hover:border-gray-300 dark:hover:border-[#3a4050] transition-colors`}
              >
                <img
                  src={`/country-flags/${country.toLowerCase()}.svg`}
                  alt={country}
                  className="w-3.5 h-2.5 rounded-xs object-cover shrink-0"
                />
                <span>
                  {countryName(country)} <span className={textMuted}>·</span> {langOf(country)}
                </span>
              </button>
              {marketOpen && (
                <div
                  className={`absolute left-0 bottom-full mb-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[220px] max-h-[260px] overflow-auto`}
                >
                  {COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => {
                        setCountry(c.code);
                        setMarketOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left ${country === c.code ? "font-semibold" : ""
                        }`}
                    >
                      <img
                        src={`/country-flags/${c.code.toLowerCase()}.svg`}
                        alt={c.code}
                        className="w-4 h-3 rounded-xs object-cover shrink-0"
                      />
                      <span className="truncate">
                        {countryName(c.code)} <span className={textMuted}>·</span> {langOf(c.code)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className={`text-[12px] ${textSecondary} truncate`}>
              {staged.length === 0
                ? "No keywords selected"
                : `${staged.length} keyword${staged.length === 1 ? "" : "s"} selected`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={adding || staged.length === 0 || !canWrite}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium border-[#595DD2] bg-[#595DD2] text-white hover:border-[#484CBE] hover:bg-[#484CBE] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? (
                <>
                  <div className="spinner !w-3.5 !h-3.5" /> Adding…
                </>
              ) : (
                "Add keywords"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
