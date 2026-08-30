import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Download, Eye, Monitor, Star } from "lucide-react";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import type { DashboardData, DownloadsData, Review } from "../../types";
import { fmtNumber, fmtLargeNum, countryName } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams, rangeLabel } from "../../utils/analyticsRange";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TD, borderDefault, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import DemoModeFrame from "../DemoModeFrame";
import AscConnectCard from "../AscConnectCard";
import { generateDemoDownloads, generateDemoReviews } from "../../utils/demoAnalyticsData";

function StatTile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-[13px] font-semibold ${textPrimary}`}>{label}</span>
        <span style={{ color }} className="opacity-60">
          {icon}
        </span>
      </div>
      <div className={`text-[36px] font-bold leading-none ${textPrimary}`}>{value}</div>
      <div className={`text-[12px] ${textMuted} mt-2`}>{label}</div>
    </div>
  );
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsCountryDetail({ addToast }: Props) {
  const { country } = useParams<{ country: string }>();
  const navigate = useNavigate();
  const bundleId = getActiveBundleId() ?? "";
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const countryCode = (country ?? "").toUpperCase();

  const params = useMemo(() => rangeToParams(range, customStart, customEnd), [range, customStart, customEnd]);

  const { data: downloads, loading } = useApi<DownloadsData>(
    `/analytics/downloads?bundleId=${bundleId}${params}&country=${countryCode}`,
  );

  const { data: allReviews, loading: reviewsLoading } = useApi<Review[]>(
    `/analytics/reviews?bundleId=${bundleId}&limit=200`,
  );

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;
  const demoSeed = useMemo(
    () => 100 + (countryCode.charCodeAt(0) || 0) + (countryCode.charCodeAt(1) || 0),
    [countryCode],
  );
  const demoDownloads = useMemo(() => generateDemoDownloads(range, demoSeed, 0.12), [range, demoSeed]);
  const demoReviews = useMemo(
    () => generateDemoReviews(18, demoSeed).map((r) => ({ ...r, territory: countryCode })),
    [demoSeed, countryCode],
  );

  const effDownloads = hasASC ? downloads : demoDownloads;
  const effLoading = hasASC && loading;
  const effReviewsLoading = hasASC && reviewsLoading;

  const reviews = useMemo(
    () =>
      hasASC ? (allReviews ?? []).filter((r) => (r.territory ?? "").toUpperCase() === countryCode) : demoReviews,
    [allReviews, countryCode, hasASC, demoReviews],
  );

  const totals = useMemo(() => {
    const rows = effDownloads?.byDay ?? [];
    return {
      downloads: rows.reduce((s, d) => s + d.downloads, 0),
      impressions: rows.reduce((s, d) => s + d.impressions, 0),
      pageViews: rows.reduce((s, d) => s + d.pageViews, 0),
    };
  }, [effDownloads?.byDay]);

  const hasEngagementData = totals.impressions > 0 || totals.pageViews > 0;
  const conversionRate =
    totals.impressions > 0 ? ((totals.downloads / totals.impressions) * 100).toFixed(1) + "%" : "—";

  const ratingCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) counts[r.rating] = (counts[r.rating] ?? 0) + 1;
    return counts;
  }, [reviews]);

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;

  const countryDetailContent = (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatTile
          label="Downloads"
          value={effLoading ? "—" : fmtNumber(totals.downloads)}
          icon={<Download className="w-4 h-4" />}
          color="#6366f1"
        />
        <StatTile
          label="Impressions"
          value={effLoading ? "—" : hasEngagementData ? fmtNumber(totals.impressions) : "—"}
          icon={<Eye className="w-4 h-4" />}
          color="#0ea5e9"
        />
        <StatTile
          label="Page Views"
          value={effLoading ? "—" : hasEngagementData ? fmtNumber(totals.pageViews) : "—"}
          icon={<Monitor className="w-4 h-4" />}
          color="#8b5cf6"
        />
        <StatTile
          label="Conv. Rate"
          value={effLoading ? "—" : hasEngagementData ? conversionRate : "—"}
          icon={<Star className="w-4 h-4" />}
          color="#f59e0b"
        />
      </div>

      {!effLoading && (effDownloads?.byDay ?? []).length > 1 && (
        <div
          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
        >
          <div className={`text-[14px] font-semibold ${textPrimary} mb-1`}>Downloads over time</div>
          <div className={`text-[12px] ${textMuted} mb-4`}>{rangeLabel(range)}</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={effDownloads!.byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cdDlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke="#f0f1f3" vertical={false} strokeWidth={1} />
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
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={(v) => fmtLargeNum(v)}
                width={36}
              />
              <Tooltip
                cursor={{
                  stroke: "#6366f1",
                  strokeWidth: 1.5,
                  strokeDasharray: "3 3",
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const dateStr = new Date(String(label)).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                  return (
                    <div
                      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-3.5 py-2.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.1)]`}
                    >
                      <div className={`${textMuted} mb-1 text-[11px]`}>{dateStr}</div>
                      <div className={`font-semibold ${textPrimary}`}>
                        {fmtNumber(payload[0].value as number)} downloads
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotoneX"
                dataKey="downloads"
                stroke="#6366f1"
                strokeWidth={2.5}
                fill="url(#cdDlGrad)"
                dot={false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: "#fff",
                  fill: "#6366f1",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!effLoading && hasEngagementData && (effDownloads?.byDay ?? []).length > 1 && (
        <div
          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
        >
          <div className={`text-[14px] font-semibold ${textPrimary} mb-1`}>Impressions &amp; Page Views</div>
          <div className={`text-[12px] ${textMuted} mb-4`}>{rangeLabel(range)}</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={effDownloads!.byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cdImpGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cdPvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke="#f0f1f3" vertical={false} strokeWidth={1} />
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
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={(v) => fmtLargeNum(v)}
                width={36}
              />
              <Tooltip
                cursor={{
                  stroke: "#0ea5e9",
                  strokeWidth: 1.5,
                  strokeDasharray: "3 3",
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = new Date(String(label));
                  const dateStr = d.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                  return (
                    <div
                      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl px-3.5 py-2.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.1)] space-y-1`}
                    >
                      <div className={`${textMuted} mb-1 text-[11px]`}>{dateStr}</div>
                      {payload.map((p) => (
                        <div key={p.dataKey as string} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                          <span className={`${textSecondary} capitalize`}>{p.dataKey as string}</span>
                          <span className={`font-semibold ${textPrimary} ml-auto tabular-nums`}>
                            {fmtNumber(p.value as number)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Area
                type="monotoneX"
                dataKey="impressions"
                stroke="#0ea5e9"
                strokeWidth={2.5}
                fill="url(#cdImpGrad)"
                dot={false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: "#fff",
                  fill: "#0ea5e9",
                }}
              />
              <Area
                type="monotoneX"
                dataKey="pageViews"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                fill="url(#cdPvGrad)"
                dot={false}
                activeDot={{
                  r: 5,
                  strokeWidth: 2,
                  stroke: "#fff",
                  fill: "#8b5cf6",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center justify-between">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Reviews from {countryName(countryCode)}</div>
          {avgRating && (
            <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${textPrimary}`}>
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              {avgRating}
              <span className={`${textMuted} font-normal`}>({reviews.length})</span>
            </div>
          )}
        </div>

        {reviews.length > 0 && (
          <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
            <div className="flex flex-col gap-1.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = ratingCounts[star] ?? 0;
                const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-3">
                    <span className={`text-[12px] ${textMuted} w-3 text-right shrink-0`}>{star}</span>
                    <div className="flex-1 h-2 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-[12px] tabular-nums ${textMuted} w-7 text-right shrink-0`}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {reviewsLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : reviews.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            No reviews from {countryName(countryCode)}
          </div>
        ) : (
          <div className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
            {reviews.slice(0, 30).map((r) => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${
                          s <= r.rating ? "fill-amber-400 text-amber-400" : "text-[#e5e7eb] dark:text-[#2a2f3d]"
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-[11px] ${textMuted} shrink-0`}>
                    {new Date(r.reviewedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {r.title && <div className={`text-[13px] font-semibold ${textPrimary} mb-1`}>{r.title}</div>}
                {r.body && <div className={`text-[13px] ${textSecondary} leading-relaxed line-clamp-4`}>{r.body}</div>}
                {r.reviewerNickname && (
                  <div className="text-[11px] text-[#c4c9d4] dark:text-[#3a4050] mt-1.5">— {r.reviewerNickname}</div>
                )}
              </div>
            ))}
            {reviews.length > 30 && (
              <div className="px-5 py-3 text-center">
                <Link
                  to="/analytics/reviews"
                  className={`text-[12px] ${textMuted} hover:text-[#D94412] transition-colors`}
                >
                  +{reviews.length - 30} more reviews
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className={`p-1.5 rounded-lg hover:bg-[#f3f4f6] dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <img
          src={`/country-flags/${countryCode.toLowerCase()}.svg`}
          alt={countryCode}
          className="w-7 h-5 rounded-sm object-cover shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div>
          <h1 className={`${pageTitle} leading-tight`}>{countryName(countryCode)}</h1>
          <p className={`text-sm ${textMuted}`}>{countryCode} · Analytics breakdown</p>
        </div>
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
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none`}
            />
            <span className="text-[#9ca3af] text-[12px]">–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none`}
            />
          </div>
        )}
      </div>

      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key to see this country's real breakdown."
          addToast={addToast}
        />
      )}

      {hasASC ? countryDetailContent : <DemoModeFrame>{countryDetailContent}</DemoModeFrame>}
    </div>
  );
}
