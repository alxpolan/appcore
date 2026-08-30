import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApi, getActiveBundleId, authHeaders } from "../../hooks/useApi";
import type { DashboardData, DownloadsData, CountryData } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtNumber, countryName, fmtLargeNum } from "../../utils/formatters";
import { TrendingUp, TrendingDown, ChevronUp, ChevronDown } from "lucide-react";
import DemoModeFrame from "../DemoModeFrame";
import AscConnectCard from "../AscConnectCard";
import { generateDemoDownloads } from "../../utils/demoAnalyticsData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { type RangeKey, RANGE_OPTIONS, rangeToParams, rangeLabel, prevPeriodParams } from "../../utils/analyticsRange";

type CountrySortKey = "country" | "downloads" | "impressions" | "pageViews" | "conv" | "share";

const COUNTRY_LINE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const OTHER_LINE_COLOR = "#9ca3af";

function countrySeriesColor(series: string[], code: string): string {
  if (code === "Other") return OTHER_LINE_COLOR;
  return COUNTRY_LINE_COLORS[series.indexOf(code)] ?? OTHER_LINE_COLOR;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`inline-flex flex-col ml-0.5 leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`w-3 h-3 -mb-1 ${active && dir === "asc" ? "text-[#D94412]" : "text-current"}`} />
      <ChevronDown className={`w-3 h-3 -mt-1 ${active && dir === "desc" ? "text-[#D94412]" : "text-current"}`} />
    </span>
  );
}

function TrendBadge({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev === undefined || prev === null) return null;
  if (prev === 0 && current === 0) return null;
  if (prev === 0) return <span className="ml-1 text-[10px] text-emerald-500 font-medium">new</span>;
  const pct = ((current - prev) / prev) * 100;
  const isUp = pct >= 0;
  return (
    <span
      className={`inline-flex items-center ml-1 text-[10px] font-medium gap-0.5 ${isUp ? "text-emerald-500" : "text-rose-500"}`}
    >
      {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsCountries({ addToast }: Props) {
  const bundleId = getActiveBundleId() ?? "";
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showTrend, setShowTrend] = useState(false);
  const [prevCountryData, setPrevCountryData] = useState<CountryData[] | null>(null);
  const [sortBy, setSortBy] = useState<CountrySortKey>("downloads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: CountrySortKey) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(key === "country" ? "asc" : "desc");
    }
  };

  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);

  const { data: downloads, loading } = useApi<DownloadsData>(`/analytics/downloads?bundleId=${bundleId}${params}`);

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;
  const demoDownloads = useMemo(() => generateDemoDownloads(range), [range]);
  const effDownloads = hasASC ? downloads : demoDownloads;
  const effLoading = hasASC && loading;

  const anchorDate = useMemo(() => {
    const days = effDownloads?.byDay ?? [];
    if (!days.length) return undefined;
    const max = days.reduce((m, d) => (d.date > m ? d.date : m), days[0].date);
    return new Date(max);
  }, [effDownloads]);

  const prevParams = useMemo(
    () => (hasASC ? prevPeriodParams(range, customStart, customEnd, anchorDate) : null),
    [range, customStart, customEnd, anchorDate, hasASC],
  );

  const hasEngagementData = (effDownloads?.byCountry ?? []).some((c) => c.impressions > 0 || c.pageViews > 0);

  useEffect(() => {
    if (!showTrend || !prevParams || !bundleId) {
      setPrevCountryData(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/analytics/downloads?bundleId=${bundleId}${prevParams}`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((d: DownloadsData) => {
        if (!cancelled) setPrevCountryData(d.byCountry);
      })
      .catch(() => {
        if (!cancelled) setPrevCountryData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showTrend, prevParams, bundleId]);

  const prevByCountry = useMemo(
    () => Object.fromEntries((prevCountryData ?? []).map((c) => [c.country, c])),
    [prevCountryData],
  );

  const sortedCountries = useMemo(() => {
    const rows = [...(effDownloads?.byCountry ?? [])];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "country":
          cmp = countryName(a.country).localeCompare(countryName(b.country));
          break;
        case "impressions":
          cmp = a.impressions - b.impressions;
          break;
        case "pageViews":
          cmp = a.pageViews - b.pageViews;
          break;
        case "conv": {
          const ca = a.impressions > 0 ? a.downloads / a.impressions : -1;
          const cb = b.impressions > 0 ? b.downloads / b.impressions : -1;
          cmp = ca - cb;
          break;
        }
        default:
          cmp = a.downloads - b.downloads;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [effDownloads, sortBy, sortDir]);

  const SortableTh = ({
    sortKey,
    label,
    align = "left",
    extra = "",
  }: {
    sortKey: CountrySortKey;
    label: string;
    align?: "left" | "right";
    extra?: string;
  }) => (
    <th
      className={`${TH} ${align === "right" ? "text-right" : ""} ${extra} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
      onClick={() => handleSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end" : ""}`}>
        {label}
        <SortIcon active={sortBy === sortKey} dir={sortDir} />
      </span>
    </th>
  );

  const countriesContent = (
    <>
      {!effLoading &&
        (effDownloads?.byCountryDay ?? []).length > 1 &&
        (effDownloads?.countrySeries ?? []).length > 0 &&
        (() => {
          const series = effDownloads!.countrySeries;
          const byCountryDay = effDownloads!.byCountryDay;
          const seriesLabel = (code: string) => (code === "Other" ? "Other" : countryName(code));
          const totals: Record<string, number> = {};
          for (const c of effDownloads!.byCountry) {
            const label = series.includes(c.country) ? c.country : "Other";
            totals[label] = (totals[label] ?? 0) + c.downloads;
          }
          return (
            <div
              className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
            >
              <div className={`text-[14px] font-semibold ${textPrimary} mb-1`}>Downloads by country</div>
              <div className={`text-[12px] ${textMuted} mb-4`}>{rangeLabel(range)}</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={byCountryDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid
                    strokeDasharray="0"
                    stroke="#f0f1f3"
                    className="dark:[&_line]:stroke-[#2a2f3d]"
                    vertical={false}
                    strokeWidth={1}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                    interval="preserveStartEnd"
                    minTickGap={32}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v) => fmtLargeNum(v)}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ stroke: "#c3c9d4", strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const d = new Date(String(label));
                      const dateStr = d.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      });
                      const rows = payload
                        .filter((p) => typeof p.value === "number" && (p.value as number) > 0)
                        .sort((a, b) => (b.value as number) - (a.value as number));
                      const total = rows.reduce((sum, r) => sum + (r.value as number), 0);
                      return (
                        <div
                          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-3.5 py-2.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.1)] min-w-[170px]`}
                        >
                          <div className={`${textMuted} mb-1 text-[11px]`}>{dateStr}</div>
                          {rows.map((r) => (
                            <div key={String(r.dataKey)} className="flex items-center justify-between gap-3 py-px">
                              <span className={`flex items-center gap-1.5 ${textMuted}`}>
                                <span
                                  className="inline-block w-2 h-2 rounded-[2px]"
                                  style={{ background: countrySeriesColor(series, String(r.dataKey)) }}
                                />
                                {seriesLabel(String(r.dataKey))}
                              </span>
                              <span className={`font-semibold tabular-nums ${textPrimary}`}>
                                {fmtNumber(r.value as number)}
                              </span>
                            </div>
                          ))}
                          {rows.length > 1 && (
                            <div
                              className={`flex items-center justify-between gap-3 mt-1 pt-1 border-t border-[#eef0f3] dark:border-[#2a2f3d] font-semibold ${textPrimary}`}
                            >
                              <span>Total</span>
                              <span className="tabular-nums">{fmtNumber(total)}</span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  {series.map((code) => {
                    const color = countrySeriesColor(series, code);
                    return (
                      <Line
                        key={code}
                        type="monotone"
                        dataKey={code}
                        name={seriesLabel(code)}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: color }}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>

              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 pt-4 border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                {series.map((code) => (
                  <div key={code} className="flex items-center gap-2 text-[12px]">
                    <span
                      className="inline-block w-2 h-2 rounded-[2px]"
                      style={{ backgroundColor: countrySeriesColor(series, code) }}
                    />
                    <span className={textMuted}>{seriesLabel(code)}</span>
                    <span className={`font-medium tabular-nums ${textPrimary}`}>{fmtNumber(totals[code] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      {!effLoading &&
        (effDownloads?.byCountry ?? []).length > 0 &&
        (() => {
          const top = (effDownloads?.byCountry ?? []).slice(0, 15);
          const chartData = top.map((c) => ({
            name: countryName(c.country),
            downloads: c.downloads,
          }));
          return (
            <div
              className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
            >
              <div className={`text-[14px] font-semibold ${textPrimary} mb-4`}>Top {top.length} Countries</div>
              <ResponsiveContainer width="100%" height={top.length * 32 + 8}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                  barCategoryGap="30%"
                >
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v) => fmtLargeNum(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#6b7280" }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.025)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div
                          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-3.5 py-2.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.1)]`}
                        >
                          <div className={`font-medium ${textPrimary} mb-0.5`}>{d.name}</div>
                          <div className={`${textMuted} tabular-nums`}>{fmtNumber(d.downloads)} downloads</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="downloads" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i === 0 ? "#D94412" : i < 3 ? "#f87171" : "#fca5a5"}
                        fillOpacity={i === 0 ? 1 : i < 3 ? 0.8 : 0.5}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })()}

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>All Countries</div>
          <button
            onClick={() => setShowTrend((v) => !v)}
            disabled={!prevParams}
            title={
              !hasASC
                ? "Trend not available in demo mode"
                : !prevParams
                  ? "Trend not available for this range"
                  : "Toggle period-over-period trend"
            }
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              showTrend
                ? "bg-[#D94412] text-white"
                : "bg-[#f3f4f6] dark:bg-[#252b38] ${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Trend
          </button>
        </div>
        {effLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : (effDownloads?.byCountry ?? []).length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No data for this period</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <SortableTh sortKey="country" label="Country" />
                <SortableTh sortKey="downloads" label="Downloads" align="right" />
                {hasEngagementData && (
                  <>
                    <SortableTh sortKey="impressions" label="Impressions" align="right" />
                    <SortableTh sortKey="pageViews" label="Page Views" align="right" />
                    <SortableTh sortKey="conv" label="Conv. Rate" align="right" />
                  </>
                )}
                <SortableTh sortKey="share" label="Share" align="right" extra="pr-5" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const total = (effDownloads?.byCountry ?? []).reduce((s, r) => s + r.downloads, 0);
                return sortedCountries.map((r) => {
                  const conv = r.impressions > 0 ? ((r.downloads / r.impressions) * 100).toFixed(1) + "%" : "—";
                  return (
                    <tr
                      key={r.country}
                      onClick={() => navigate(`/analytics/countries/${r.country.toLowerCase()}`)}
                      className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer"
                    >
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <img
                            src={`/country-flags/${r.country.toLowerCase()}.svg`}
                            alt={r.country}
                            className="w-5 h-4 rounded-xs object-cover shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                          <span className={`font-medium ${textPrimary}`}>{countryName(r.country)}</span>
                          <span className={`text-[11px] ${textMuted}`}>{r.country.toUpperCase()}</span>
                        </div>
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {fmtNumber(r.downloads)}
                        {showTrend && <TrendBadge current={r.downloads} prev={prevByCountry[r.country]?.downloads} />}
                      </td>
                      {hasEngagementData && (
                        <>
                          <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                            {r.impressions > 0 ? fmtNumber(r.impressions) : "—"}
                            {showTrend && r.impressions > 0 && (
                              <TrendBadge current={r.impressions} prev={prevByCountry[r.country]?.impressions} />
                            )}
                          </td>
                          <td className={`${TD} text-right tabular-nums ${textMuted}`}>
                            {r.pageViews > 0 ? fmtNumber(r.pageViews) : "—"}
                            {showTrend && r.pageViews > 0 && (
                              <TrendBadge current={r.pageViews} prev={prevByCountry[r.country]?.pageViews} />
                            )}
                          </td>
                          <td className={`${TD} text-right tabular-nums ${textMuted}`}>{conv}</td>
                        </>
                      )}
                      <td className={`${TD} text-right pr-5`}>
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#D94412] rounded-full"
                              style={{
                                width: `${total > 0 ? (r.downloads / total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className={`text-[12px] ${textMuted} w-9 text-right`}>
                            {total > 0 ? Math.round((r.downloads / total) * 100) : 0}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className={`${pageTitle} mb-1`}>Countries</h1>
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

      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key to see your real country breakdown."
          addToast={addToast}
        />
      )}

      {hasASC ? countriesContent : <DemoModeFrame>{countriesContent}</DemoModeFrame>}
    </div>
  );
}
