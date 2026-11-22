import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { borderDefault, textMuted, textPrimary } from "../../styles";
import { NegativeKeywordManager } from "./AppleAdsNegativeKeywords";
import type { AppleAdsNegativeKeyword } from "../../types";

export type NegativesModalTarget = { scope: "campaign" } | { scope: "adGroup"; id: string; name: string };

interface Props {
  target: NegativesModalTarget | null;
  campaignId: string | undefined;
  negatives: AppleAdsNegativeKeyword[];
  negativesLoading: boolean;
  negativesError: string | null;
  canEdit: boolean;
  onChanged: () => void;
  onClose: () => void;
}

export default function AppleAdsNegativesModal({
  target,
  campaignId,
  negatives,
  negativesLoading,
  negativesError,
  canEdit,
  onChanged,
  onClose,
}: Props) {
  if (!target) return null;

  const subtitle =
    target.scope === "campaign"
      ? "Campaign level — apply to all ad groups"
      : `Ad group "${target.name}" — apply to this ad group only`;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10 px-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full max-w-2xl max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
          <div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Negative Keywords</h2>
            <div className={`text-[12px] ${textMuted} mt-0.5`}>{subtitle}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {negativesLoading ? (
            <div className={`text-[13px] ${textMuted}`}>Loading…</div>
          ) : negativesError || !campaignId ? (
            <div className={`text-[13px] ${textMuted}`}>Failed to load negative keywords</div>
          ) : (
            <NegativeKeywordManager
              campaignId={campaignId}
              adGroupId={target.scope === "campaign" ? null : target.id}
              negatives={negatives}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
