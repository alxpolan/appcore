import { useApi, getActiveBundleId } from "../../hooks/useApi";
import SectionCard from "../settings/SectionCard";
import { TD, TH, borderDefault, pageTitle, textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";

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
  capped: boolean;
  maturityDays: number;
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function InAppOptimization({ addToast }: Props) {
  void addToast;

  const bundleId = getActiveBundleId() ?? "";
  const { data, loading, error } = useApi<TimingResponse>(
    `/posthog/paywall-timing?bundleId=${encodeURIComponent(bundleId)}`,
    [bundleId],
  );

  const hasRows = !!data && data.buckets.some((b) => b.users > 0);

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
      <p className={`text-[13px] ${textMuted} mt-1 mb-5`}>
        How long users explore for free before the first paywall — and how it converts. Times are measured from
        the first tracked event to the first paywall view.
      </p>

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
            desc={`Based on ${fmtNumber(data.totalUsers)} users${data.capped ? " (most recent, capped)" : ""}. Cancelled = trial started but never converted after ${data.maturityDays} days.`}
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
