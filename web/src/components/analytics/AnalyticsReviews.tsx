import { useState, useMemo } from "react";
import { borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import ReviewsList from "./ReviewsList";
import RatingTrendChart from "./RatingTrendChart";
import type { DashboardData, Review, RatingsData } from "../../types";
import DemoModeFrame from "../DemoModeFrame";
import AscConnectCard from "../AscConnectCard";
import { generateDemoReviews, generateDemoRatings } from "../../utils/demoAnalyticsData";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AnalyticsReviews({ addToast }: Props) {
  const bundleId = getActiveBundleId() ?? "";
  const [minRating, setMinRating] = useState<number | null>(null);
  const { data: reviews, loading } = useApi<Review[]>(`/analytics/reviews?bundleId=${bundleId}&limit=200`);
  const { data: ratings } = useApi<RatingsData>(`/analytics/ratings?bundleId=${bundleId}&period=all`);

  const { data: dash } = useApi<DashboardData>("/dashboard");
  const hasASC = dash?.config?.hasASC ?? true;
  const demoReviews = useMemo(() => generateDemoReviews(24), []);
  const demoRatings = useMemo(() => generateDemoRatings(), []);

  const effReviews = hasASC ? reviews : demoReviews;
  const effRatings = hasASC ? ratings : demoRatings;
  const effLoading = hasASC && loading;

  const filtered = effReviews
    ? minRating !== null
      ? effReviews.filter((r) => r.rating === minRating)
      : effReviews
    : [];

  const reviewsContent = (
    <>
      {effRatings && <RatingTrendChart data={effRatings} />}

      {!effLoading && (effReviews ?? []).length > 0 && (
        <div
          className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
        >
          <div className={`text-[16px] font-semibold ${textPrimary} mb-4`}>Rating Distribution</div>
          <div className="space-y-2.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const total = effReviews?.length ?? 0;
              const count = (effReviews ?? []).filter((r) => r.rating === star).length;
              const pct = total > 0 ? (count / total) * 100 : 0;
              const isActive = minRating === star;
              return (
                <button
                  key={star}
                  onClick={() => setMinRating(isActive ? null : star)}
                  className={`w-full flex items-center gap-3 rounded-lg px-2 py-1 -mx-2 transition-colors text-left ${
                    isActive ? "bg-[#fde8eb] dark:bg-[#3a1f23]" : "hover:bg-[#f7f8fa] dark:hover:bg-[#252b38]"
                  }`}
                >
                  <span className={`text-[13px] ${textPrimary} w-3 text-right shrink-0`}>{star}</span>
                  <div className="flex-1 h-2 bg-[#f3f4f6] dark:bg-[#252b38] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isActive ? "bg-[#D94412]" : "bg-amber-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-[12px] ${textMuted} w-8 text-right tabular-nums shrink-0`}>{count}</span>
                  <span className="text-[11px] text-[#c4c9d4] dark:text-[#3a4050] w-10 text-right tabular-nums shrink-0">
                    {pct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
          {minRating !== null && (
            <button onClick={() => setMinRating(null)} className="mt-3 text-[11px] text-[#D94412] hover:underline">
              Clear filter
            </button>
          )}
        </div>
      )}

      <ReviewsList reviews={filtered} />
    </>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className={`${pageTitle} mb-1`}>Reviews</h1>
      </div>

      {!hasASC && (
        <AscConnectCard
          className="mb-5"
          description="Connect your App Store Connect API key to pull your real reviews and ratings."
          addToast={addToast}
        />
      )}

      {hasASC ? reviewsContent : <DemoModeFrame>{reviewsContent}</DemoModeFrame>}
    </div>
  );
}
