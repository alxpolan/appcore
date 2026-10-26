import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import {
  borderDefault,
  btnPrimary,
  btnSecSm,
  btnSecondary,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import Field from "../settings/Field";
import {
  GoogleNegativeKeywordDraftEditor,
  type GoogleMatchType,
  type GoogleNegativeDraft,
} from "./GoogleAdsNegativeKeywords";
import {
  AdScheduleEditor,
  BiddingStrategyFields,
  CalloutsEditor,
  CallsEditor,
  DeviceBidAdjustmentsFields,
  SitelinksEditor,
  StructuredSnippetsEditor,
  type AdScheduleDraft,
  type CallDraft,
  type DeviceBidAdjustmentsDraft,
  type GoogleAdsBiddingStrategy,
  type SitelinkDraft,
  type StructuredSnippetDraft,
} from "./GoogleAdsCampaignAdvancedFields";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface KeywordDraft {
  key: number;
  text: string;
  matchType: GoogleMatchType;
  bid: string;
}

interface AdGroupDraft {
  key: number;
  name: string;
  defaultBid: string;
  keywords: KeywordDraft[];
  negatives: GoogleNegativeDraft[];
}

let nextKey = 1;
const newKeyword = (): KeywordDraft => ({ key: nextKey++, text: "", matchType: "EXACT", bid: "" });
const newAdGroup = (): AdGroupDraft => ({
  key: nextKey++,
  name: "",
  defaultBid: "",
  keywords: [newKeyword()],
  negatives: [],
});

const sectionTitle = `text-[13px] font-semibold ${textPrimary} mb-3`;

export default function AnalyticsGoogleAdsCreateCampaign({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startPaused, setStartPaused] = useState(true);
  const [campaignNegatives, setCampaignNegatives] = useState<GoogleNegativeDraft[]>([]);
  const [adGroups, setAdGroups] = useState<AdGroupDraft[]>([newAdGroup()]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [biddingStrategy, setBiddingStrategy] = useState<GoogleAdsBiddingStrategy>("MANUAL_CPC");
  const [cpcBidCeiling, setCpcBidCeiling] = useState("");
  const [targetCpa, setTargetCpa] = useState("");
  const [targetRoas, setTargetRoas] = useState("");
  const [deviceBidAdjustments, setDeviceBidAdjustments] = useState<DeviceBidAdjustmentsDraft>({
    mobile: "",
    desktop: "",
    tablet: "",
  });
  const [adSchedule, setAdSchedule] = useState<AdScheduleDraft[]>([]);
  const [sitelinks, setSitelinks] = useState<SitelinkDraft[]>([]);
  const [callouts, setCallouts] = useState<string[]>([]);
  const [structuredSnippets, setStructuredSnippets] = useState<StructuredSnippetDraft[]>([]);
  const [calls, setCalls] = useState<CallDraft[]>([]);

  const manualBids = biddingStrategy === "MANUAL_CPC";

  const keywordCount = useMemo(() => adGroups.reduce((n, g) => n + g.keywords.length, 0), [adGroups]);
  const negativeCount = useMemo(
    () => campaignNegatives.length + adGroups.reduce((n, g) => n + g.negatives.length, 0),
    [campaignNegatives, adGroups],
  );

  const patchAdGroup = (key: number, patch: Partial<AdGroupDraft>) =>
    setAdGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const patchKeyword = (gKey: number, kKey: number, patch: Partial<KeywordDraft>) =>
    setAdGroups((gs) =>
      gs.map((g) =>
        g.key === gKey ? { ...g, keywords: g.keywords.map((k) => (k.key === kKey ? { ...k, ...patch } : k)) } : g,
      ),
    );

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Please enter a campaign name.");
    if (!(Number(dailyBudget) > 0)) return setError("Please enter a daily budget greater than 0.");
    if (campaignNegatives.some((k) => !k.text.trim()))
      return setError("A campaign negative keyword has no text.");
    for (const [i, g] of adGroups.entries()) {
      if (!g.name.trim()) return setError(`Ad group ${i + 1} needs a name.`);
      if (manualBids && !(Number(g.defaultBid) > 0))
        return setError(`Ad group "${g.name || i + 1}" needs a default bid greater than 0.`);
      if (g.keywords.length === 0) return setError(`Ad group "${g.name || i + 1}" needs at least one keyword.`);
      for (const k of g.keywords) {
        if (!k.text.trim()) return setError(`Ad group "${g.name || i + 1}" has a keyword without text.`);
        if (manualBids && !(Number(k.bid) > 0))
          return setError(`Keyword "${k.text || "?"}" in ad group "${g.name || i + 1}" needs a bid greater than 0.`);
      }
      if (g.negatives.some((k) => !k.text.trim()))
        return setError(`Ad group "${g.name || i + 1}" has a negative keyword without text.`);
    }
    if (biddingStrategy === "TARGET_CPA" && !(Number(targetCpa) > 0))
      return setError("Target CPA is required for the TARGET_CPA strategy.");
    if (biddingStrategy === "TARGET_ROAS" && !(Number(targetRoas) > 0))
      return setError("Target ROAS is required for the TARGET_ROAS strategy.");
    for (const [i, s] of adSchedule.entries()) {
      const startHour = Number(s.startHour);
      const endHour = Number(s.endHour);

      if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || endHour <= startHour)
        return setError(`Ad schedule window ${i + 1} needs a valid hour range.`);
    }
    for (const [i, s] of sitelinks.entries()) {
      if (!s.linkText.trim() || !s.finalUrl.trim()) return setError(`Sitelink ${i + 1} needs link text and a URL.`);
    }
    if (callouts.some((c) => !c.trim())) return setError("A callout has no text.");
    for (const [i, s] of structuredSnippets.entries()) {
      if (!s.header.trim() || !s.valuesText.trim())
        return setError(`Structured snippet ${i + 1} needs a header and values.`);
    }
    for (const [i, c] of calls.entries()) {
      if (!c.phoneNumber.trim() || !/^[A-Z]{2}$/.test(c.countryCode))
        return setError(`Call extension ${i + 1} needs a phone number and a 2-letter country code.`);
    }

    setCreating(true);
    try {
      await apiPost("/google-ads/campaigns", {
        name: name.trim(),
        dailyBudgetAmount: Number(dailyBudget),
        status: startPaused ? "PAUSED" : "ENABLED",
        biddingStrategy,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(cpcBidCeiling && Number(cpcBidCeiling) > 0 ? { cpcBidCeiling: Number(cpcBidCeiling) } : {}),
        ...(biddingStrategy === "TARGET_CPA" || (biddingStrategy === "MAXIMIZE_CONVERSIONS" && targetCpa)
          ? { targetCpa: Number(targetCpa) }
          : {}),
        ...(biddingStrategy === "TARGET_ROAS" ? { targetRoas: Number(targetRoas) } : {}),
        ...(adSchedule.length > 0
          ? {
              adSchedule: adSchedule.map((s) => ({
                dayOfWeek: s.dayOfWeek,
                startHour: Number(s.startHour),
                endHour: Number(s.endHour),
              })),
            }
          : {}),
        ...(deviceBidAdjustments.mobile || deviceBidAdjustments.desktop || deviceBidAdjustments.tablet
          ? {
              deviceBidAdjustments: {
                ...(deviceBidAdjustments.mobile ? { mobile: Number(deviceBidAdjustments.mobile) } : {}),
                ...(deviceBidAdjustments.desktop ? { desktop: Number(deviceBidAdjustments.desktop) } : {}),
                ...(deviceBidAdjustments.tablet ? { tablet: Number(deviceBidAdjustments.tablet) } : {}),
              },
            }
          : {}),
        ...(sitelinks.length > 0
          ? {
              sitelinks: sitelinks.map((s) => ({
                linkText: s.linkText.trim(),
                finalUrl: s.finalUrl.trim(),
                ...(s.description1.trim() ? { description1: s.description1.trim() } : {}),
                ...(s.description2.trim() ? { description2: s.description2.trim() } : {}),
              })),
            }
          : {}),
        ...(callouts.length > 0 ? { callouts: callouts.map((c) => c.trim()) } : {}),
        ...(structuredSnippets.length > 0
          ? {
              structuredSnippets: structuredSnippets.map((s) => ({
                header: s.header.trim(),
                values: s.valuesText
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })),
            }
          : {}),
        ...(calls.length > 0
          ? { calls: calls.map((c) => ({ phoneNumber: c.phoneNumber.trim(), countryCode: c.countryCode })) }
          : {}),
        negativeKeywords: campaignNegatives.map((k) => ({ text: k.text.trim(), matchType: k.matchType })),
        adGroups: adGroups.map((g) => ({
          name: g.name.trim(),
          defaultBidAmount: Number(g.defaultBid),
          keywords: g.keywords.map((k) => ({
            text: k.text.trim(),
            matchType: k.matchType,
            bidAmount: Number(k.bid),
          })),
          negativeKeywords: g.negatives.map((k) => ({ text: k.text.trim(), matchType: k.matchType })),
        })),
      });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? "Failed to create the campaign.");
    } finally {
      setCreating(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10 px-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={creating ? undefined : onClose} />
      <div
        className={`relative w-full max-w-2xl max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
          <h2 className={`text-lg font-semibold ${textPrimary}`}>New Campaign</h2>
          <button
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <div className={sectionTitle}>Campaign</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" fullWidth>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MyApp – US – Brand"
              />
            </Field>
            <Field label="Daily budget" hint="In the Google Ads account currency.">
              <input
                className={inputCls}
                inputMode="decimal"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                placeholder="50"
              />
            </Field>
            <Field label="Start date" hint="Optional — defaults to today.">
              <input
                type="date"
                className={inputCls}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="End date" hint="Optional.">
              <input
                type="date"
                className={inputCls}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
            <label className="col-span-2 flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={startPaused}
                onChange={(e) => setStartPaused(e.target.checked)}
                className="w-4 h-4 rounded accent-[#595DD2]"
              />
              <span className={`text-[13px] ${textSecondary}`}>
                Start paused <span className={textMuted}>(recommended — review in Google Ads before spending)</span>
              </span>
            </label>
            <div className="col-span-2">
              <div className={`text-sm font-medium ${textPrimary} block mb-1`}>
                Negative keywords{" "}
                <span className={`font-normal ${textMuted}`}>(optional — apply to the whole campaign)</span>
              </div>
              <GoogleNegativeKeywordDraftEditor items={campaignNegatives} onChange={setCampaignNegatives} />
            </div>
          </div>
          <p className={`text-[12px] ${textMuted} mt-4`}>
            Geo targeting and responsive search ads are managed in the Google Ads UI after creation.
          </p>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className={`flex items-center gap-1.5 text-[13px] font-semibold ${textPrimary} mt-8 mb-3`}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Advanced
          </button>
          {showAdvanced && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <BiddingStrategyFields
                  strategy={biddingStrategy}
                  onStrategyChange={setBiddingStrategy}
                  cpcBidCeiling={cpcBidCeiling}
                  onCpcBidCeilingChange={setCpcBidCeiling}
                  targetCpa={targetCpa}
                  onTargetCpaChange={setTargetCpa}
                  targetRoas={targetRoas}
                  onTargetRoasChange={setTargetRoas}
                />
              </div>

              <div>
                <div className={`text-sm font-medium ${textPrimary} mb-1`}>
                  Ad schedule <span className={`font-normal ${textMuted}`}>(optional — runs all the time if empty)</span>
                </div>
                <AdScheduleEditor items={adSchedule} onChange={setAdSchedule} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <DeviceBidAdjustmentsFields value={deviceBidAdjustments} onChange={setDeviceBidAdjustments} />
              </div>

              <div>
                <div className={`text-sm font-medium ${textPrimary} mb-1`}>
                  Sitelinks <span className={`font-normal ${textMuted}`}>(optional)</span>
                </div>
                <SitelinksEditor items={sitelinks} onChange={setSitelinks} />
              </div>

              <div>
                <div className={`text-sm font-medium ${textPrimary} mb-1`}>
                  Callouts <span className={`font-normal ${textMuted}`}>(optional)</span>
                </div>
                <CalloutsEditor items={callouts} onChange={setCallouts} />
              </div>

              <div>
                <div className={`text-sm font-medium ${textPrimary} mb-1`}>
                  Structured snippets <span className={`font-normal ${textMuted}`}>(optional)</span>
                </div>
                <StructuredSnippetsEditor items={structuredSnippets} onChange={setStructuredSnippets} />
              </div>

              <div>
                <div className={`text-sm font-medium ${textPrimary} mb-1`}>
                  Call extensions <span className={`font-normal ${textMuted}`}>(optional)</span>
                </div>
                <CallsEditor items={calls} onChange={setCalls} />
              </div>
            </div>
          )}

          <div className={`${sectionTitle} mt-8`}>Ad Groups</div>
          <div className="space-y-4">
            {adGroups.map((g, i) => (
              <div key={g.key} className={`border ${borderDefault} rounded-2xl p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <div className={`text-[13px] font-semibold ${textPrimary}`}>Ad Group {i + 1}</div>
                  {adGroups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setAdGroups((gs) => gs.filter((x) => x.key !== g.key))}
                      className={`inline-flex items-center gap-1 text-[12px] font-medium ${textMuted} hover:text-red-500 transition-colors`}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name">
                    <input
                      className={inputCls}
                      value={g.name}
                      onChange={(e) => patchAdGroup(g.key, { name: e.target.value })}
                      placeholder="Brand Exact"
                    />
                  </Field>
                  <Field label="Default bid">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={g.defaultBid}
                      onChange={(e) => patchAdGroup(g.key, { defaultBid: e.target.value })}
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
                      <div key={k.key} className="grid grid-cols-[1fr_110px_90px_28px] gap-2 items-center">
                        <input
                          className={inputCls}
                          value={k.text}
                          onChange={(e) => patchKeyword(g.key, k.key, { text: e.target.value })}
                          placeholder="habit tracker app"
                        />
                        <select
                          className={inputCls}
                          value={k.matchType}
                          onChange={(e) => patchKeyword(g.key, k.key, { matchType: e.target.value as GoogleMatchType })}
                        >
                          <option value="EXACT">Exact</option>
                          <option value="PHRASE">Phrase</option>
                          <option value="BROAD">Broad</option>
                        </select>
                        <input
                          className={inputCls}
                          inputMode="decimal"
                          value={k.bid}
                          onChange={(e) => patchKeyword(g.key, k.key, { bid: e.target.value })}
                          placeholder="Bid"
                          title="Keyword bid"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patchAdGroup(g.key, { keywords: g.keywords.filter((x) => x.key !== k.key) })
                          }
                          aria-label="Remove keyword"
                          className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => patchAdGroup(g.key, { keywords: [...g.keywords, newKeyword()] })}
                  className={`${btnSecSm}`}
                >
                  <Plus className="w-3.5 h-3.5" /> Keyword
                </button>
                <div className={`text-[12px] font-medium ${textPrimary} mt-3 mb-2`}>
                  Negative keywords{" "}
                  <span className={`font-normal ${textMuted}`}>(optional — apply to this ad group only)</span>
                </div>
                <GoogleNegativeKeywordDraftEditor
                  items={g.negatives}
                  onChange={(negatives) => patchAdGroup(g.key, { negatives })}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAdGroups((gs) => [...gs, newAdGroup()])}
            className={`${btnSecondary} mt-4`}
          >
            <Plus className="w-3.5 h-3.5" /> Ad Group
          </button>

          {error && (
            <div className="mt-5 px-4 py-3 rounded-xl text-[13px] font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className={`flex items-center gap-3 px-6 py-4 border-t ${borderDefault} shrink-0`}>
          <div className={`text-[12px] ${textMuted} mr-auto`}>
            {adGroups.length} ad group{adGroups.length === 1 ? "" : "s"} · {keywordCount} keyword
            {keywordCount === 1 ? "" : "s"} · {negativeCount} negative{negativeCount === 1 ? "" : "s"}
          </div>
          <button onClick={onClose} disabled={creating} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={submit} disabled={creating} className={btnPrimary}>
            {creating ? "Creating…" : "Create campaign"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
