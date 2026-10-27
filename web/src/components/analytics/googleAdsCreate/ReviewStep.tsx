import { textMuted, textPrimary, textSecondary } from "../../../styles";
import type { GoogleAdsBiddingStrategy } from "../GoogleAdsCampaignAdvancedFields";
import type { CampaignDraft } from "./useCampaignDraft";

const STRATEGY_LABELS: Record<GoogleAdsBiddingStrategy, string> = {
  MANUAL_CPC: "Manual CPC",
  MAXIMIZE_CLICKS: "Maximize clicks",
  MAXIMIZE_CONVERSIONS: "Maximize conversions",
  TARGET_CPA: "Target CPA",
  TARGET_ROAS: "Target ROAS",
};

const card = "border border-[#eef0f3] dark:border-[#2a2f3d] rounded-2xl p-4";
const cardTitle = `text-[13px] font-semibold ${textPrimary}`;
const rowLabel = `text-[12px] ${textMuted}`;
const rowValue = `text-[13px] font-medium ${textPrimary}`;

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12px] text-[#595DD2] font-semibold hover:underline shrink-0"
    >
      Edit
    </button>
  );
}

export function ReviewStep({ draft, onEdit }: { draft: CampaignDraft; onEdit: (step: number) => void }) {
  const extrasCount =
    draft.adSchedule.length +
    draft.sitelinks.length +
    draft.callouts.length +
    draft.structuredSnippets.length +
    draft.calls.length +
    (draft.deviceBidAdjustments.mobile || draft.deviceBidAdjustments.desktop || draft.deviceBidAdjustments.tablet
      ? 1
      : 0);

  return (
    <div>
      <div className={`text-[15px] font-semibold ${textPrimary}`}>Review and create</div>
      <p className={`text-[13px] ${textMuted} mt-0.5`}>
        One last look — everything can still be changed afterwards in Google Ads.
      </p>

      <div className="space-y-3 mt-5">
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className={cardTitle}>Campaign</div>
            <EditButton onClick={() => onEdit(0)} />
          </div>
          <div className="text-[14px] font-semibold text-[#111827] dark:text-[#e8eaf0] truncate">{draft.name || "—"}</div>
          <div className={`text-[12px] ${textSecondary} mt-1`}>
            {draft.dailyBudget ? `${draft.dailyBudget} / day` : "No budget"} ·{" "}
            {draft.startPaused ? "Starts paused" : "Starts enabled"}
            {draft.startDate ? ` · from ${draft.startDate}` : ""}
            {draft.endDate ? ` · until ${draft.endDate}` : ""}
          </div>
          <div className={`text-[12px] ${textSecondary} mt-1`}>
            {draft.displayNetwork ? "Search + Display" : "Search"} ·{" "}
            {draft.searchPartners ? "with Search Partners" : "without Search Partners"} ·{" "}
            {draft.presenceOnly ? "Presence only" : "Presence or interest"}
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className={cardTitle}>Bidding</div>
            <EditButton onClick={() => onEdit(1)} />
          </div>
          <div className={rowValue}>{STRATEGY_LABELS[draft.biddingStrategy]}</div>
          {(draft.targetCpa || draft.targetRoas || draft.cpcBidCeiling) && (
            <div className={`text-[12px] ${textSecondary} mt-1`}>
              {[
                draft.targetCpa ? `Target CPA ${draft.targetCpa}` : "",
                draft.targetRoas ? `Target ROAS ${draft.targetRoas}` : "",
                draft.cpcBidCeiling ? `Max CPC ${draft.cpcBidCeiling}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className={cardTitle}>
              Ad groups · {draft.adGroups.length} · {draft.keywordCount} keyword
              {draft.keywordCount === 1 ? "" : "s"}
            </div>
            <EditButton onClick={() => onEdit(2)} />
          </div>
          <div className="space-y-2">
            {draft.adGroups.map((g, i) => (
              <div key={g.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`${rowValue} truncate`}>
                    {i + 1}. {g.name || "Unnamed group"}
                  </div>
                  {draft.manualBids && g.defaultBid && (
                    <div className={`text-[12px] ${textSecondary} shrink-0`}>Bid {g.defaultBid}</div>
                  )}
                </div>
                <div className={`${rowLabel} truncate`}>
                  {g.keywords.map((k) => k.text.trim()).filter(Boolean).join(", ") || "No keywords yet"}
                </div>
              </div>
            ))}
          </div>
          {draft.campaignNegatives.length > 0 && (
            <div className={`${rowLabel} mt-2`}>
              {draft.campaignNegatives.length} campaign negative
              {draft.campaignNegatives.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <div className={cardTitle}>Extras{extrasCount > 0 ? ` · ${extrasCount}` : ""}</div>
            <EditButton onClick={() => onEdit(3)} />
          </div>
          <div className={`text-[12px] ${textSecondary}`}>
            {extrasCount === 0
              ? "None — schedule, devices, sitelinks, callouts, snippets and calls can be added later."
              : [
                  draft.adSchedule.length > 0
                    ? `${draft.adSchedule.length} schedule window${draft.adSchedule.length === 1 ? "" : "s"}`
                    : "",
                  draft.sitelinks.length > 0
                    ? `${draft.sitelinks.length} sitelink${draft.sitelinks.length === 1 ? "" : "s"}`
                    : "",
                  draft.callouts.length > 0
                    ? `${draft.callouts.length} callout${draft.callouts.length === 1 ? "" : "s"}`
                    : "",
                  draft.structuredSnippets.length > 0
                    ? `${draft.structuredSnippets.length} snippet${draft.structuredSnippets.length === 1 ? "" : "s"}`
                    : "",
                  draft.calls.length > 0 ? `${draft.calls.length} call${draft.calls.length === 1 ? "" : "s"}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>
      </div>

      <p className={`text-[12px] ${textMuted} mt-4`}>
        Geo targeting and responsive search ads are managed in the Google Ads UI after creation.
      </p>
    </div>
  );
}
