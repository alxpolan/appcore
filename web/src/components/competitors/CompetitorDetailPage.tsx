import { useState, useEffect } from "react";
import { borderDefault, pageTitle, textMuted } from "../../styles";
import { ArrowLeft } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { authHeaders, getActiveBundleId } from "../../hooks/useApi";
import type { CompetitorDetail } from "../../types";
import AppIcon from "./AppIcon";
import { OverviewTab, ReviewsTab, ChangesTab, KeywordsTab } from "./CompetitorDetailTabs";

type Tab = "overview" | "reviews" | "changes" | "keywords";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function CompetitorDetailPage({ addToast }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CompetitorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    if (!id) return;
    const bundleId = getActiveBundleId();
    const url = `/api/apps/${id}/competitor-detail${bundleId ? `?bundleId=${bundleId}` : ""}`;
    fetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        addToast(`Load failed: ${err.message}`, "error");
        setLoading(false);
      });
  }, [id]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "reviews", label: "Reviews", count: data?.reviews.length },
    { key: "changes", label: "Changes", count: data?.metadataChanges.length },
    {
      key: "keywords",
      label: "Keywords",
      count: data?.keywordRankings.filter((k) => k.competitorRank != null).length,
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/competitors")}
          className={`flex items-center gap-1.5 text-sm ${textMuted} hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
        >
          <ArrowLeft className="w-4 h-4" />
          Competitors
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
          <div className="spinner" /> Loading…
        </div>
      ) : !data ? (
        <div className="text-center py-20 text-[#9ca3af]">Failed to load competitor data</div>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-6">
            <AppIcon url={data.iconUrl} name={data.name} />
            <div>
              <h1 className={`${pageTitle}`}>{data.name}</h1>
              <div className={`flex items-center gap-3 text-sm ${textMuted} mt-1`}>
                <span className="font-mono">{data.bundleId}</span>
                {data.rating != null && (
                  <span className="flex items-center gap-1">
                    <span className="text-amber-400">★</span>
                    {data.rating.toFixed(1)}
                    {data.ratingsCount != null && <span>({data.ratingsCount.toLocaleString()})</span>}
                  </span>
                )}
                {data.version && <span>v{data.version}</span>}
                {data.category && <span>{data.category}</span>}
              </div>
            </div>
          </div>

          <div className={`flex gap-1 border-b ${borderDefault} mb-6`}>
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-2 text-[13px] font-medium rounded-t-lg transition-colors ${
                  tab === t.key
                    ? "text-[#D94412] border-b-2 border-[#D94412] -mb-px"
                    : `${textMuted} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-[#252b38] text-[11px]">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab data={data} />}
          {tab === "reviews" && <ReviewsTab data={data} />}
          {tab === "changes" && <ChangesTab changes={data.metadataChanges} />}
          {tab === "keywords" && (
            <KeywordsTab
              rankings={data.keywordRankings}
              untracked={data.untrackedKeywords ?? []}
              country={data.country}
              competitorName={data.name}
              addToast={addToast}
            />
          )}
        </>
      )}
    </div>
  );
}
