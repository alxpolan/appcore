import { useEffect, useRef, useState } from "react";
import { Plus, Search, Sparkles, X } from "lucide-react";
import { borderDefault, btnPrimary, btnSecondary, textMuted, textPrimary, textSecondary } from "../../styles";
import { apiGet, apiPost } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import AppIcon from "./AppIcon";

interface Candidate {
  bundleId: string;
  name: string;
  iconUrl: string | null;
  rating: number | null;
  ratingsCount: number | null;
  developerName: string | null;
  relevance?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  ownAppId: string | null;
  onAdded: (count: number, competitorAppIds: string[]) => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AddCompetitorsModal({ open, onClose, ownAppId, onAdded, addToast }: Props) {
  const { canWrite } = usePermissions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [staged, setStaged] = useState<Candidate[]>([]);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setStaged([]);
    setTimeout(() => inputRef.current?.focus(), 50);
    if (!ownAppId) {
      setSuggestions([]);
      return;
    }
    setSuggestionsLoading(true);
    apiGet<Candidate[]>(`/apps/${ownAppId}/competitor-suggestions`)
      .then((data) => setSuggestions(data))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [open, ownAppId]);

  useEffect(() => {
    if (!open || !ownAppId) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      apiGet<Candidate[]>(`/apps/${ownAppId}/competitor-search`, { q })
        .then((data) => setResults(data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query, open, ownAppId]);

  const isStaged = (bundleId: string) => staged.some((s) => s.bundleId === bundleId);
  const stage = (c: Candidate) => setStaged((prev) => (isStaged(c.bundleId) ? prev : [...prev, c]));
  const unstage = (bundleId: string) => setStaged((prev) => prev.filter((s) => s.bundleId !== bundleId));

  const submit = async () => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return;
    }
    if (!ownAppId || staged.length === 0) return;
    setAdding(true);
    try {
      const outcomes = await Promise.allSettled(
        staged.map((c) => apiPost(`/apps/${ownAppId}/competitors`, { bundleId: c.bundleId })),
      );
      const added = outcomes.filter((o) => o.status === "fulfilled").length;
      const failed = outcomes.length - added;
      if (added > 0) {
        addToast(
          added === 1 ? `${staged.find((_, i) => outcomes[i].status === "fulfilled")?.name ?? "Competitor"} added` : `${added} competitors added`,
          "success",
        );
        const addedAppIds = outcomes
          .filter((o): o is PromiseFulfilledResult<{ competitorId?: string }> => o.status === "fulfilled")
          .map((o) => o.value.competitorId)
          .filter((id): id is string => !!id);
        onAdded(added, addedAppIds);
      }
      if (failed > 0) addToast(`${failed} competitor${failed === 1 ? "" : "s"} could not be added`, "error");
      if (added > 0) onClose();
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setAdding(false);
    }
  };

  const visibleResults = results.filter((r) => !isStaged(r.bundleId));
  const visibleSuggestions = suggestions.filter((s) => !isStaged(s.bundleId));

  if (!open) return null;

  const row = (c: Candidate, opts: { showRelevance?: boolean } = {}) => (
    <button
      key={c.bundleId}
      onClick={() => stage(c)}
      className="w-full group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left"
    >
      <AppIcon url={c.iconUrl} name={c.name} />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${textPrimary} truncate`}>{c.name}</div>
        <div className={`text-[11px] ${textMuted} truncate`}>{c.developerName ?? c.bundleId}</div>
      </div>
      <span className="flex items-center gap-3 shrink-0">
        {c.rating != null && (
          <span className={`text-[11px] tabular-nums ${textMuted}`}>
            <span className="text-amber-400">&#9733;</span> {c.rating.toFixed(1)}
          </span>
        )}
        {opts.showRelevance && c.relevance != null && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset tabular-nums bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/50">
            REL {c.relevance}
          </span>
        )}
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[#D94412] group-hover:bg-[#D94412]/10">
          <Plus className="w-4 h-4" />
        </span>
      </span>
    </button>
  );

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
            <h2 className={`text-base font-semibold ${textPrimary}`}>Add competitors</h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>Search the App Store to track a competitor, or pick an AI suggestion.</p>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${borderDefault} bg-gray-50/60 dark:bg-[#181c24] focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:focus-within:border-blue-400`}
          >
            <Search className={`w-4 h-4 ${textMuted} shrink-0`} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. habit tracker"
              className={`flex-1 bg-transparent outline-none text-[13px] ${textPrimary} placeholder:text-[#9ca3af] dark:placeholder:text-[#5c6478]`}
            />
            {searching && <div className="spinner !w-3.5 !h-3.5" />}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-2 min-h-[120px]">
          {query.trim().length >= 2 ? (
            <>
              {visibleResults.length > 0 ? (
                visibleResults.map((r) => row(r))
              ) : (
                !searching && (
                  <div className={`flex items-center justify-center py-10 text-xs ${textMuted}`}>No apps found for “{query.trim()}”</div>
                )
              )}
            </>
          ) : (
            <>
              {suggestionsLoading && (
                <div className={`flex items-center justify-center gap-2 py-10 text-xs ${textMuted}`}>
                  <div className="spinner !w-3.5 !h-3.5" /> Finding suggestions…
                </div>
              )}
              {!suggestionsLoading && visibleSuggestions.length > 0 && (
                <div className="mb-1">
                  <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}>
                    <Sparkles className="w-3 h-3 text-[#D94412]" />
                    Suggested by AI
                  </div>
                  {visibleSuggestions.map((s) => row(s, { showRelevance: true }))}
                </div>
              )}
              {!suggestionsLoading && visibleSuggestions.length === 0 && staged.length === 0 && (
                <div className={`flex items-center justify-center py-10 text-xs ${textMuted}`}>
                  Search for an app above to add it as a competitor
                </div>
              )}
            </>
          )}

          {staged.length > 0 && (
            <div className="mt-1">
              <div className={`px-3 pt-2 pb-1.5 text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}>
                Staged for adding
              </div>
              {staged.map((c) => (
                <div
                  key={c.bundleId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <AppIcon url={c.iconUrl} name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium ${textPrimary} truncate`}>{c.name}</div>
                    <div className={`text-[11px] ${textMuted} truncate`}>{c.developerName ?? c.bundleId}</div>
                  </div>
                  <button
                    onClick={() => unstage(c.bundleId)}
                    className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${textMuted} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20`}
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`flex items-center justify-between gap-3 px-5 py-3 border-t ${borderDefault}`}>
          <span className={`text-[12px] ${textSecondary} truncate`}>
            {staged.length === 0
              ? "No competitors selected"
              : `${staged.length} competitor${staged.length === 1 ? "" : "s"} selected`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={adding || staged.length === 0 || !canWrite}
              className={btnPrimary}
            >
              {adding ? (
                <>
                  <div className="spinner !w-3.5 !h-3.5" /> Adding…
                </>
              ) : (
                "Add competitors"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
