import { useState, useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  RefreshCw,
  ArrowRight,
  Clock,
  Download,
  Eye,
  Monitor,
  Activity,
  DollarSign,
  TrendingUp,
  Smartphone,
  ShoppingBag,
  Info,
} from "lucide-react";
import { useApi, apiPost, getActiveBundleId } from "../../hooks/useApi";
import MetricsChart from "./MetricsChart";
import type { ChartMarker } from "./MetricsChart";
import RetentionCard from "./RetentionCard";
import type { AnalyticsSummary, DashboardData, DownloadsData, PlatformsData, PurchaseData, Review } from "../../types";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtRevenue, fmtRelativeDateTime, fmtPct, countryName } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams, rangeLabel } from "../../utils/analyticsRange";
import AscConnectCard from "../AscConnectCard";
import DemoModeFrame from "../DemoModeFrame";
import {
  generateDemoDownloads,
  generateDemoSummary,
  generateDemoPlatforms,
  generateDemoPurchases,
  generateDemoReviews,
} from "../../utils/demoAnalyticsData";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  if (!data || data.length < 2) return null;
  const w = 200;
  const h = 60;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const allZero = max === 0;
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: allZero ? h - 2 : h - ((v - min) / range) * (h - 8) - 4,
  }));
  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = `M0,${h} ${pts.map((p) => `L${p.x},${p.y}`).join(" ")} L${w},${h} Z`;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={allZero ? 0 : 0.2} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight: _highlight,
  dim,
  note,
  sparkline,
  icon,
  color = "#6366f1",
}: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
  dim?: boolean;
  note?: string;
  sparkline?: number[];
  icon?: ReactNode;
  color?: string;
}) {
  const hasSparkline = !dim && sparkline && sparkline.length >= 2;
  const gradId = `sg_${label.replace(/\W/g, "")}`;
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between mb-3">
          <span className={`text-[13px] font-semibold ${textPrimary}`}>{label}</span>
          {icon && <span className={`${textMuted}`}>{icon}</span>}
        </div>
        <div className={`text-[40px] font-bold leading-none mb-2 ${dim ? textMuted : textPrimary}`}>{value}</div>
        {sub && (
          <div className={`flex items-center gap-1.5 text-[13px] ${textMuted}`}>
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {sub}
          </div>
        )}
        {note && <div className="text-[11px] text-[#c4c9d4] dark:text-[#3a4050] mt-1 leading-tight">{note}</div>}
      </div>
      <div className="h-16">{hasSparkline && <Sparkline data={sparkline!} color={color} id={gradId} />}</div>
    </div>
  );
}

// Funnel levels span multiple orders of magnitude (impressions in the hundreds of
// thousands down to paying users in the hundreds), so bar width is log-scaled
// across the whole funnel rather than taken as a linear % of the top level —
// otherwise the bottom steps would all collapse to the same sliver width.
function funnelWidths(values: number[], minWidthPct: number, maxWidthPct: number): number[] {
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 0) return values.map(() => minWidthPct);
  const maxV = Math.max(...values);
  const minV = Math.min(...nonZero);
  if (maxV <= minV) return values.map((v) => (v > 0 ? maxWidthPct : minWidthPct));
  return values.map((v) => {
    if (v <= 0) return minWidthPct;
    const t = (Math.log(v) - Math.log(minV)) / (Math.log(maxV) - Math.log(minV));
    return minWidthPct + t * (maxWidthPct - minWidthPct);
  });
}

const FUNNEL_BAND_HEIGHT = 74;

function FunnelBand({ topPct, bottomPct, color, y }: { topPct: number; bottomPct: number; color: string; y: number }) {
  const clipPath = `polygon(${50 - topPct / 2}% 0%, ${50 + topPct / 2}% 0%, ${50 + bottomPct / 2}% 100%, ${50 - bottomPct / 2}% 100%)`;
  return (
    <div
      className="absolute left-0 w-full transition-all duration-500"
      style={{ top: y, height: FUNNEL_BAND_HEIGHT, background: color, clipPath }}
    />
  );
}

