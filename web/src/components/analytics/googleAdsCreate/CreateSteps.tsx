import { Plus, Trash2, X } from "lucide-react";
import { btnSecSm, btnSecondary, inputCls, textMuted, textPrimary, textSecondary } from "../../../styles";
import Field from "../../settings/Field";
import { GoogleNegativeKeywordDraftEditor, type GoogleMatchType } from "../GoogleAdsNegativeKeywords";
import {
  AdScheduleEditor,
  BiddingStrategyFields,
  CalloutsEditor,
  CallsEditor,
  DeviceBidAdjustmentsFields,
  SitelinksEditor,
  StructuredSnippetsEditor,
  type GoogleAdsBiddingStrategy,
} from "../GoogleAdsCampaignAdvancedFields";
import { newKeyword, type CampaignDraft } from "./useCampaignDraft";

const stepTitle = `text-[15px] font-semibold ${textPrimary}`;
const stepSub = `text-[13px] ${textMuted} mt-0.5`;
const blockTitle = `text-[13px] font-semibold ${textPrimary} mb-3`;
const fieldTitle = `text-sm font-medium ${textPrimary} mb-1`;

const STRATEGY_DESCRIPTIONS: Record<GoogleAdsBiddingStrategy, string> = {
  MANUAL_CPC: "You set every keyword bid by hand. Best for starting out with full control.",
  MAXIMIZE_CLICKS: "Google spends your daily budget for as many clicks as possible.",
  MAXIMIZE_CONVERSIONS: "Google bids automatically for as many conversions as possible.",
  TARGET_CPA: "Aims for a fixed average cost per conversion.",
  TARGET_ROAS: "Aims for a fixed return on ad spend, as a ratio like 3.5 for 350%.",
};

export function BasicsStep({ draft }: { draft: CampaignDraft }) {
  return (
    <div>
      <div className={stepTitle}>Campaign basics</div>
      <p className={stepSub}>Name it so you recognise it later, then set what it may spend per day.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <Field label="Name" fullWidth>
          <input
            className={inputCls}
            value={draft.name}
            onChange={(e) => draft.setName(e.target.value)}
            placeholder="MyApp – US – Brand"
          />
        </Field>
        <Field label="Daily budget" hint="In the Google Ads account currency.">
          <input
            className={inputCls}
            inputMode="decimal"
            value={draft.dailyBudget}
            onChange={(e) => draft.setDailyBudget(e.target.value)}
            placeholder="50"
          />
        </Field>
        <Field label="Start date" hint="Optional — defaults to today.">
          <input
            type="date"
            className={inputCls}
            value={draft.startDate}
            onChange={(e) => draft.setStartDate(e.target.value)}
          />
        </Field>
        <Field label="End date" hint="Optional.">
          <input
            type="date"
            className={inputCls}
            value={draft.endDate}
            onChange={(e) => draft.setEndDate(e.target.value)}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2.5 cursor-pointer select-none mt-4 rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] px-4 py-3">
        <input
          type="checkbox"
          checked={draft.startPaused}
          onChange={(e) => draft.setStartPaused(e.target.checked)}
          className="w-4 h-4 rounded accent-[#595DD2] mt-0.5 shrink-0"
        />
        <span className={`text-[13px] ${textSecondary}`}>
          <span className={`font-semibold ${textPrimary}`}>Start paused</span>
          <span className={`block text-[12px] ${textMuted} mt-0.5`}>
            Recommended — review everything in Google Ads before spending a cent.
          </span>
        </span>
      </label>
      <div className={`text-[13px] font-semibold ${textPrimary} mt-6 mb-2`}>Reach</div>
      <div className="space-y-2">
        <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] px-4 py-3">
          <input
            type="checkbox"
            checked={draft.displayNetwork}
            onChange={(e) => draft.setDisplayNetwork(e.target.checked)}
            className="w-4 h-4 rounded accent-[#595DD2] mt-0.5 shrink-0"
          />
          <span className={`text-[13px] ${textSecondary}`}>
            <span className={`font-semibold ${textPrimary}`}>Show on the Display Network</span>
            <span className={`block text-[12px] ${textMuted} mt-0.5`}>
              Off by default — Search only reaches people actively searching.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] px-4 py-3">
          <input
            type="checkbox"
            checked={draft.searchPartners}
            onChange={(e) => draft.setSearchPartners(e.target.checked)}
            className="w-4 h-4 rounded accent-[#595DD2] mt-0.5 shrink-0"
          />
          <span className={`text-[13px] ${textSecondary}`}>
            <span className={`font-semibold ${textPrimary}`}>Include Search Partners</span>
            <span className={`block text-[12px] ${textMuted} mt-0.5`}>
              On by default — shows your ads on partner sites in the Search Network.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] px-4 py-3">
          <input
            type="checkbox"
            checked={draft.presenceOnly}
            onChange={(e) => draft.setPresenceOnly(e.target.checked)}
            className="w-4 h-4 rounded accent-[#595DD2] mt-0.5 shrink-0"
          />
          <span className={`text-[13px] ${textSecondary}`}>
            <span className={`font-semibold ${textPrimary}`}>Only people in your locations</span>
            <span className={`block text-[12px] ${textMuted} mt-0.5`}>
              On by default — turning it off also reaches people searching about or interested in your
              locations.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

