import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Eye, EyeOff } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Keyword } from "./KeywordTable";
import { borderDefault, btnSecSm, textMuted, textPrimary, textSecondary } from "../../styles";
import { apiPost } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { KeywordHistoryData } from "../../types";

export type { KeywordHistoryData as HistoryData };

export interface AppliedEvent {
  type: string;
  locale: string;
  appliedAt: string;
}

const OWN_COLOR = "#D94412";
const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#0ea5e9",
];

const MAX_DEFAULT_LINES = 6;

const TYPE_LABEL: Record<string, string> = {
  TITLE: "Title",
  SUBTITLE: "Subtitle",
  KEYWORDS: "Keywords",
  DESCRIPTION: "Description",
};

interface AppSeries {
  name: string;
  color: string;
  isOwn: boolean;
  latestRank: number | null;
  bestRank: number | null;
}

function useDarkMode() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function ChartTooltip({ active, payload, label, dark }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value != null).sort((a: any, b: any) => a.value - b.value);
  if (!rows.length) return null;
  return (
    <div
      style={{
        background: dark ? "#252b38" : "#fff",
        border: `1px solid ${dark ? "#2a2f3d" : "#eef0f3"}`,
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        fontSize: 12,
        minWidth: 170,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: dark ? "#e8eaf0" : "#111827" }}>{label}</div>
      {rows.map((r: any) => (
        <div
          key={r.dataKey}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "2px 0" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 7, color: dark ? "#8b93a5" : "#6b7280" }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: r.color, flexShrink: 0 }} />
            {r.name}
          </span>
          <span style={{ fontWeight: 600, color: dark ? "#e8eaf0" : "#111827" }}>#{r.value}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  keyword: Keyword;
  history: KeywordHistoryData | null;
  loading: boolean;
  ownBundleId?: string | null;
  events?: AppliedEvent[];
  addToast?: (msg: string, type: "success" | "error" | "info") => void;
  onClose: () => void;
}

