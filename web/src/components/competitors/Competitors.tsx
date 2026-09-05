import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { borderDefault, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { LayoutGrid, List, MoreHorizontal, Plus, Radar, Sparkles, Users } from "lucide-react";
import { useApi, apiPost, apiDelete, getActiveBundleId } from "../../hooks/useApi";
import { useClickOutside } from "../../hooks/useClickOutside";
import { usePermissions } from "../../hooks/usePermissions";
import { usePostHog } from "@posthog/react";
import OwnAppCard, { AppItem } from "./OwnAppCard";
import CompetitorCard from "./CompetitorCard";
import CompetitorTable from "./CompetitorTable";
import AddCompetitorsModal from "./AddCompetitorsModal";

type ViewMode = "grid" | "table";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Competitors({ addToast }: Props) {
  const posthog = usePostHog();
  const { canWrite } = usePermissions();
  const { data, loading, refetch } = useApi<AppItem[]>("/apps");
  const navigate = useNavigate();
  const [discovering, setDiscovering] = useState(false);
  const [intelRunning, setIntelRunning] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const moreRef = useRef<HTMLDivElement>(null);
  useClickOutside(
    moreRef,
    useCallback(() => setMoreOpen(false), []),
  );

  const discoverCompetitors = async () => {
    setDiscovering(true);
    try {
      const res = await apiPost("/actions/discover-competitors", {
        bundleId: getActiveBundleId(),
      });
      posthog?.capture("competitor_discovery_started", { bundle_id: getActiveBundleId() });
      addToast(res.message || "Competitor discovery started", "success");
      setTimeout(refetch, 3000);
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setDiscovering(false);
    }
  };

  const runCompetitorIntel = async (competitorAppIds?: string[]) => {
    setIntelRunning(true);
    try {
      const res = await apiPost("/actions/competitor-intel", {
        bundleId: getActiveBundleId(),
        ...(competitorAppIds?.length ? { competitorAppIds } : {}),
      });
      addToast(res.message || "Competitor intel started", "success");
    } catch (e: any) {
      addToast(e.message, "error");
    } finally {
      setIntelRunning(false);
    }
  };

  const removeCompetitor = async (ownAppId: string, competitorId: string) => {
    try {
      await apiDelete(`/apps/${ownAppId}/competitors/${competitorId}`);
      addToast("Competitor removed", "info");
      refetch();
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading competitors…
      </div>
    );

  const apps = data || [];
  const ownApp = apps.find((a) => a.isOwnApp);
  const competitors = apps.filter((a) => !a.isOwnApp);

  return (
    <div>
      <h1 className={`${pageTitle} mb-6`}>Competitors</h1>
      <div className="flex items-center gap-2.5 flex-wrap mb-6">
        <div
          className={`inline-flex items-center p-1 rounded-full border ${borderDefault} bg-gray-50/60 dark:bg-[#181c24]`}
        >
          <button
            onClick={() => setViewMode("grid")}
            aria-pressed={viewMode === "grid"}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold transition-all ${
              viewMode === "grid" ? "bg-[#D94412] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : `${textMuted}`
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Grid
          </button>
          <button
            onClick={() => setViewMode("table")}
            aria-pressed={viewMode === "table"}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold transition-all ${
              viewMode === "table" ? "bg-[#D94412] text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : `${textMuted}`
            }`}
          >
            <List className="w-3.5 h-3.5" /> List
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setAddOpen(true)}
          disabled={!canWrite || !ownApp}
          title={!ownApp ? "Add your app first" : undefined}
          className="inline-flex items-center gap-1.5 pl-3 pr-3.5 py-[7px] rounded-full border border-[#D94412] bg-[#D94412] text-white text-[13px] font-semibold hover:border-[#c80b24] hover:bg-[#c80b24] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Add competitor
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
                  discoverCompetitors();
                }}
                disabled={discovering || intelRunning || !canWrite}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${textSecondary}`} />
                {discovering ? "Discovering…" : "Discover Competitors"}
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  runCompetitorIntel();
                }}
                disabled={discovering || intelRunning || !canWrite}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Radar className={`w-3.5 h-3.5 ${textSecondary}`} />
                {intelRunning ? "Gathering…" : "Gather Intel"}
              </button>
            </div>
          )}
        </div>
      </div>

      {ownApp && <OwnAppCard app={ownApp} />}

      <div className={`text-xs font-medium uppercase tracking-wide ${textMuted} mb-3`}>Competitor Apps</div>
      {competitors.length === 0 ? (
        <div className="py-16 text-center">
          <div className="flex justify-center mb-3 opacity-20">
            <Users className="w-12 h-12 text-[#9ca3af]" />
          </div>
          <div className={`text-sm font-medium ${textSecondary} mb-1`}>No competitors discovered yet</div>
          <div className={`text-xs ${textMuted}`}>Run a scrape from the Actions page</div>
        </div>
      ) : viewMode === "table" ? (
        <CompetitorTable
          competitors={competitors}
          ownAppId={ownApp?.id}
          onRemove={ownApp ? (competitorId) => removeCompetitor(ownApp.id, competitorId) : undefined}
          onRowClick={(id) => navigate(`/competitors/${id}`)}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {competitors.map((c) => (
            <CompetitorCard
              key={c.id}
              competitor={c}
              ownAppId={ownApp?.id}
              onRemove={ownApp ? (competitorId) => removeCompetitor(ownApp.id, competitorId) : undefined}
              onClick={() => navigate(`/competitors/${c.id}`)}
            />
          ))}
        </div>
      )}

      <AddCompetitorsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        ownAppId={ownApp?.id ?? null}
        onAdded={(_count, competitorAppIds) => {
          refetch();
          runCompetitorIntel(competitorAppIds);
        }}
        addToast={addToast}
      />
    </div>
  );
}