function FunnelRow({
  label,
  value,
  sub,
  tooltip,
}: {
  label: string;
  value: number;
  sub?: string;
  tooltip?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  return (
    <div className="flex flex-col justify-center" style={{ height: FUNNEL_BAND_HEIGHT }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`flex items-center gap-1.5 text-[13px] font-medium ${textPrimary}`}>
          {label}
          {tooltip && (
            <span
              className="relative inline-flex"
              onMouseEnter={() => setTooltipOpen(true)}
              onMouseLeave={() => setTooltipOpen(false)}
            >
              <button
                type="button"
                aria-label={tooltip}
                onClick={(e) => {
                  e.preventDefault();
                  setTooltipOpen((v) => !v);
                }}
                className="text-gray-400 dark:text-[#5c6478] hover:text-gray-600 dark:hover:text-[#8b93a5] transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              {tooltipOpen && (
                <span className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 px-3 py-2 rounded-lg bg-[#1a1a2e] dark:bg-[#252b38] text-white text-[11px] leading-relaxed shadow-lg pointer-events-none">
                  {tooltip}
                </span>
              )}
            </span>
          )}
        </span>
        <span className={`text-[16px] font-semibold tabular-nums ${textPrimary}`}>{fmtNumber(value)}</span>
      </div>
      {sub && <div className={`text-[11px] ${textMuted} mt-1`}>{sub}</div>}
    </div>
  );
}