export default function RankingHistoryChart({
  keyword,
  history,
  loading,
  ownBundleId,
  events,
  addToast,
  onClose,
}: Props) {
  const { canWrite } = usePermissions();
  const dark = useDarkMode();
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);

  const addCompetitor = async (bundleId: string, name: string) => {
    if (!history?.ownAppId) return;
    setAdding((prev) => new Set(prev).add(bundleId));
    try {
      await apiPost(`/apps/${history.ownAppId}/competitors`, { bundleId });
      setTracked((prev) => new Set(prev).add(bundleId));
      addToast?.(`${name} added to competitors`, "success");
    } catch (e: any) {
      addToast?.(e.message, "error");
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(bundleId);
        return next;
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const ownLabel = "Your App";

  const { chartData, markers, series } = useMemo(() => {
    const labelOf = (appName: string, bundleId: string) =>
      ownBundleId && bundleId === ownBundleId
        ? ownLabel
        : appName.length > 20
          ? appName.substring(0, 20) + "\u2026"
          : appName;

    if (!history?.rankings?.length) {
      return { chartData: [], markers: [], series: [] as AppSeries[] };
    }

    const bucketTime = new Map<string, number>();
    const byTime = new Map<string, Record<string, number | null>>();
    const stats = new Map<
      string,
      { isOwn: boolean; latestTs: number; latestRank: number | null; bestRank: number | null }
    >();

    for (const r of history.rankings) {
      const ts = new Date(r.trackedAt).getTime();
      const date = new Date(r.trackedAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!byTime.has(date)) byTime.set(date, {});
      if (!bucketTime.has(date)) bucketTime.set(date, ts);
      const isOwn = !!(ownBundleId && r.appBundleId === ownBundleId);
      const label = labelOf(r.appName, r.appBundleId);
      byTime.get(date)![label] = r.rank;

      const s = stats.get(label) ?? { isOwn, latestTs: -Infinity, latestRank: null, bestRank: null };
      if (ts >= s.latestTs) {
        s.latestTs = ts;
        s.latestRank = r.rank;
      }
      if (r.rank != null && (s.bestRank == null || r.rank < s.bestRank)) s.bestRank = r.rank;
      stats.set(label, s);
    }

    const chartData = Array.from(byTime.entries())
      .reverse()
      .map(([date, ranks]) => ({ date, ...ranks }));

    // markers
    let markers: { label: string; text: string }[] = [];
    if (events?.length) {
      const times = [...bucketTime.entries()].map(([label, ts]) => ({ label, ts }));
      const minTs = Math.min(...times.map((t) => t.ts));
      const maxTs = Math.max(...times.map((t) => t.ts));
      const byLabel = new Map<string, Set<string>>();
      for (const ev of events) {
        const evTs = new Date(ev.appliedAt).getTime();
        if (!Number.isFinite(evTs) || evTs < minTs || evTs > maxTs) continue;
        let nearest = times[0];
        for (const t of times) {
          if (Math.abs(t.ts - evTs) < Math.abs(nearest.ts - evTs)) nearest = t;
        }
        const set = byLabel.get(nearest.label) ?? new Set<string>();
        set.add(TYPE_LABEL[ev.type] ?? ev.type);
        byLabel.set(nearest.label, set);
      }
      markers = [...byLabel.entries()].map(([label, types]) => ({ label, text: [...types].join(", ") }));
    }

    // series: own first, then others sorted by best rank (ascending = better)
    const own: AppSeries[] = [];
    const others: AppSeries[] = [];
    for (const [name, s] of stats) {
      const entry: AppSeries = { name, color: "", isOwn: s.isOwn, latestRank: s.latestRank, bestRank: s.bestRank };
      (s.isOwn ? own : others).push(entry);
    }
    others.sort((a, b) => (a.bestRank ?? 9999) - (b.bestRank ?? 9999));
    const ordered = [...own, ...others];
    let ci = 0;
    for (const s of ordered) s.color = s.isOwn ? OWN_COLOR : PALETTE[ci++ % PALETTE.length];

    return { chartData, markers, series: ordered };
  }, [history, ownBundleId, events]);

  // Initialise visibility: keep own + top competitors, hide the rest to avoid clutter
  useEffect(() => {
    if (series.length === 0) {
      setHidden(new Set());
      return;
    }
    if (series.length <= MAX_DEFAULT_LINES) {
      setHidden(new Set());
      return;
    }
    const keep = new Set(series.slice(0, MAX_DEFAULT_LINES).map((s) => s.name));
    setHidden(new Set(series.filter((s) => !keep.has(s.name)).map((s) => s.name)));
  }, [series]);

  const visible = series.filter((s) => !hidden.has(s.name));
  const allShown = hidden.size === 0;
  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-[#eef0f3] bg-white shadow-2xl dark:border-[#2a2f3d] dark:bg-[#1c2028]">
        <div className="flex items-start justify-between gap-4 border-b border-[#eef0f3] px-6 py-5 dark:border-[#2a2f3d]">
          <div className="min-w-0">
            <div className={`text-[11px] font-medium uppercase tracking-wider ${textMuted}`}>Ranking History</div>
            <h3 className={`mt-0.5 truncate text-lg font-semibold ${textPrimary}`}>{keyword.term}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-semibold text-[#6b7280] dark:bg-[#252b38] dark:text-[#8b93a5]">
                {keyword.country.toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                Popularity {keyword.popularity ?? "—"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                Difficulty {keyword.difficulty ?? "—"}
              </span>
            </div>
          </div>
          <button className={btnSecSm} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-6">
          {loading ? (
            <div className={`flex justify-center gap-2 py-16 ${textMuted}`}>
              <div className="spinner" /> Loading history…
            </div>
          ) : chartData.length === 0 ? (
            <div className={`py-16 text-center text-sm ${textMuted}`}>No ranking history yet. Run tracking first.</div>
          ) : (
            <>
              <div className={`rounded-2xl border ${borderDefault} bg-[#fcfcfd] p-4 pr-5 dark:bg-[#171b22]`}>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={chartData} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#262b35" : "#eef0f3"} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
                      tickLine={false}
                      axisLine={{ stroke: dark ? "#2a2f3d" : "#eef0f3" }}
                      minTickGap={24}
                    />
                    <YAxis
                      reversed
                      domain={[1, "auto"]}
                      tick={{ fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af" }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      label={{
                        value: "Rank",
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 11, fill: dark ? "#5c6478" : "#9ca3af", textAnchor: "middle" },
                      }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<ChartTooltip dark={dark} />}
                      cursor={{ stroke: dark ? "#3a4150" : "#d1d5db", strokeWidth: 1, strokeDasharray: "4 3" }}
                    />
                    {markers.map((m) => (
                      <ReferenceLine
                        key={m.label}
                        x={m.label}
                        stroke={OWN_COLOR}
                        strokeDasharray="4 3"
                        strokeOpacity={0.6}
                        label={{
                          value: `✎ ${m.text}`,
                          position: "top",
                          fontSize: 10,
                          fill: OWN_COLOR,
                        }}
                      />
                    ))}
                    {[...visible]
                      .sort((a, b) => {
                        const score = (s: AppSeries) => (s.name === hovered ? 2 : s.isOwn ? 1 : 0);
                        return score(a) - score(b);
                      })
                      .map((s) => {
                        const dim = hovered != null && hovered !== s.name;
                        const emphasized = s.name === hovered || s.isOwn;
                        return (
                          <Line
                            key={s.name}
                            type="monotone"
                            dataKey={s.name}
                            stroke={s.color}
                            strokeWidth={emphasized ? 3 : 1.75}
                            strokeOpacity={dim ? 0.15 : 1}
                            dot={{ r: s.isOwn ? 3 : 2, strokeWidth: 0, fillOpacity: dim ? 0.15 : 1 }}
                            activeDot={{ r: 5 }}
                            connectNulls
                            isAnimationActive={false}
                          />
                        );
                      })}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Interactive legend */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className={`text-[11px] font-medium uppercase tracking-wide ${textMuted}`}>
                    Apps · {visible.length}/{series.length} shown
                  </div>
                  <button
                    onClick={() => setHidden(allShown ? new Set(series.map((s) => s.name)) : new Set())}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${textMuted} transition-colors hover:text-[#595DD2]`}
                  >
                    {allShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {allShown ? "Hide all" : "Show all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {series.map((s) => {
                    const off = hidden.has(s.name);
                    return (
                      <button
                        key={s.name}
                        onClick={() => toggle(s.name)}
                        onMouseEnter={() => !off && setHovered(s.name)}
                        onMouseLeave={() => setHovered(null)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${off
                          ? "border-transparent bg-[#f3f4f6] text-[#9ca3af] dark:bg-[#252b38] dark:text-[#5c6478]"
                          : `${borderDefault} ${textSecondary} hover:border-[#d1d5db] dark:hover:border-[#3a4150]`
                          } ${s.isOwn && !off ? "ring-1 ring-[#D94412]/30" : ""}`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: off ? "currentColor" : s.color }}
                        />
                        <span className="max-w-[140px] truncate">{s.name}</span>
                        {!off && s.latestRank != null && (
                          <span className="tabular-nums opacity-60">#{s.latestRank}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {history?.competitors && history.competitors.length > 0 && (
            <div className="mt-8">
              <div className={`mb-3 text-xs font-medium uppercase tracking-wide ${textMuted}`}>
                All apps ranking for this keyword
              </div>
              <div className={`overflow-hidden rounded-xl border ${borderDefault}`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className={`border-b ${borderDefault} text-[11px] uppercase tracking-wider ${textMuted}`}>
                      <th className="px-4 py-2.5 font-semibold">App</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Rank</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.competitors.map((c) => {
                      const isTracked = c.isTracked || tracked.has(c.bundleId);
                      const isAdding = adding.has(c.bundleId);
                      return (
                        <tr
                          key={c.bundleId}
                          className={`border-b last:border-b-0 ${borderDefault} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              {c.iconUrl ? (
                                <img src={c.iconUrl} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded-lg bg-[#f3f4f6] dark:bg-[#252b38] flex items-center justify-center text-[11px] font-bold text-[#6b7280] shrink-0">
                                  {c.name.charAt(0)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className={`text-[13px] font-medium ${textPrimary} truncate`}>{c.name}</div>
                                <div className={`text-[11px] ${textMuted} truncate`}>{c.bundleId}</div>
                              </div>
                            </div>
                          </td>
                          <td className={`px-4 py-2.5 text-right text-[13px] tabular-nums ${textSecondary}`}>
                            {c.rank != null ? `#${c.rank}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {c.isOwn ? (
                              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#D94412]">
                                You
                              </span>
                            ) : isTracked ? (
                              <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${textMuted}`}>
                                <Check className="w-3.5 h-3.5" /> Tracked
                              </span>
                            ) : (
                              <button
                                onClick={() => addCompetitor(c.bundleId, c.name)}
                                disabled={isAdding || !canWrite || !history.ownAppId}
                                className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-[12px] font-semibold border-[#595DD2] bg-[#595DD2] text-white hover:border-[#484CBE] hover:bg-[#484CBE] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isAdding ? (
                                  <>
                                    <div className="spinner !w-3 !h-3" /> Adding…
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" /> Add
                                  </>
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
