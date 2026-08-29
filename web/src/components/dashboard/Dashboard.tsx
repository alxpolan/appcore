import { useApi } from "../../hooks/useApi";
import StatsGrid from "./StatsGrid";
import AppInfoCard from "./AppInfoCard";
import ActionPlan from "./ActionPlan";
import RecentSuggestionsTable from "./RecentSuggestionsTable";
import DownloadsChart from "../analytics/DownloadsChart";
import type { DashboardData, DownloadsData } from "../../types";

export default function Dashboard({
  addToast,
}: {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data, loading, error } = useApi<DashboardData>("/dashboard");
  const { data: downloads } = useApi<DownloadsData>("/analytics/downloads?days=90");

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading dashboard…
      </div>
    );
  if (error) return <div className="py-20 text-center text-gray-400 dark:text-[#5c6478]">{error}</div>;
  if (!data) return null;
  const { app, stats, config, lastJob, recentSuggestions } = data;

  return (
    <div>
      {app && <AppInfoCard app={app} />}

      {app && <ActionPlan hasASC={config.hasASC} addToast={addToast} />}

      <StatsGrid stats={stats} />

      {downloads && (
        <div className="mb-5">
          <DownloadsChart data={downloads.byDay} />
        </div>
      )}

      <div className="mb-5">
        <RecentSuggestionsTable suggestions={recentSuggestions} lastJob={lastJob ?? undefined} />
      </div>
    </div>
  );
}
