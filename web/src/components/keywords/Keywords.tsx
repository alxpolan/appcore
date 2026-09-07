import { useState, useRef, useCallback, useEffect } from "react";
import { borderDefault, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { FolderPlus, LayoutGrid, List, Lock, MoreHorizontal, Plus, Search, Target, Upload } from "lucide-react";
import {
  useApi,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  authHeaders,
  getActiveBundleId,
} from "../../hooks/useApi";
import type { KeywordGroup } from "../../types";
import { useClickOutside } from "../../hooks/useClickOutside";
import { usePermissions } from "../../hooks/usePermissions";
import { usePostHog } from "@posthog/react";
import { LANGUAGE_BY_COUNTRY } from "./storefronts";
import KeywordTable, { Keyword, SortKey, opportunityScore } from "./KeywordTable";
import KeywordFilters, { emptyFilters, KeywordFilterState } from "./KeywordFilters";
import KeywordMatrix from "./KeywordMatrix";
import MarketSelector from "./MarketSelector";
import AddKeywordsModal from "./AddKeywordsModal";
import ImportKeywordsModal from "./ImportKeywordsModal";
import RankingHistoryChart, { HistoryData, AppliedEvent } from "./RankingHistoryChart";

type ViewMode = "list" | "matrix";

const FREE_KEYWORDS_PER_APP = 50;

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  isPro: boolean;
}

