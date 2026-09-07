import { Fragment, useState } from "react";
import { TD, TH, borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import type { Keyword, KeywordGroup } from "../../types";
import {
  TrendingUp,
  TrendingDown,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

export type { Keyword };
export type SortKey = "term" | "country" | "popularity" | "difficulty" | "opportunity" | "rank";

const UNGROUPED = "__ungrouped__";

export const opportunityScore = (popularity: number | null, difficulty: number | null): number | null => {
  if (popularity == null || difficulty == null) return null;
  return (popularity * (100 - difficulty)) / 100;
};

const avgOpportunity = (rows: Keyword[]): number | null => {
  const scores = rows.map((k) => opportunityScore(k.popularity, k.difficulty)).filter((s): s is number => s != null);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
};

const oppTagCls = (s: number) =>
  s > 50
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/50"
    : s > 25
      ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/50"
      : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/25 dark:text-red-300 dark:ring-red-800/50";

const rankColor = (rank: number | null) => {
  if (rank == null) return "text-gray-400 dark:text-[#5c6478]";
  if (rank <= 5) return "text-emerald-600 font-semibold";
  if (rank <= 20) return "text-amber-600 font-semibold";
  return "text-red-500 font-semibold";
};

const trendDisplay = (trend: number | null) => {
  if (trend == null) return <span className="text-gray-400 dark:text-[#5c6478]">—</span>;
  if (trend === 0) return <span className="text-gray-400 dark:text-[#5c6478] text-xs">±0</span>;
  if (trend > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium text-xs">
        <TrendingUp className="w-3 h-3" />+{trend}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-red-500 font-medium text-xs">
      <TrendingDown className="w-3 h-3" />
      {trend}
    </span>
  );
};

const diffColor = (d: number | null) =>
  d == null
    ? "text-gray-400 dark:text-[#5c6478]"
    : d > 60
      ? "text-red-500 font-medium"
      : d > 30
        ? "text-amber-500 font-medium"
        : "text-emerald-600 font-medium";

interface Props {
  keywords: Keyword[];
  groups: KeywordGroup[];
  collapsed: Set<string>;
  coveredIds: Set<string>;
  pendingIds: Set<string>;
  selectedKeyword: Keyword | null;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  canWrite: boolean;
  creating: boolean;
  onSort: (key: SortKey) => void;
  onRowClick: (k: Keyword) => void;
  onDelete: (id: string, term: string) => void;
  onToggleCollapse: (id: string) => void;
  onCreateGroup: (name: string) => void;
  onCancelCreate: () => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAssignGroup: (keywordId: string, groupId: string | null) => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`inline-flex flex-col ml-1 leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`w-4 h-4 -mb-1.5 ${active && dir === "asc" ? "text-[#595DD2]" : "text-current"}`} />
      <ChevronDown className={`w-4 h-4 -mt-1 ${active && dir === "desc" ? "text-[#595DD2]" : "text-current"}`} />
    </span>
  );
}

export default function KeywordTable({
  keywords,
  groups,
  collapsed,
  coveredIds,
  pendingIds,
  selectedKeyword,
  sortBy,
  sortDir,
  canWrite,
  creating,
  onSort,
  onRowClick,
  onDelete,
  onToggleCollapse,
  onCreateGroup,
  onCancelCreate,
  onRenameGroup,
  onDeleteGroup,
  onAssignGroup,
}: Props) {
  const [openRowMenu, setOpenRowMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [openGroupMenu, setOpenGroupMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const closeMenus = () => {
    setOpenRowMenu(null);
    setOpenGroupMenu(null);
  };
  const menuPos = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { top: r.bottom + 4, right: window.innerWidth - r.right };
  };

  const col = (key: SortKey, label: string) => (
    <th
      className={`${TH} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={sortBy === key} dir={sortDir} />
      </span>
    </th>
  );

  const renderRow = (k: Keyword) => (
    <tr
      key={k.id}
      onClick={() => onRowClick(k)}
      className={`cursor-pointer hover:bg-gray-50/60 dark:hover:bg-white/[0.03] ${selectedKeyword?.id === k.id ? "!bg-blue-50/60 dark:!bg-blue-900/20" : ""}`}
    >
      <td className={`${TD} font-medium ${textPrimary} truncate`} title={k.term}>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {coveredIds.has(k.id) && (
            <span
              title="Covered in your app metadata (title, subtitle or keywords)"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 shrink-0"
            >
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
            </span>
          )}
          <span className="truncate">{k.term}</span>
        </span>
      </td>
      <td className={`${TD} ${textSecondary}`}>
        <span className="inline-flex items-center gap-1.5">
          <img
            src={`/country-flags/${k.country.toLowerCase()}.svg`}
            alt={k.country}
            className="w-4 h-3 rounded-xs object-cover shrink-0"
          />
          {k.country.toUpperCase()}
        </span>
      </td>
      <td className={TD}>
        {k.popularity != null ? (
          <span className={`flex items-center gap-1.5 ${textPrimary}`}>
            {k.popularity.toFixed(0)}
            <span className="inline-block h-1 w-8 bg-[#e5e7eb] dark:bg-[#2a2f3d] rounded-sm overflow-hidden align-middle ml-1.5">
              <span
                className="block h-full rounded-sm"
                style={{
                  width: `${Math.min(k.popularity, 100)}%`,
                  background: k.popularity > 60 ? "#10b981" : k.popularity > 30 ? "#f59e0b" : "#ef4444",
                }}
              />
            </span>
          </span>
        ) : (
          <span className="text-gray-400 dark:text-[#5c6478]">—</span>
        )}
      </td>
      <td className={TD}>
        <span className={diffColor(k.difficulty)}>
          {k.difficulty != null ? (
            k.difficulty.toFixed(0)
          ) : (
            <span className="text-gray-400 dark:text-[#5c6478]">—</span>
          )}
        </span>
      </td>
      <td className={TD}>
        {(() => {
          const opp = opportunityScore(k.popularity, k.difficulty);
          return opp != null ? (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ring-1 ring-inset tabular-nums ${oppTagCls(opp)}`}
              title="Popularity × (100 − Difficulty) / 100"
            >
              {opp.toFixed(0)}
            </span>
          ) : (
            <span className="text-gray-400 dark:text-[#5c6478]">—</span>
          );
        })()}
      </td>
      <td className={TD}>
        {k.ourRank != null ? (
          <span className={rankColor(k.ourRank)}>#{k.ourRank}</span>
        ) : pendingIds.has(k.id) ? (
          <span className={`inline-flex items-center gap-1.5 ${textMuted} text-xs`}>
            <span className="spinner !w-3 !h-3" /> tracking…
          </span>
        ) : (
          <span className={`${textMuted} text-xs`}>not ranked</span>
        )}
      </td>
      <td className={TD}>{trendDisplay(k.rankTrend)}</td>
      <td className={TD}>
        {k.topCompetitors.length > 0 ? (
          <span className="inline-flex items-center -space-x-1.5">
            {k.topCompetitors.map((c) =>
              c.iconUrl ? (
                <img
                  key={c.name + c.rank}
                  src={c.iconUrl}
                  alt={c.name}
                  title={`#${c.rank} ${c.name}`}
                  className="w-6 h-6 rounded-md object-cover ring-2 ring-white dark:ring-[#1c2028] shrink-0"
                />
              ) : (
                <span
                  key={c.name + c.rank}
                  title={`#${c.rank} ${c.name}`}
                  className="w-6 h-6 rounded-md bg-gray-200 dark:bg-[#2a2f3d] ring-2 ring-white dark:ring-[#1c2028] shrink-0"
                />
              ),
            )}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-[#5c6478]">—</span>
        )}
      </td>
      <td className={`${TD} relative`}>
        <button
          aria-label="Keyword actions"
          className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${textMuted} hover:bg-gray-100 dark:hover:bg-white/10 hover:${textPrimary} transition-colors`}
          onClick={(e) => {
            e.stopPropagation();
            setOpenGroupMenu(null);
            const pos = menuPos(e);
            setOpenRowMenu((m) => (m?.id === k.id ? null : { id: k.id, ...pos }));
          }}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {openRowMenu?.id === k.id && (
          <div
            style={{ position: "fixed", top: openRowMenu.top, right: openRowMenu.right }}
            className={`z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[200px] text-left`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>
              Move to group
            </div>
            {groups.length === 0 && (
              <div className={`px-3 py-1.5 text-[12px] ${textMuted}`}>No groups yet</div>
            )}
            {groups.map((g) => (
              <button
                key={g.id}
                disabled={!canWrite}
                onClick={() => {
                  onAssignGroup(k.id, g.id);
                  setOpenRowMenu(null);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span className="truncate">{g.name}</span>
                {k.groupId === g.id && <Check className="w-3.5 h-3.5 text-[#595DD2] shrink-0" strokeWidth={3} />}
              </button>
            ))}
            {k.groupId && (
              <button
                disabled={!canWrite}
                onClick={() => {
                  onAssignGroup(k.id, null);
                  setOpenRowMenu(null);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] ${textSecondary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Remove from group
              </button>
            )}
            <div className={`my-1 border-t ${borderDefault}`} />
            <button
              disabled={!canWrite}
              onClick={() => {
                setOpenRowMenu(null);
                onDelete(k.id, k.term);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove keyword
            </button>
          </div>
        )}
      </td>
    </tr>
  );

  const renderGroupHeader = (id: string, name: string, rows: Keyword[], removable: boolean) => {
    const isCollapsed = collapsed.has(id);
    const avg = avgOpportunity(rows);
    return (
      <tr key={`hdr-${id}`} className="bg-gray-50/70 dark:bg-white/[0.02] border-y border-[#f0f1f3] dark:border-[#252a34]">
        <td colSpan={8} className="px-4 py-2.5 cursor-pointer select-none" onClick={() => onToggleCollapse(id)}>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 min-w-0">
              {isCollapsed ? (
                <ChevronRight className={`w-4 h-4 ${textMuted} shrink-0`} />
              ) : (
                <ChevronDown className={`w-4 h-4 ${textMuted} shrink-0`} />
              )}
              {editingGroup === id ? (
                <input
                  autoFocus
                  defaultValue={name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== name) onRenameGroup(id, v);
                    setEditingGroup(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingGroup(null);
                  }}
                  className={`text-[14px] font-semibold ${textPrimary} bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-md px-2 py-0.5 outline-none focus:border-[#595DD2]`}
                />
              ) : (
                <span className={`text-[14px] font-semibold ${textPrimary} truncate`}>{name}</span>
              )}
              <span className={`text-[12px] ${textMuted} shrink-0`}>
                · {rows.length} keyword{rows.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className={`text-[12px] ${textMuted} tabular-nums shrink-0 ml-3`}>
              {avg != null ? `avg opp ${avg.toFixed(0)}` : ""}
            </span>
          </div>
        </td>
        <td className="px-2 py-2.5 relative text-right">
          {removable && (
            <button
              aria-label="Group actions"
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${textMuted} hover:bg-gray-100 dark:hover:bg-white/10 hover:${textPrimary} transition-colors`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenRowMenu(null);
                const pos = menuPos(e);
                setOpenGroupMenu((g) => (g?.id === id ? null : { id, ...pos }));
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          )}
          {openGroupMenu?.id === id && (
            <div
              style={{ position: "fixed", top: openGroupMenu.top, right: openGroupMenu.right }}
              className={`z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[160px] text-left`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                disabled={!canWrite}
                onClick={() => {
                  setOpenGroupMenu(null);
                  setEditingGroup(id);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Rename
              </button>
              <button
                disabled={!canWrite}
                onClick={() => {
                  setOpenGroupMenu(null);
                  onDeleteGroup(id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete group
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const ungrouped = keywords.filter((k) => !k.groupId || !groups.some((g) => g.id === k.groupId));
  const hasGroups = groups.length > 0;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      {(openRowMenu || openGroupMenu) && <div className="fixed inset-0 z-40" onClick={closeMenus} />}
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: "23%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr>
            {col("term", "Keyword")}
            {col("country", "Store")}
            {col("popularity", "Popularity")}
            {col("difficulty", "Difficulty")}
            {col("opportunity", "Opportunity")}
            {col("rank", "Our Rank")}
            <th className={TH}>Trend</th>
            <th className={TH}>Top Competitors</th>
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody>
          {creating && (
            <tr className="bg-gray-50/70 dark:bg-white/[0.02] border-b border-[#f0f1f3] dark:border-[#252a34]">
              <td colSpan={9} className="px-4 py-2.5">
                <input
                  autoFocus
                  placeholder="Group name…"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) onCreateGroup(v);
                    onCancelCreate();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") onCancelCreate();
                  }}
                  className={`text-[13px] ${textPrimary} bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-md px-2.5 py-1 outline-none focus:border-[#595DD2] w-56`}
                />
              </td>
            </tr>
          )}
          {hasGroups ? (
            <>
              {groups.map((g) => {
                const rows = keywords.filter((k) => k.groupId === g.id);
                return (
                  <Fragment key={g.id}>
                    {renderGroupHeader(g.id, g.name, rows, true)}
                    {!collapsed.has(g.id) && rows.map(renderRow)}
                  </Fragment>
                );
              })}
              {ungrouped.length > 0 && (
                <>
                  {renderGroupHeader(UNGROUPED, "Ungrouped", ungrouped, false)}
                  {!collapsed.has(UNGROUPED) && ungrouped.map(renderRow)}
                </>
              )}
            </>
          ) : (
            keywords.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  );
}