export function BiddingStep({ draft }: { draft: CampaignDraft }) {
  return (
    <div>
      <div className={stepTitle}>How should Google bid?</div>
      <p className={stepSub}>Manual bids give you control, automated strategies optimise for you.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <BiddingStrategyFields
          strategy={draft.biddingStrategy}
          onStrategyChange={draft.setBiddingStrategy}
          cpcBidCeiling={draft.cpcBidCeiling}
          onCpcBidCeilingChange={draft.setCpcBidCeiling}
          targetCpa={draft.targetCpa}
          onTargetCpaChange={draft.setTargetCpa}
          targetRoas={draft.targetRoas}
          onTargetRoasChange={draft.setTargetRoas}
        />
      </div>
      <p className={`text-[12px] ${textMuted} mt-4 rounded-xl bg-[#fafbfc] dark:bg-white/[0.03] px-4 py-3`}>
        {STRATEGY_DESCRIPTIONS[draft.biddingStrategy]}
        {draft.manualBids && " You set the default bid per ad group in the next step."}
      </p>
    </div>
  );
}

export function AdGroupsStep({ draft }: { draft: CampaignDraft }) {
  return (
    <div>
      <div className={stepTitle}>Ad groups and keywords</div>
      <p className={stepSub}>Group similar keywords together — each group gets its own default bid.</p>
      <div className="space-y-4 mt-5">
        {draft.adGroups.map((g, i) => (
          <div key={g.key} className="border border-[#eef0f3] dark:border-[#2a2f3d] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className={`text-[13px] font-semibold ${textPrimary}`}>Ad Group {i + 1}</div>
              {draft.adGroups.length > 1 && (
                <button
                  type="button"
                  onClick={() => draft.removeAdGroup(g.key)}
                  className={`inline-flex items-center gap-1 text-[12px] font-medium ${textMuted} hover:text-red-500 transition-colors`}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  className={inputCls}
                  value={g.name}
                  onChange={(e) => draft.patchAdGroup(g.key, { name: e.target.value })}
                  placeholder="Brand Exact"
                />
              </Field>
              <Field label="Default bid">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={g.defaultBid}
                  onChange={(e) => draft.patchAdGroup(g.key, { defaultBid: e.target.value })}
                  placeholder="1.50"
                />
              </Field>
            </div>
            <div className={`text-[12px] font-medium ${textPrimary} mt-3 mb-2`}>
              Keywords <span className={`font-normal ${textMuted}`}>(at least one per ad group)</span>
            </div>
            {g.keywords.length > 0 && (
              <div className="space-y-2 mb-2">
                {g.keywords.map((k) => (
                  <div key={k.key} className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_110px_90px_28px] sm:items-center">
                    <input
                      className={inputCls}
                      value={k.text}
                      onChange={(e) => draft.patchKeyword(g.key, k.key, { text: e.target.value })}
                      placeholder="habit tracker app"
                    />
                    <select
                      className={inputCls}
                      value={k.matchType}
                      onChange={(e) =>
                        draft.patchKeyword(g.key, k.key, { matchType: e.target.value as GoogleMatchType })
                      }
                    >
                      <option value="EXACT">Exact</option>
                      <option value="PHRASE">Phrase</option>
                      <option value="BROAD">Broad</option>
                    </select>
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={k.bid}
                      onChange={(e) => draft.patchKeyword(g.key, k.key, { bid: e.target.value })}
                      placeholder="Bid"
                      title="Keyword bid"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        draft.patchAdGroup(g.key, { keywords: g.keywords.filter((x) => x.key !== k.key) })
                      }
                      aria-label="Remove keyword"
                      className={`w-7 h-7 flex items-center justify-center rounded-lg self-end sm:self-auto ${textMuted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => draft.patchAdGroup(g.key, { keywords: [...g.keywords, newKeyword()] })}
              className={btnSecSm}
            >
              <Plus className="w-3.5 h-3.5" /> Keyword
            </button>
            <div className={`text-[12px] font-medium ${textPrimary} mt-3 mb-2`}>
              Negative keywords{" "}
              <span className={`font-normal ${textMuted}`}>(optional — apply to this ad group only)</span>
            </div>
            <GoogleNegativeKeywordDraftEditor
              items={g.negatives}
              onChange={(negatives) => draft.patchAdGroup(g.key, { negatives })}
            />
          </div>
        ))}
      </div>
      <button type="button" onClick={draft.addAdGroup} className={`${btnSecondary} mt-4`}>
        <Plus className="w-3.5 h-3.5" /> Ad Group
      </button>
      <div className="mt-6">
        <div className={fieldTitle}>
          Campaign negative keywords{" "}
          <span className={`font-normal ${textMuted}`}>(optional — apply to the whole campaign)</span>
        </div>
        <GoogleNegativeKeywordDraftEditor
          items={draft.campaignNegatives}
          onChange={draft.setCampaignNegatives}
        />
      </div>
    </div>
  );
}

export function ExtrasStep({ draft }: { draft: CampaignDraft }) {
  return (
    <div>
      <div className={stepTitle}>Extras — all optional</div>
      <p className={stepSub}>Skip anything you don't need. You can add it later in Google Ads.</p>
      <div className="space-y-6 mt-5">
        <div>
          <div className={blockTitle}>
            Ad schedule <span className={`font-normal ${textMuted}`}>(runs all the time if empty)</span>
          </div>
          <AdScheduleEditor items={draft.adSchedule} onChange={draft.setAdSchedule} />
        </div>

        <div>
          <div className={blockTitle}>Device bid adjustments</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <DeviceBidAdjustmentsFields value={draft.deviceBidAdjustments} onChange={draft.setDeviceBidAdjustments} />
          </div>
        </div>

        <div>
          <div className={blockTitle}>
            Sitelinks <span className={`font-normal ${textMuted}`}>(optional)</span>
          </div>
          <SitelinksEditor items={draft.sitelinks} onChange={draft.setSitelinks} />
        </div>

        <div>
          <div className={blockTitle}>
            Callouts <span className={`font-normal ${textMuted}`}>(optional)</span>
          </div>
          <CalloutsEditor items={draft.callouts} onChange={draft.setCallouts} />
        </div>

        <div>
          <div className={blockTitle}>
            Structured snippets <span className={`font-normal ${textMuted}`}>(optional)</span>
          </div>
          <StructuredSnippetsEditor items={draft.structuredSnippets} onChange={draft.setStructuredSnippets} />
        </div>

        <div>
          <div className={blockTitle}>
            Call extensions <span className={`font-normal ${textMuted}`}>(optional)</span>
          </div>
          <CallsEditor items={draft.calls} onChange={draft.setCalls} />
        </div>
      </div>
    </div>
  );
}
