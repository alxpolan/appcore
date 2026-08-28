import { useState, useMemo } from "react";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import MetricsChart from "./MetricsChart";
import type { ChartMarker } from "./MetricsChart";
import DownloadSourcesChart from "./DownloadSourcesChart";
import DeletionsChart from "./DeletionsChart";
import type { DownloadsData } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { fmtNumber, fmtRevenue, fmtShortDate } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams } from "../../utils/analyticsRange";

export default function AnalyticsDownloads() {
  const bundleId = getActiveBundleId() ?? "";
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sortCol, setSortCol] = useState<keyof typeof COL_KEYS>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);
  const { data: downloads, loading } = useApi<DownloadsData>(`/analytics/downloads?bundleId=${bundleId}${params}`);

  const { data: markersData } = useApi<{
    activatedAt: string | null;
    versionUpdates: { date: string; version: string }[];
  }>(`/analytics/markers?bundleId=${bundleId}`, [bundleId], true);

  const markers: ChartMarker[] = useMemo(() => {
    const result: ChartMarker[] = [];
    if (markersData?.activatedAt) result.push({ date: markersData.activatedAt, type: "activation" });
    for (const v of markersData?.versionUpdates ?? []) result.push({ date: v.date, type: "version", label: v.version });
    return result;
  }, [markersData]);

  const chartData = useMemo(() => {
    const byDay = downloads?.byDay ?? [];
    if (!byDay.length) return byDay;
    const markerDates = markers.map((m) => m.date);
    const minDate = byDay[0].date;
    const maxDate = byDay[byDay.length - 1].date;
    const existing = new Set(byDay.map((d) => d.date));
    const toInject = markerDates.filter((d) => !existing.has(d) && d >= minDate && d <= maxDate);
    if (!toInject.length) return byDay;
    const injected = toInject.map((d) => ({
      date: d,
      downloads: 0,
      updates: 0,
      proceeds: 0,
      impressions: 0,
      pageViews: 0,
      sessions: 0,
      installs: 0,
      deletions: 0,
    }));
    return [...byDay, ...injected].sort((a, b) => a.date.localeCompare(b.date));
  }, [downloads?.byDay, markers]);

  const COL_KEYS = {
    date: "date",
    downloads: "downloads",
    updates: "updates",
    deletions: "deletions",
    proceeds: "proceeds",
    impressions: "impressions",
    pageViews: "pageViews",
    sessions: "sessions",
  } as const;

  const hasEngagementData = (downloads?.byDay ?? []).some((d) => d.impressions > 0 || d.pageViews > 0);
  const hasDeletionData = (downloads?.byDay ?? []).some((d) => (d.deletions ?? 0) > 0);

  const sortedDays = useMemo(() => {
    const rows = [...(downloads?.byDay ?? [])];
    return rows.sort((a, b) => {
      const av = a[sortCol as keyof typeof a];
      const bv = b[sortCol as keyof typeof b];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [downloads?.byDay, sortCol, sortDir]);

  function handleSort(col: keyof typeof COL_KEYS) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "date" ? "desc" : "desc");
    }
  }

  function SortTh({
    col,
    children,
    right,
  }: {
    col: keyof typeof COL_KEYS;
    children: React.ReactNode;
    right?: boolean;
  }) {
    const active = sortCol === col;
    return (
      <th
        className={`${TH} ${right ? "text-right" : ""} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className="opacity-40 [&_svg]:w-3 [&_svg]:h-3">
            {active ? sortDir === "asc" ? <ChevronUp /> : <ChevronDown /> : <ChevronsUpDown />}
          </span>
        </span>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className={`${pageTitle} mb-1`}>Downloads</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                range === opt.key
                  ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                  : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#D94412]`}
            />
            <span className={`${textMuted} text-[12px]`}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#D94412]`}
            />
          </div>
        )}
      </div>

      <div className="mb-5">
        <MetricsChart data={chartData} markers={markers} />
      </div>

      {downloads && <DownloadSourcesChart data={downloads} />}
      {downloads && <DeletionsChart data={downloads} />}

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Daily breakdown</div>
        </div>
        {loading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : sortedDays.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No data for this period</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <SortTh col="date">Date</SortTh>
                <SortTh col="downloads" right>
                  Downloads
                </SortTh>
                <SortTh col="updates" right>
                  Updates
                </SortTh>
                {hasDeletionData && (
                  <SortTh col="deletions" right>
                    Deletions
                  </SortTh>
                )}
                <SortTh col="proceeds" right>
                  Revenue
                </SortTh>
                {hasEngagementData && (
                  <>
                    <SortTh col="impressions" right>
                      Impressions
                    </SortTh>
                    <SortTh col="pageViews" right>
                      Page Views
                    </SortTh>
                    <SortTh col="sessions" right>
                      Sessions
                    </SortTh>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedDays.map((d) => (
                <tr key={d.date} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                  <td className={`${TD} font-mono text-[12px]`}>{fmtShortDate(d.date)}</td>
                  <td className={`${TD} text-right tabular-nums font-medium ${textPrimary}`}>
                    {fmtNumber(d.downloads)}
                  </td>
                  <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                    {d.updates > 0 ? fmtNumber(d.updates) : "—"}
                  </td>
                  {hasDeletionData && (
                    <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                      {(d.deletions ?? 0) > 0 ? fmtNumber(d.deletions) : "—"}
                    </td>
                  )}
                  <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                    {d.proceeds > 0 ? fmtRevenue(d.proceeds) : "—"}
                  </td>
                  {hasEngagementData && (
                    <>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                        {d.impressions > 0 ? fmtNumber(d.impressions) : "—"}
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                        {d.pageViews > 0 ? fmtNumber(d.pageViews) : "—"}
                      </td>
                      <td className={`${TD} text-right tabular-nums pr-5 ${textMuted}`}>
                        {d.sessions > 0 ? fmtNumber(d.sessions) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
