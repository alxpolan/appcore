import { useState } from "react";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import SectionCard from "../settings/SectionCard";
import { TD, TH, borderDefault, inputCls, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeToParams } from "../../utils/analyticsRange";

interface TimingBucketRow {
  key: string;
  label: string;
  maxSeconds: number | null;
  users: number;
  subscribed: number;
  trialsStarted: number;
  cancelled: number;
  conversionRate: number | null;
  cancelRate: number | null;
}

interface TimingResponse {
  ok: boolean;
  buckets: TimingBucketRow[];
  totalUsers: number;
  excludedNoAnchor: number;
  excludedNoActivity: number;
  capped: boolean;
  maturityDays: number;
  anchorEvent: string;
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function InAppOptimization({ addToast }: Props) {
  void addToast;

  const bundleId = getActiveBundleId() ?? "";
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [anchorEvent, setAnchorEvent] = useState("$first_event");
  const [anchorDraft, setAnchorDraft] = useState("$first_event");
  const [maturityDays, setMaturityDays] = useState("14");
  const [appliedMaturity, setAppliedMaturity] = useState("14");
  const query = `${rangeToParams(range, customStart, customEnd)}&anchorEvent=${encodeURIComponent(anchorEvent)}&maturityDays=${encodeURIComponent(appliedMaturity || "14")}`;

  const { data, loading, error } = useApi<TimingResponse>(`/posthog/paywall-timing?bundleId=${encodeURIComponent(bundleId)}${query}`, [
    bundleId,
    range,
    customStart,
    customEnd,
    anchorEvent,
    appliedMaturity,
  ]);

  const hasRows = !!data && data.buckets.some((b) => b.users > 0);
  const applyAnchor = () => setAnchorEvent(anchorDraft.trim() || "$first_event");
  const applyMaturity = () => setAppliedMaturity(maturityDays.trim() || "14");

  if (!bundleId) {
    return (
      <div className="max-w-[1200px] mx-auto">
        <h1 className={pageTitle}>In-App Optimization</h1>
        <p className={`text-[13px] ${textMuted} mt-1`}>Select an app to see its paywall timing.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto">
      <h1 className={pageTitle}>In-App Optimization</h1>
      <p className={`text-[13px] ${textMuted} mt-1 mb-4`}>
        How long users explore for free before the first paywall — and how it converts. Users are grouped by
        the time from the anchor event to their first paywall view.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                range === opt.key
                  ? "bg-white dark:bg-[#252b38] text-[#111827] dark:text-[#e8eaf0] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : `${textMuted} hover:text-[#6b7280]`
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
              className={`${inputCls} h-8 !py-1 text-[12px] w-auto`}
            />
            <span className={`text-[12px] ${textMuted}`}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`${inputCls} h-8 !py-1 text-[12px] w-auto`}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className={`text-[12px] ${textMuted}`}>Anchor event</span>
          <input
            type="text"
            value={anchorDraft}
            onChange={(e) => setAnchorDraft(e.target.value)}
            onBlur={applyAnchor}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyAnchor();
            }}
            placeholder="$first_event"
            spellCheck={false}
            className={`${inputCls} h-8 !py-1 font-mono text-[12px] w-44`}
            title="Event the free-usage time is measured from ($first_event = first tracked event)"
          />
          <span className={`text-[12px] ${textMuted}`}>Cancel after</span>
          <input
            type="number"
            min={1}
            max={365}
            value={maturityDays}
            onChange={(e) => setMaturityDays(e.target.value)}
            onBlur={applyMaturity}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyMaturity();
            }}
            className={`${inputCls} h-8 !py-1 text-[12px] w-20 tabular-nums`}
            title="Trials older than this (days) without conversion count as cancelled"
          />
          <span className={`text-[12px] ${textMuted}`}>d</span>
        </div>
      </div>

      {loading ? (
        <div className={`text-[13px] ${textMuted}`}>Loading…</div>
      ) : error || !data ? (
        <div className={`text-[13px] ${textMuted}`}>
          {error ?? "Failed to load paywall timing. Connect PostHog first."}
        </div>
      ) : !hasRows ? (
        <div className={`text-[13px] ${textMuted}`}>No paywall views recorded for this app yet.</div>
      ) : (
        <>
          <SectionCard
            title="Time to paywall vs conversion"
            desc={`Based on ${fmtNumber(data.totalUsers)} users${data.excludedNoActivity > 0 ? ` (${fmtNumber(data.excludedNoActivity)} without app activity excluded: test purchases and server-only events)` : ""}${data.excludedNoAnchor > 0 ? ` (${fmtNumber(data.excludedNoAnchor)} without anchor event excluded)` : ""}${data.capped ? " (most recent, capped)" : ""}. Cancelled = trial started but never converted after ${data.maturityDays} days.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[12px]">
                <thead>
                  <tr>
                    <th className={TH}>Free usage before paywall</th>
                    <th className={`${TH} text-right`}>Users</th>
                    <th className={`${TH} text-right`}>Subscribed</th>
                    <th className={`${TH} text-right`}>Conversion</th>
                    <th className={`${TH} text-right`}>Trials</th>
                    <th className={`${TH} text-right`}>Cancelled</th>
                    <th className={`${TH} text-right pr-4`}>Cancel rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => (
                    <tr key={b.key} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                      <td className={`${TD} font-medium ${textPrimary}`}>{b.label}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(b.users)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(b.subscribed)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        <span className="inline-flex items-center justify-end gap-2 w-full">
                          <span
                            className="inline-block h-1.5 rounded-full bg-[#595DD2]"
                            style={{ width: `${Math.min(100, (b.conversionRate ?? 0) * 100)}px`, maxWidth: "120px" }}
                          />
                          {b.conversionRate == null ? "—" : fmtPct(b.conversionRate * 100)}
                        </span>
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtNumber(b.trialsStarted)}</td>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtNumber(b.cancelled)}</td>
                      <td className={`${TD} text-right pr-4 tabular-nums ${textMuted}`}>
                        {b.cancelRate == null ? "—" : fmtPct(b.cancelRate * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
          {data.capped && (
            <p className={`text-[12px] ${textMuted} mt-3`}>
              Analysis capped at the most recent users for performance.
            </p>
          )}
        </>
      )}
    </div>
  );
}
