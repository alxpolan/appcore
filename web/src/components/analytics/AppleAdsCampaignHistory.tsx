import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import type { ActivityLogResponse } from "../../types";
import { borderDefault, textMuted, textPrimary } from "../../styles";
import { fmtDateTime, fmtRelativeDateTime } from "../../utils/formatters";

const SOURCE_BADGE: Record<string, string> = {
  mcp: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  web: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  system: "bg-gray-100 text-gray-600 dark:bg-[#252b38] dark:text-[#8b93a5]",
};

export default function AppleAdsCampaignHistory({
  campaignId,
  refreshToken,
}: {
  campaignId: string;
  refreshToken: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<ActivityLogResponse>(
    `/activity?entityType=ads_campaign&entityId=${encodeURIComponent(campaignId)}&limit=50`,
    [campaignId],
    true,
  );

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const entries = data?.entries ?? [];

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
        <div className={`text-[16px] font-semibold ${textPrimary}`}>History</div>
        <div className={`text-[12px] ${textMuted} mt-0.5`}>
          Bid, budget, keyword and status changes to this campaign — newest first
        </div>
      </div>
      {loading ? (
        <div className={`px-5 py-4 text-[13px] ${textMuted}`}>Loading…</div>
      ) : error ? (
        <div className={`px-5 py-4 text-[13px] ${textMuted}`}>Failed to load history</div>
      ) : entries.length === 0 ? (
        <div className={`px-5 py-4 text-[13px] ${textMuted}`}>No changes recorded yet.</div>
      ) : (
        <ul className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
          {entries.map((e) => {
            const isOpen = expanded === e.id;
            const ok = e.status === "success";
            return (
              <li key={e.id}>
                <button
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="w-full text-left px-5 py-3 flex items-start gap-3 hover:bg-[#fafbfc] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <span
                    title={e.status}
                    className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                      ok ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                    }`}
                  >
                    {ok ? (
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                    ) : (
                      <X className="w-3 h-3 text-red-600 dark:text-red-400" strokeWidth={3} />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] ${textPrimary}`}>{e.summary}</span>
                    <span className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${textMuted}`}>
                      <span title={fmtDateTime(e.createdAt)}>{fmtRelativeDateTime(e.createdAt)}</span>
                      <span
                        className={`inline-flex items-center px-1.5 py-px rounded-md font-semibold uppercase tracking-wide text-[10px] ${SOURCE_BADGE[e.source] ?? SOURCE_BADGE.system}`}
                      >
                        {e.source}
                      </span>
                      {e.actor && <span>{e.actor}</span>}
                      <span className="font-mono">{e.action}</span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 mt-1 shrink-0 ${textMuted} transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 pl-[52px]">
                    {e.error && (
                      <div className="mb-2 px-3 py-2 rounded-xl text-[12px] font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {e.error}
                      </div>
                    )}
                    {e.details != null ? (
                      <pre
                        className={`text-[11px] leading-relaxed font-mono ${textMuted} bg-[#fafbfc] dark:bg-[#14171e] border ${borderDefault} rounded-xl px-3 py-2 overflow-x-auto max-h-64 overflow-y-auto`}
                      >
                        {typeof e.details === "string" ? e.details : JSON.stringify(e.details, null, 2)}
                      </pre>
                    ) : (
                      <div className={`text-[12px] ${textMuted}`}>No details recorded.</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !error && data && data.total > entries.length && (
        <div className={`px-5 py-3 text-[12px] ${textMuted} border-t border-[#f3f4f6] dark:border-[#2a2f3d]`}>
          Showing {entries.length} of {data.total} entries
        </div>
      )}
    </div>
  );
}