export default function Analytics({ addToast }: Props) {
  const bundleId = getActiveBundleId() ?? "";
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [countryMetric, setCountryMetric] = useState<"downloads" | "impressions" | "pageViews">("downloads");

  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);

  const {
    data: summary,
    loading: sumLoading,
    refetch: refetchSummary,
  } = useApi<AnalyticsSummary>(`/analytics/summary?bundleId=${bundleId}${params}`);

  const {
    data: downloads,
    loading: dlLoading,
    refetch: refetchDownloads,
  } = useApi<DownloadsData>(`/analytics/downloads?bundleId=${bundleId}${params}`);

  const { data: reviews, refetch: refetchReviews } = useApi<Review[]>(
    `/analytics/reviews?bundleId=${bundleId}&limit=200`,
  );

  const { data: platforms } = useApi<PlatformsData>(`/analytics/platforms?bundleId=${bundleId}${params}`);

  const { data: purchases } = useApi<PurchaseData[]>(`/analytics/purchases?bundleId=${bundleId}&limit=5`);

  const { data: markersData } = useApi<{
    activatedAt: string | null;
    versionUpdates: { date: string; version: string }[];
  }>(`/analytics/markers?bundleId=${bundleId}`, [bundleId], true);

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;

  const demoDownloads = useMemo(() => generateDemoDownloads(range), [range]);
  const demoSummary = useMemo(() => generateDemoSummary(demoDownloads), [demoDownloads]);
  const demoPlatforms = useMemo(() => generateDemoPlatforms(demoSummary.totalImpressions), [demoSummary]);
  const demoPurchases = useMemo(() => generateDemoPurchases(5), []);
  const demoReviews = useMemo(() => generateDemoReviews(24), []);

  const effDownloads = hasASC ? downloads : demoDownloads;
  const effSummary = hasASC ? summary : demoSummary;
  const effReviews = hasASC ? reviews : demoReviews;
  const effPlatforms = hasASC ? platforms : demoPlatforms;
  const effPurchases = hasASC ? purchases : demoPurchases;

  const markers: ChartMarker[] = useMemo(() => {
    if (!hasASC) return [];
    const result: ChartMarker[] = [];
    if (markersData?.activatedAt) result.push({ date: markersData.activatedAt, type: "activation" });
    for (const v of markersData?.versionUpdates ?? []) result.push({ date: v.date, type: "version", label: v.version });
    return result;
  }, [markersData, hasASC]);

  const chartData = useMemo(() => {
    const byDay = effDownloads?.byDay ?? [];
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
    }));
    return [...byDay, ...injected].sort((a, b) => a.date.localeCompare(b.date));
  }, [effDownloads?.byDay, markers]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiPost("/analytics/sync", { bundleId });
      addToast("Analytics sync started — data will appear shortly", "info");
      setTimeout(() => {
        refetchSummary();
        refetchDownloads();
        refetchReviews();
      }, 3000);
    } catch (err: any) {
      addToast(err.message ?? "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  const hasEngagementData = (effSummary?.totalImpressions ?? 0) > 0 || (effSummary?.totalPageViews ?? 0) > 0;

  const loading = hasASC && (sumLoading || dlLoading);
  const summaryLoading = hasASC && sumLoading;

  const analyticsContent = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Downloads"
          value={summaryLoading ? "—" : fmtNumber(effSummary?.totalDownloads ?? 0)}
          sub={rangeLabel(range)}
          sparkline={effDownloads?.byDay.map((d) => d.downloads)}
          icon={<Download className="w-4 h-4" />}
          color="#6366f1"
        />
        <StatCard
          label="Impressions"
          value={summaryLoading ? "—" : hasEngagementData ? fmtNumber(effSummary?.totalImpressions ?? 0) : "—"}
          sub={rangeLabel(range)}
          dim={!hasEngagementData}
          note={!hasEngagementData ? "Run a 2nd sync once Apple processes the request" : undefined}
          sparkline={effDownloads?.byDay.map((d) => d.impressions)}
          icon={<Eye className="w-4 h-4" />}
          color="#0ea5e9"
        />
        <StatCard
          label="Product Page Views"
          value={summaryLoading ? "—" : hasEngagementData ? fmtNumber(effSummary?.totalPageViews ?? 0) : "—"}
          sub={rangeLabel(range)}
          dim={!hasEngagementData}
          note={!hasEngagementData ? "Run a 2nd sync once Apple processes the request" : undefined}
          sparkline={effDownloads?.byDay.map((d) => d.pageViews)}
          icon={<Monitor className="w-4 h-4" />}
          color="#8b5cf6"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <StatCard
          label="Sessions"
          value={summaryLoading ? "—" : hasEngagementData ? fmtNumber(effSummary?.totalSessions ?? 0) : "—"}
          sub={rangeLabel(range)}
          dim={!hasEngagementData}
          note={!hasEngagementData ? "Run a 2nd sync once Apple processes the request" : undefined}
          sparkline={effDownloads?.byDay.map((d) => d.sessions)}
          icon={<Activity className="w-4 h-4" />}
          color="#10b981"
        />
        <StatCard
          label="Revenue"
          value={summaryLoading ? "—" : fmtRevenue(effSummary?.totalProceeds ?? 0)}
          sub="Developer proceeds"
          sparkline={effDownloads?.byDay.map((d) => d.proceeds)}
          icon={<DollarSign className="w-4 h-4" />}
          color="#f59e0b"
        />
        <StatCard
          label="Conversion Rate"
          value={summaryLoading ? "—" : effSummary?.conversionRate != null ? fmtPct(effSummary.conversionRate) : "—"}
          sub="Downloads / Impressions"
          dim={!hasEngagementData}
          note={!hasEngagementData ? "Requires impressions data" : undefined}
          sparkline={effDownloads?.byDay.map((d) => (d.impressions > 0 ? (d.downloads / d.impressions) * 100 : 0))}
          icon={<TrendingUp className="w-4 h-4" />}
          color="#D94412"
        />
      </div>

      {hasEngagementData &&
        (() => {
          const imp = effSummary?.totalImpressions ?? 0;
          const dl = effSummary?.totalDownloads ?? 0;
          const pay = effSummary?.totalPayingUsers ?? 0;
          const belowMinOs = effSummary?.impressionsBelowMinOs ?? null;
          const afd = belowMinOs != null ? Math.max(0, imp - belowMinOs) : null;

          const afdPct = afd != null && imp > 0 ? (afd / imp) * 100 : null;
          const dropImpToAfd = afdPct != null ? 100 - afdPct : null;
          const dlBase = afd ?? imp;
          const dlPct = dlBase > 0 ? (dl / dlBase) * 100 : 0;
          const dropToDl = 100 - dlPct;
          const payPctOfDownloads = dl > 0 ? (pay / dl) * 100 : 0;
          const dropDlToPay = 100 - payPctOfDownloads;

          const levels: { label: string; value: number; color: string; sub?: string; tooltip?: string }[] = [
            { label: "Impressions", value: imp, color: "#6366f1" },
          ];
          if (afd != null) {
            levels.push({
              label: "Available for Download",
              value: afd,
              color: "#8b5cf6",
              sub: `${afdPct!.toFixed(1)}% of impressions · ${dropImpToAfd!.toFixed(1)}% on unsupported OS`,
              tooltip:
                "Impressions from devices that can actually install your app, i.e. running an OS version at or above your app's minimum requirement. Impressions from devices on an older, unsupported OS are excluded.",
            });
          }
          levels.push({
            label: "Downloads",
            value: dl,
            color: "#0ea5e9",
            sub: `${dlPct.toFixed(1)}% of ${afd != null ? "available" : "impressions"} · ${dropToDl.toFixed(1)}% drop-off`,
          });
          levels.push({
            label: "Paying Users",
            value: pay,
            color: "#D94412",
            sub: `${payPctOfDownloads.toFixed(1)}% of downloads · ${dropDlToPay.toFixed(1)}% drop-off`,
          });

          const widths = funnelWidths(
            levels.map((l) => l.value),
            24,
            100,
          );

          return (
            <div
              className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`text-[16px] font-semibold ${textPrimary}`}>Conversion Funnel</div>
                <span className={`text-[12px] ${textMuted}`}>{rangeLabel(range)}</span>
              </div>
              <div className="flex items-stretch gap-6">
                <div className="relative shrink-0" style={{ width: 180, height: FUNNEL_BAND_HEIGHT * levels.length }}>
                  {levels.map((lvl, i) => (
                    <FunnelBand
                      key={lvl.label}
                      topPct={widths[i]}
                      bottomPct={i < widths.length - 1 ? widths[i + 1] : widths[i]}
                      color={lvl.color}
                      y={i * FUNNEL_BAND_HEIGHT}
                    />
                  ))}
                </div>
                <div className="flex-1 flex flex-col">
                  {levels.map((lvl) => (
                    <FunnelRow key={lvl.label} label={lvl.label} value={lvl.value} sub={lvl.sub} tooltip={lvl.tooltip} />
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

      <div className="mb-5">
        <div className="flex items-center justify-end mb-2">
          <Link
            to="/analytics/downloads"
            className={`flex items-center gap-1 text-[12px] ${textMuted} hover:text-[#D94412] transition-colors`}
          >
            Day-by-day table <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <MetricsChart data={chartData} markers={markers} />
      </div>

      <RetentionCard bundleId={bundleId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div
          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
        >
          <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
            <div className={`text-[16px] font-semibold ${textPrimary}`}>Top Countries</div>
            <div className="flex items-center gap-3">
              {hasEngagementData && (
                <div className="flex gap-1 p-0.5 bg-[#f3f4f6] dark:bg-[#252b38] rounded-lg">
                  {(["downloads", "impressions", "pageViews"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setCountryMetric(m)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        countryMetric === m
                          ? `bg-white dark:bg-[#1c2028] ${textPrimary} shadow-[0_1px_2px_rgba(0,0,0,0.06)]`
                          : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
                      }`}
                    >
                      {m === "downloads" ? "DL" : m === "impressions" ? "Imp." : "Views"}
                    </button>
                  ))}
                </div>
              )}
              <Link
                to="/analytics/countries"
                className={`flex items-center gap-1 text-[12px] ${textMuted} hover:text-[#D94412] transition-colors`}
              >
                All <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
          {(effDownloads?.byCountry ?? []).length === 0 ? (
            <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No data yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={TH}>Country</th>
                  <th className={`${TH} text-right`}>
                    {countryMetric === "downloads"
                      ? "Downloads"
                      : countryMetric === "impressions"
                        ? "Impressions"
                        : "Page Views"}
                  </th>
                  <th className={`${TH} text-right pr-5`}>Share</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...(effDownloads?.byCountry ?? [])].sort(
                    (a, b) => (b[countryMetric] ?? 0) - (a[countryMetric] ?? 0),
                  );
                  const total = sorted.reduce((s, r) => s + (r[countryMetric] ?? 0), 0);
                  return sorted.slice(0, 10).map((r) => {
                    const val = r[countryMetric] ?? 0;
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
                        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(val)}</td>
                        <td className={`${TD} text-right pr-5`}>
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#D94412] rounded-full"
                                style={{
                                  width: `${total > 0 ? (val / total) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className={`text-[12px] ${textMuted} w-9 text-right`}>
                              {total > 0 ? Math.round((val / total) * 100) : 0}%
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

        <div
          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`text-[16px] font-semibold ${textPrimary}`}>Rating Distribution</div>
            <Link
              to="/analytics/reviews"
              className={`flex items-center gap-1 text-[12px] ${textMuted} hover:text-[#D94412] transition-colors`}
            >
              All reviews <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {(effReviews ?? []).length === 0 ? (
            <div className={`py-8 text-center text-[13px] ${textMuted}`}>No reviews yet</div>
          ) : (
            <div className="space-y-2.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = (effReviews ?? []).filter((r) => r.rating === star).length;
                const pct = (effReviews ?? []).length > 0 ? (count / (effReviews ?? []).length) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-3">
                    <span className={`text-[13px] ${textPrimary} w-3 text-right`}>{star}</span>
                    <span className={`text-[13px] ${textPrimary} font-medium`}>{star}</span>
                    <div className="flex-1 h-2 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-[12px] ${textMuted} w-8 text-right tabular-nums`}>{count}</span>
                    <span className="text-[11px] text-[#c4c9d4] dark:text-[#3a4050] w-10 text-right tabular-nums">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className={`w-4 h-4 ${textMuted}`} />
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Impressions &amp; Taps by iOS Version</div>
            </div>
            <span className={`text-[12px] ${textMuted}`}>{rangeLabel(range)}</span>
          </div>
          <div className={`text-[12px] ${textMuted} mt-1`}>
            Apple doesn't break downloads down by iOS version — tap rate (taps ÷ impressions) is the closest proxy for
            whether an old iOS version is costing you conversions.
          </div>
        </div>
        {!hasEngagementData || (effPlatforms?.byVersion ?? []).length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {hasEngagementData ? "No data yet" : "Run a 2nd sync once Apple processes the request"}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>iOS Version</th>
                <th className={`${TH} text-right`}>Impressions</th>
                <th className={`${TH} text-right`}>Taps</th>
                <th className={`${TH} text-right pr-5`}>Tap Rate</th>
              </tr>
            </thead>
            <tbody>
              {(effPlatforms?.byVersion ?? []).slice(0, 8).map((v) => {
                const tapRate = v.impressions > 0 ? (v.taps / v.impressions) * 100 : 0;
                return (
                  <tr key={v.iosVersion} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                    <td className={TD}>
                      <span className={`font-medium ${textPrimary}`}>{v.iosVersion}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(v.impressions)}</td>
                    <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(v.taps)}</td>
                    <td className={`${TD} text-right pr-5`}>
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#D94412] rounded-full"
                            style={{ width: `${Math.min(tapRate, 100)}%` }}
                          />
                        </div>
                        <span className={`text-[12px] ${textMuted} w-12 text-right`}>{fmtPct(tapRate)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className={`w-4 h-4 ${textMuted}`} />
            <div className={`text-[16px] font-semibold ${textPrimary}`}>Recent Transactions</div>
          </div>
          <Link
            to="/analytics/financial"
            className={`flex items-center gap-1 text-[12px] ${textMuted} hover:text-[#D94412] transition-colors`}
          >
            Financial <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {(effPurchases ?? []).length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No purchases synced yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Product</th>
                <th className={TH}>Payment Method</th>
                <th className={TH}>Territory</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right pr-5`}>Proceeds</th>
              </tr>
            </thead>
            <tbody>
              {(effPurchases ?? []).slice(0, 5).map((p, i) => (
                <tr key={i} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                  <td className={TD}>{p.date}</td>
                  <td className={TD}>
                    <span className={`font-medium ${textPrimary}`}>{p.contentName}</span>
                    <span className={`text-[11px] ${textMuted} ml-2`}>{p.purchaseType}</span>
                  </td>
                  <td className={`${TD} ${textMuted}`}>{p.paymentMethod}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <img
                        src={`/country-flags/${p.territory.toLowerCase()}.svg`}
                        alt={p.territory}
                        className="w-5 h-4 rounded-xs object-cover shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className={textPrimary}>{p.territory}</span>
                    </div>
                  </td>
                  <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(p.purchases)}</td>
                  <td className={`${TD} text-right pr-5 tabular-nums ${textPrimary}`}>{fmtRevenue(p.proceedsUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  return (
    <div className="max-w-[1440px] mx-auto">
      <h1 className={`${pageTitle} mb-6`}>Analytics</h1>

      {!loading && !summary?.totalDownloads && (reviews ?? []).length === 0 && hasASC && (
        <div className="mb-5 px-4 py-3.5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 text-[13px] text-amber-800 dark:text-amber-400">
          <strong>No analytics data yet.</strong> Make sure your{" "}
          <Link to="/settings/team-settings" className="underline font-medium">
            Vendor Number
          </Link>{" "}
          is configured in Settings, then click <strong>Sync Now</strong>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex flex-wrap items-center gap-2">
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
        {hasASC && (
          <div className="flex items-center gap-3">
            {summary?.lastSyncAt && (
              <span className={`text-[12px] ${textMuted}`}>
                Last synced {fmtRelativeDateTime(summary.lastSyncAt)}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3.5 h-[38px] rounded-xl text-[12px] font-medium bg-[#D94412] text-white hover:bg-[#c80b24] disabled:opacity-60 transition-colors shrink-0"
            >
              {syncing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync Now
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key to pull downloads, proceeds, impressions and reviews."
          addToast={addToast}
        />
      )}

      {hasASC ? analyticsContent : <DemoModeFrame>{analyticsContent}</DemoModeFrame>}
    </div>
  );
}
