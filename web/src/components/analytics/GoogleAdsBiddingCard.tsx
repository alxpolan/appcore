import { useState } from "react";
import { Pencil } from "lucide-react";
import { apiPatch, useApi } from "../../hooks/useApi";
import { borderDefault, btnPrimSm, btnSecSm, btnSecondary, textMuted, textPrimary } from "../../styles";
import type { GoogleAdsCampaignBidding } from "../../types";
import {
  BiddingStrategyFields,
  type GoogleAdsBiddingStrategy,
} from "./GoogleAdsCampaignAdvancedFields";

const KNOWN_STRATEGIES: GoogleAdsBiddingStrategy[] = [
  "MANUAL_CPC",
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
  "TARGET_ROAS",
];

const STRATEGY_LABELS: Record<string, string> = {
  MANUAL_CPC: "Manual CPC",
  MAXIMIZE_CLICKS: "Maximize clicks",
  MAXIMIZE_CONVERSIONS: "Maximize conversions",
  TARGET_CPA: "Target CPA",
  TARGET_ROAS: "Target ROAS",
};

function describeBidding(bidding: GoogleAdsCampaignBidding | null, currency: string | null): string {
  if (!bidding || !bidding.strategy) return "Unknown";

  const money = (value: number): string =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 2,
    }).format(value);

  const parts = [STRATEGY_LABELS[bidding.strategy] ?? bidding.strategy];
  if (bidding.cpcBidCeiling != null) parts.push(`max CPC ${money(bidding.cpcBidCeiling)}`);
  if (bidding.targetCpa != null) parts.push(`target CPA ${money(bidding.targetCpa)}`);
  if (bidding.targetRoasPercent != null) parts.push(`target ROAS ${bidding.targetRoasPercent}%`);

  return parts.join(" · ");
}

export default function GoogleAdsBiddingCard({
  campaignId,
  currency,
  canEdit,
  addToast,
}: {
  campaignId: string;
  currency: string | null;
  canEdit: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data, loading, refetch } = useApi<{ bidding: GoogleAdsCampaignBidding }>(
    `/google-ads/campaigns/${campaignId}/bidding`,
    [campaignId],
    true,
  );
  const [editing, setEditing] = useState(false);
  const [strategy, setStrategy] = useState<GoogleAdsBiddingStrategy>("MANUAL_CPC");
  const [ceiling, setCeiling] = useState("");
  const [targetCpa, setTargetCpa] = useState("");
  const [targetRoas, setTargetRoas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bidding = data?.bidding ?? null;

  const startEdit = () => {
    const current = bidding?.strategy && (KNOWN_STRATEGIES as string[]).includes(bidding.strategy)
      ? (bidding.strategy as GoogleAdsBiddingStrategy)
      : "MANUAL_CPC";

    setStrategy(current);
    setCeiling(bidding?.cpcBidCeiling != null ? String(bidding.cpcBidCeiling) : "");
    setTargetCpa(bidding?.targetCpa != null ? String(bidding.targetCpa) : "");
    setTargetRoas(bidding?.targetRoasPercent != null ? String(bidding.targetRoasPercent) : "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setError(null);
    setSaving(true);

    try {
      await apiPatch(`/google-ads/campaigns/${campaignId}/bidding`, {
        biddingStrategy: strategy,
        ...(ceiling.trim() ? { cpcBidCeiling: Number(ceiling) } : {}),
        ...(targetCpa.trim() ? { targetCpa: Number(targetCpa) } : {}),
        ...(targetRoas.trim() ? { targetRoas: Number(targetRoas) } : {}),
      });
      addToast("Bidding updated", "success");
      setEditing(false);
      refetch();
    } catch (e: any) {
      setError(e.message ?? "Failed to update bidding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`border ${borderDefault} rounded-2xl px-4 py-3 bg-white dark:bg-[#1c2028]`}>
      {!editing ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0 mr-auto">
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>Bidding</div>
            <div className={`text-[13px] font-medium ${textPrimary} mt-0.5`}>
              {loading && !bidding ? "Loading…" : describeBidding(bidding, currency)}
            </div>
          </div>
          {canEdit && (
            <button type="button" onClick={startEdit} className={btnSecSm} title="Change bidding strategy">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted} mb-2`}>Bidding</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BiddingStrategyFields
              strategy={strategy}
              onStrategyChange={setStrategy}
              cpcBidCeiling={ceiling}
              onCpcBidCeilingChange={setCeiling}
              targetCpa={targetCpa}
              onTargetCpaChange={setTargetCpa}
              targetRoas={targetRoas}
              onTargetRoasChange={setTargetRoas}
            />
          </div>
          {error && (
            <div className="mt-3 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={save} disabled={saving} className={btnPrimSm}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
