import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { btnSecSm, cardCls, textMuted, textPrimary, textSecondary } from "../styles";

interface CppScreenshotSet {
  id: string;
  label: string;
  campaignName: string | null;
  status: string;
  updatedAt: string;
  studioJobId: string | null;
}

export default function ScreenshotsCppSets({ appId }: { appId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useApi<{ sets: CppScreenshotSet[] }>(`/github/screenshots/cpp-sets/${appId}`, [appId]);
  const sets = data?.sets ?? [];

  if (sets.length === 0) return null;

  return (
    <div className={`${cardCls} mb-5`}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 text-left text-sm font-medium ${textPrimary}`}
      >
        <span>
          {sets.length} CPP screenshot {sets.length === 1 ? "set" : "sets"}
        </span>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col divide-y divide-[#eef0f3] dark:divide-[#2a2f3d]">
          {sets.map((set) => (
            <div key={set.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className={`text-[13px] font-medium ${textPrimary} truncate`}>{set.label}</div>
                <div className={`text-[12px] ${textSecondary} truncate`}>
                  {set.campaignName ?? "—"} · {set.status}
                </div>
              </div>

              {set.studioJobId ? (
                <Link to={`/screenshots/studio/${set.studioJobId}`} className={btnSecSm}>
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Studio
                </Link>
              ) : (
                <span className={`text-[12px] ${textMuted} flex-shrink-0`}>{set.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