export default function Keywords({ addToast, isPro }: Props) {
  const posthog = usePostHog();
  const { canWrite } = usePermissions();
  const writeTip = !canWrite ? "Viewer role cannot perform this action" : undefined;
  const [items, setItems] = useState<Keyword[]>([]);
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [suggestionCount, setSuggestionCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const baselinesRef = useRef<Record<string, number>>({});

  const refetch = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Keyword[] }>("/keywords")
      .then((res) => setItems(res.items))
      .finally(() => setLoading(false));
  }, []);

  const refetchGroups = useCallback(() => {
    apiGet<{ groups: KeywordGroup[] }>("/keywords/groups")
      .then((res) => setGroups(res.groups))
      .catch(() => setGroups([]));
  }, []);

  const refetchSuggestions = useCallback(() => {
    apiGet<{ total: number }>("/keywords/suggestions")
      .then((res) => setSuggestionCount(res.total))
      .catch(() => setSuggestionCount(0));
  }, []);

  useEffect(() => {
    refetch();
    refetchGroups();
    refetchSuggestions();
    const handler = () => {
      refetch();
      refetchGroups();
      refetchSuggestions();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [refetch, refetchGroups, refetchSuggestions]);

  // Poll for freshly added keywords until their background ranking lands.
  useEffect(() => {
    if (pendingIds.length === 0) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const res = await apiGet<{ items: Keyword[] }>("/keywords");
        if (cancelled) return;
        setItems(res.items);
        setPendingIds((prev) =>
          prev.filter((id) => {
            const item = res.items.find((k) => k.id === id);
            if (!item) return false; // keyword gone — drop it
            const baseline = baselinesRef.current[id] ?? 0;
            const done = item.ourRank != null || Date.parse(item.updatedAt) > baseline;
            return !done;
          }),
        );
      } catch {
        /* keep polling */
      }
    };
    const interval = setInterval(() => {
      if (Date.now() - startedAt > 90000) {
        setPendingIds([]); // give up after 90s
        return;
      }
      poll();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingIds.join(",")]);
  const { data: keywordFieldsData } = useApi<{
    keywordFields: Record<string, string>;
    indexedText?: Record<string, string>;
  }>("/asc/keyword-fields");

  const { data: appliedData } = useApi<{ suggestions: Record<string, AppliedEvent[]> }>(
    "/suggestions?status=APPLIED&limit=500",
  );
  const appliedEvents: AppliedEvent[] = Object.values(appliedData?.suggestions ?? {})
    .flat()
    .filter((s) => s.appliedAt);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useClickOutside(
    moreRef,
    useCallback(() => setMoreOpen(false), []),
  );

  const [sortBy, setSortBy] = useState<SortKey>("popularity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterCountry, setFilterCountry] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [filters, setFilters] = useState<KeywordFilterState>(emptyFilters);
  const [selectedKeyword, setSelectedKeyword] = useState<Keyword | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const triggerAction = async (endpoint: string, label: string) => {
    setRunning(endpoint);
    try {
      const res = await apiPost(`/actions/${endpoint}`, {
        bundleId: getActiveBundleId(),
      });

      if (endpoint === "discover-keywords") {
        posthog?.capture("keyword_discovery_started", { bundle_id: getActiveBundleId() });
      }

      addToast(res.message || `${label} started`, "success");
      setTimeout(refetch, 2000);
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setRunning(null);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading keywords…
      </div>
    );

  const handleSort = (key: SortKey) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  const keywords = items;
  const remaining = isPro ? null : Math.max(0, FREE_KEYWORDS_PER_APP - keywords.length);
  const atLimit = remaining !== null && remaining <= 0;
  const limitTip = atLimit
    ? `Free plan is limited to ${FREE_KEYWORDS_PER_APP} keywords per app. Upgrade to Pro to track more.`
    : undefined;
  const availableCountries = [...new Set(keywords.map((k) => k.country))].sort();
  const filtered = filterCountry ? keywords.filter((k) => k.country === filterCountry) : keywords;
  const keywordFields = keywordFieldsData?.keywordFields ?? {};
  const indexedText = keywordFieldsData?.indexedText ?? {};

  const resolveLocale = (country: string): string | null => {
    const lang = LANGUAGE_BY_COUNTRY[country] ?? "en";
    const exact = `${lang}-${country.toUpperCase()}`;

    if (keywordFields[exact] != null) return exact;
    const prefix = `${lang}-`;
    return Object.keys(keywordFields).find((l) => l.startsWith(prefix)) ?? null;
  };

  const tokenize = (s: string): string[] =>
    s
      .toLowerCase()
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);

  const stemWord = (w: string): string => {
    if (w.length > 3 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 2 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  };

  const poolWordsCache = new Map<string, Set<string>>();
  const poolWordsForLocale = (locale: string): Set<string> => {
    let words = poolWordsCache.get(locale);
    if (!words) {
      words = new Set(tokenize(indexedText[locale] ?? keywordFields[locale] ?? "").map(stemWord));
      poolWordsCache.set(locale, words);
    }
    return words;
  };

  const isCovered = (term: string, country: string): boolean => {
    const locale = resolveLocale(country);
    if (!locale) return false;

    const poolWords = poolWordsForLocale(locale);
    if (poolWords.size === 0) return false;

    const words = tokenize(term);
    return words.length > 0 && words.every((w) => poolWords.has(stemWord(w)));
  };
  const coveredIds = new Set(keywords.filter((k) => isCovered(k.term, k.country)).map((k) => k.id));

  const coverageLocale = filterCountry ? resolveLocale(filterCountry) : null;
  const coverageField = coverageLocale ? (keywordFields[coverageLocale] ?? "") : "";
  const coverageTotal = filtered.length;
  const coverageCovered = filterCountry ? filtered.filter((k) => coveredIds.has(k.id)).length : 0;
  const coverageChars = coverageField.length;
  const coverageRatio = coverageTotal > 0 ? coverageCovered / coverageTotal : 0;

  const numOrNull = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const inRange = (v: number | null, lo: number | null, hi: number | null): boolean => {
    if (lo == null && hi == null) return true;
    if (v == null) return false;
    if (lo != null && v < lo) return false;
    if (hi != null && v > hi) return false;
    return true;
  };

  const popLo = numOrNull(filters.popMin);
  const popHi = numOrNull(filters.popMax);
  const diffLo = numOrNull(filters.diffMin);
  const diffHi = numOrNull(filters.diffMax);
  const oppLo = numOrNull(filters.oppMin);
  const oppHi = numOrNull(filters.oppMax);

  const userFiltered = filtered.filter((k) => {
    if (!inRange(k.popularity, popLo, popHi)) return false;
    if (!inRange(k.difficulty, diffLo, diffHi)) return false;
    if (!inRange(opportunityScore(k.popularity, k.difficulty), oppLo, oppHi)) return false;

    if (filters.rank !== "all") {
      const r = k.ourRank;
      if (filters.rank === "ranked" && r == null) return false;
      if (filters.rank === "unranked" && r != null) return false;
      if (filters.rank === "top10" && (r == null || r > 10)) return false;
      if (filters.rank === "top20" && (r == null || r > 20)) return false;
      if (filters.rank === "top50" && (r == null || r > 50)) return false;
    }

    if (filters.coverage === "covered" && !coveredIds.has(k.id)) return false;
    if (filters.coverage === "uncovered" && coveredIds.has(k.id)) return false;

    if (filters.trend !== "all") {
      const t = k.rankTrend;
      if (filters.trend === "up" && !(t != null && t > 0)) return false;
      if (filters.trend === "down" && !(t != null && t < 0)) return false;
      if (filters.trend === "flat" && !(t != null && t === 0)) return false;
    }

    return true;
  });

  const sorted = [...userFiltered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "popularity") cmp = (a.popularity ?? -1) - (b.popularity ?? -1);
    else if (sortBy === "rank") cmp = (a.ourRank ?? 999) - (b.ourRank ?? 999);
    else if (sortBy === "difficulty") cmp = (a.difficulty ?? -1) - (b.difficulty ?? -1);
    else if (sortBy === "opportunity")
      cmp = (opportunityScore(a.popularity, a.difficulty) ?? -1) - (opportunityScore(b.popularity, b.difficulty) ?? -1);
    else if (sortBy === "country") cmp = a.country.localeCompare(b.country);
    else cmp = a.term.localeCompare(b.term);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleDelete = async (id: string, term: string) => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return;
    }
    try {
      await apiDelete(`/keywords/${id}`);
      posthog?.capture("keyword_deleted", { keyword: term });
      addToast(`Keyword "${term}" removed`, "info");
      refetch();
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const requireWrite = (): boolean => {
    if (!canWrite) {
      addToast("Viewer role cannot perform this action", "error");
      return false;
    }
    return true;
  };

  const handleCreateGroup = async (name: string) => {
    if (!requireWrite()) return;
    try {
      const res = await apiPost<{ group: KeywordGroup }>("/keywords/groups", {
        name,
        bundleId: getActiveBundleId(),
      });
      setGroups((g) => [...g, res.group]);
      setCreatingGroup(false);
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleRenameGroup = async (id: string, name: string) => {
    if (!requireWrite()) return;
    try {
      const res = await apiPatch<{ group: KeywordGroup }>(`/keywords/groups/${id}`, { name });
      setGroups((g) => g.map((x) => (x.id === id ? res.group : x)));
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!requireWrite()) return;
    try {
      await apiDelete(`/keywords/groups/${id}`);
      setGroups((g) => g.filter((x) => x.id !== id));
      setItems((list) => list.map((k) => (k.groupId === id ? { ...k, groupId: null } : k)));
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleAssignGroup = async (keywordId: string, groupId: string | null) => {
    if (!requireWrite()) return;
    const prev = items;
    setItems((list) => list.map((k) => (k.id === keywordId ? { ...k, groupId } : k)));
    try {
      await apiPut(`/keywords/${keywordId}/group`, { groupId, bundleId: getActiveBundleId() });
    } catch (e: any) {
      setItems(prev);
      addToast(e.message, "error");
    }
  };

  const loadHistory = async (kw: Keyword) => {
    if (selectedKeyword?.id === kw.id) {
      setSelectedKeyword(null);
      setHistory(null);
      return;
    }

    setSelectedKeyword(kw);
    setHistory(null);
    setHistoryLoading(true);

    try {
      const bundleId = getActiveBundleId();
      const res = await fetch(
        `/api/keywords/${kw.id}/history${bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : ""}`,
        { headers: authHeaders() },
      );
      setHistory(await res.json());
    } catch {
      addToast("Failed to load history", "error");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div>
      <h1 className={`${pageTitle} mb-8`}>Keywords</h1>
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <div
          className={`inline-flex items-center p-1 rounded-full border ${borderDefault} bg-gray-50/60 dark:bg-[#181c24]`}
        >
          <button
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold transition-all ${viewMode === "list"
              ? "bg-[#595DD2] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : `${textMuted} hover:${textSecondary.replace(/^text-/, "text-")}`
              }`}
          >
            <List className="w-3.5 h-3.5" /> List
          </button>
          <button
            onClick={() => setViewMode("matrix")}
            aria-pressed={viewMode === "matrix"}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold transition-all ${viewMode === "matrix"
              ? "bg-[#595DD2] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : `${textMuted}`
              }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Matrix
          </button>
        </div>
        {availableCountries.length > 0 && (
          <MarketSelector value={filterCountry} options={availableCountries} onChange={setFilterCountry} />
        )}
        <KeywordFilters value={filters} onChange={setFilters} />
        <div className="flex-1" />
        <button
          onClick={() => setAddModalOpen(true)}
          disabled={!canWrite}
          title={
            writeTip ?? limitTip ?? (suggestionCount > 0 ? `${suggestionCount} new AI suggestions` : "Add keywords")
          }
          className={`relative inline-flex items-center gap-1.5 pl-3 pr-3.5 py-[7px] rounded-full border text-[13px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${atLimit
            ? "border-[#595DD2]/40 bg-[#595DD2]/[0.06] text-[#595DD2] hover:bg-[#595DD2]/10"
            : "border-[#595DD2] bg-[#595DD2] text-white hover:border-[#484CBE] hover:bg-[#484CBE]"
            }`}
        >
          {atLimit ? <Lock className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {atLimit ? "Upgrade to add more" : "Add keywords"}
          {!atLimit && suggestionCount > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-[#595DD2] text-[10px] font-bold tabular-nums ring-2 ring-white dark:ring-[#0f1117]">
              {suggestionCount}
            </span>
          )}
        </button>
        <div ref={moreRef} className="relative">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            title="More actions"
            className={`inline-flex items-center justify-center w-9 h-9 rounded-full border ${borderDefault} bg-white dark:bg-[#1c2028] ${textSecondary} hover:border-gray-300 dark:hover:border-[#3a4050] hover:${textPrimary} transition-all`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {moreOpen && (
            <div
              className={`absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[200px]`}
            >
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setViewMode("list");
                  setCreatingGroup(true);
                }}
                disabled={!canWrite}
                title={writeTip}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <FolderPlus className={`w-3.5 h-3.5 ${textSecondary}`} />
                New group
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setImportModalOpen(true);
                }}
                disabled={!canWrite || atLimit}
                title={writeTip ?? limitTip}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Upload className={`w-3.5 h-3.5 ${textSecondary}`} />
                Import keywords
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  triggerAction("track-keywords", "Track Rankings");
                }}
                disabled={!!running || !canWrite}
                title={writeTip}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Target className={`w-3.5 h-3.5 ${textSecondary}`} />
                {running === "track-keywords" ? "Tracking…" : "Track Rankings"}
              </button>
            </div>
          )}
        </div>
      </div>

      <AddKeywordsModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        defaultCountry={filterCountry}
        onAdded={(added) => {
          posthog?.capture("keyword_added", { count: added.length });
          for (const k of added) baselinesRef.current[k.id] = Date.parse(k.updatedAt) || 0;
          setPendingIds((ids) => [...new Set([...ids, ...added.map((a) => a.id)])]);
          refetch();
        }}
        onSuggestionsChanged={refetchSuggestions}
        addToast={addToast}
        remaining={remaining}
        limit={FREE_KEYWORDS_PER_APP}
      />

      <ImportKeywordsModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        defaultCountry={filterCountry}
        onImported={(count) => {
          posthog?.capture("keywords_imported", { count });
          refetch();
        }}
        addToast={addToast}
        remaining={remaining}
        limit={FREE_KEYWORDS_PER_APP}
      />

      {filterCountry && coverageLocale && coverageTotal > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-900/30">
          <Target className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className={`text-[13px] font-medium ${textPrimary} shrink-0`}>
            {coverageCovered} of {coverageTotal} target keyword{coverageTotal === 1 ? "" : "s"} covered in your{" "}
            {coverageLocale} metadata
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden min-w-[60px]">
            <div
              className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
              style={{ width: `${Math.round(coverageRatio * 100)}%` }}
            />
          </div>
          <div className={`text-[12px] tabular-nums ${textMuted} shrink-0`}>{coverageChars} / 100 chars</div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="py-20 text-center">
          <div className="flex justify-center mb-3 opacity-20">
            <Search className="w-12 h-12 text-[#9ca3af]" />
          </div>
          <div className={`text-sm font-medium ${textSecondary} mb-1`}>No keywords tracked yet</div>
          <div className={`text-xs ${textMuted}`}>Add keywords above or run a competitor keyword extraction</div>
        </div>
      ) : viewMode === "matrix" ? (
        <KeywordMatrix keywords={sorted} onSelect={loadHistory} />
      ) : (
        <KeywordTable
          keywords={sorted}
          groups={groups}
          collapsed={collapsed}
          coveredIds={coveredIds}
          pendingIds={new Set(pendingIds)}
          selectedKeyword={selectedKeyword}
          sortBy={sortBy}
          sortDir={sortDir}
          canWrite={canWrite}
          creating={creatingGroup}
          onSort={handleSort}
          onRowClick={loadHistory}
          onDelete={handleDelete}
          onToggleCollapse={toggleCollapse}
          onCreateGroup={handleCreateGroup}
          onCancelCreate={() => setCreatingGroup(false)}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onAssignGroup={handleAssignGroup}
        />
      )}

      {selectedKeyword && (
        <RankingHistoryChart
          keyword={selectedKeyword}
          history={history}
          loading={historyLoading}
          ownBundleId={getActiveBundleId()}
          events={appliedEvents}
          addToast={addToast}
          onClose={() => {
            setSelectedKeyword(null);
            setHistory(null);
          }}
        />
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-[#5c6478] mt-2">
        <span>
          {sorted.length}
          {sorted.length !== keywords.length ? ` of ${keywords.length}` : ""} keyword
          {sorted.length !== 1 ? "s" : ""} tracked
        </span>
        {remaining !== null && (
          <span className={`tabular-nums ${atLimit ? "text-[#595DD2] font-medium" : ""}`}>
            · Free plan {keywords.length}/{FREE_KEYWORDS_PER_APP}
            {atLimit ? " · limit reached" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
