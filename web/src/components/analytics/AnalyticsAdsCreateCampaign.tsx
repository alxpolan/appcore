import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { apiPost, useApi } from "../../hooks/useApi";
import type { AppleAdsAppsResponse } from "../../types";
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
import { NegativeKeywordDraftEditor, type NegativeDraft } from "./AppleAdsNegativeKeywords";

interface Props {
  defaultCurrency: string;
  onClose: () => void;
  onCreated: () => void;
}

const PLACEMENTS = [
  { value: "APPSTORE_SEARCH_RESULTS", label: "Search Results" },
  { value: "APPSTORE_SEARCH_TAB", label: "Search Tab" },
  { value: "APPSTORE_TODAY_TAB", label: "Today Tab" },
  { value: "APPSTORE_PRODUCT_PAGE", label: "Product Pages" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK", "PLN", "BRL", "MXN", "KRW"];

const MANUAL_APP = "__manual__";

interface KeywordDraft {
  key: number;
  text: string;
  matchType: "EXACT" | "BROAD";
  bid: string;
}

interface AdGroupDraft {
  key: number;
  name: string;
  defaultBid: string;
  cpaGoal: string;
  keywords: KeywordDraft[];
  negatives: NegativeDraft[];
}

let nextKey = 1;
const newKeyword = (): KeywordDraft => ({ key: nextKey++, text: "", matchType: "EXACT", bid: "" });
const newAdGroup = (): AdGroupDraft => ({ key: nextKey++, name: "", defaultBid: "", cpaGoal: "", keywords: [], negatives: [] });

const sectionTitle = `text-[13px] font-semibold ${textPrimary} mb-3`;

export default function AnalyticsAdsCreateCampaign({ defaultCurrency, onClose, onCreated }: Props) {
  const { data: appsData, loading: appsLoading } = useApi<AppleAdsAppsResponse>("/apple-ads/apps", [], true);
  const apps = appsData?.apps ?? [];

  const [name, setName] = useState("");
  const [adamId, setAdamId] = useState("");
  const [manualAdamId, setManualAdamId] = useState("");
  const [countries, setCountries] = useState("US");
  const [dailyBudget, setDailyBudget] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [placements, setPlacements] = useState<string[]>(["APPSTORE_SEARCH_RESULTS"]);
  const [pricingModel, setPricingModel] = useState<"CPC" | "CPM">("CPC");
  const [startDate, setStartDate] = useState("");
  const [startPaused, setStartPaused] = useState(true);
  const [campaignNegatives, setCampaignNegatives] = useState<NegativeDraft[]>([]);
  const [adGroups, setAdGroups] = useState<AdGroupDraft[]>([newAdGroup()]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const keywordCount = useMemo(() => adGroups.reduce((n, g) => n + g.keywords.length, 0), [adGroups]);
  const negativeCount = useMemo(
    () => campaignNegatives.length + adGroups.reduce((n, g) => n + g.negatives.length, 0),
    [campaignNegatives, adGroups],
  );
  const effectiveAdamId = adamId === MANUAL_APP ? manualAdamId.trim() : adamId;

  const togglePlacement = (value: string) =>
    setPlacements((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value]));

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
    if (!effectiveAdamId) return setError("Please pick the advertised app.");
    if (!/^\d+$/.test(effectiveAdamId)) return setError("The App Store app ID (adamId) must be numeric.");
    if (countries.split(",").map((c) => c.trim()).filter(Boolean).length === 0)
      return setError("Please enter at least one country code (e.g. US, DE).");
    if (!(Number(dailyBudget) > 0)) return setError("Please enter a daily budget greater than 0.");
    if (placements.length === 0) return setError("Please pick at least one placement.");
    if (campaignNegatives.some((k) => !k.text.trim()))
      return setError("A campaign negative keyword has no text.");
    for (const [i, g] of adGroups.entries()) {
      if (!g.name.trim()) return setError(`Ad group ${i + 1} needs a name.`);
      if (!(Number(g.defaultBid) > 0)) return setError(`Ad group "${g.name || i + 1}" needs a default bid greater than 0.`);
      for (const k of g.keywords) {
        if (!k.text.trim()) return setError(`Ad group "${g.name || i + 1}" has a keyword without text.`);
      }
      if (g.negatives.some((k) => !k.text.trim()))
        return setError(`Ad group "${g.name || i + 1}" has a negative keyword without text.`);
    }

    setCreating(true);
    try {
      await apiPost("/apple-ads/campaigns", {
        name: name.trim(),
        adamId: Number(effectiveAdamId),
        countriesOrRegions: countries.split(",").map((c) => c.trim()).filter(Boolean),
        dailyBudgetAmount: Number(dailyBudget),
        ...(totalBudget.trim() ? { budgetAmount: Number(totalBudget) } : {}),
        currency,
        supplySources: placements,
        pricingModel,
        status: startPaused ? "PAUSED" : "ENABLED",
        ...(startDate ? { startTime: startDate } : {}),
        negativeKeywords: campaignNegatives.map((k) => ({ text: k.text.trim(), matchType: k.matchType })),
        adGroups: adGroups.map((g) => ({
          name: g.name.trim(),
          defaultBidAmount: Number(g.defaultBid),
          ...(g.cpaGoal.trim() ? { cpaGoal: Number(g.cpaGoal) } : {}),
          keywords: g.keywords.map((k) => ({
            text: k.text.trim(),
            matchType: k.matchType,
            ...(k.bid.trim() ? { bidAmount: Number(k.bid) } : {}),
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
            <Field label="Advertised app" fullWidth>
              <select
                className={inputCls}
                value={adamId}
                disabled={appsLoading}
                onChange={(e) => setAdamId(e.target.value)}
              >
                <option value="">{appsLoading ? "Loading apps…" : "Pick an app…"}</option>
                {apps.map((a) => (
                  <option key={a.adamId} value={a.adamId}>
                    {a.name} ({a.adamId})
                  </option>
                ))}
                <option value={MANUAL_APP}>Enter App Store ID manually…</option>
              </select>
            </Field>
            {adamId === MANUAL_APP && (
              <Field label="App Store app ID (adamId)" fullWidth>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={manualAdamId}
                  onChange={(e) => setManualAdamId(e.target.value)}
                  placeholder="123456789"
                />
              </Field>
            )}
            <Field label="Countries" hint="Two-letter codes, comma-separated.">
              <input
                className={inputCls}
                value={countries}
                onChange={(e) => setCountries(e.target.value.toUpperCase())}
                placeholder="US, DE, AT"
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
            <Field label="Daily budget">
              <input
                className={inputCls}
                inputMode="decimal"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                placeholder="50"
              />
            </Field>
            <Field label="Total budget" hint="Optional lifetime cap.">
              <input
                className={inputCls}
                inputMode="decimal"
                value={totalBudget}
                onChange={(e) => setTotalBudget(e.target.value)}
                placeholder="1000"
              />
            </Field>
            <Field label="Currency">
              <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {[...new Set([defaultCurrency, ...CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pricing" hint="Search Results use CPC; Search Tab and Today Tab need CPM.">
              <select
                className={inputCls}
                value={pricingModel}
                onChange={(e) => setPricingModel(e.target.value as "CPC" | "CPM")}
              >
                <option value="CPC">CPC — cost per tap</option>
                <option value="CPM">CPM — cost per 1k impressions</option>
              </select>
            </Field>
            <div className="col-span-2">
              <div className={`text-sm font-medium ${textPrimary} block mb-1`}>Placements</div>
              <div className="flex flex-wrap gap-2">
                {PLACEMENTS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlacement(p.value)}
                    className={`px-3 py-[7px] rounded-xl text-[13px] font-medium border transition-all ${
                      placements.includes(p.value)
                        ? "border-[#595DD2] text-[#595DD2] bg-[#595DD2]/5"
                        : `${borderDefault} ${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="col-span-2 flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={startPaused}
                onChange={(e) => setStartPaused(e.target.checked)}
                className="w-4 h-4 rounded accent-[#595DD2]"
              />
              <span className={`text-[13px] ${textSecondary}`}>
                Start paused <span className={textMuted}>(recommended — review in Search Ads before spending)</span>
              </span>
            </label>
            <div className="col-span-2">
              <div className={`text-sm font-medium ${textPrimary} block mb-1`}>
                Negative keywords{" "}
                <span className={`font-normal ${textMuted}`}>(optional — apply to the whole campaign)</span>
              </div>
              <NegativeKeywordDraftEditor items={campaignNegatives} onChange={setCampaignNegatives} />
            </div>
          </div>

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
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-3 sm:col-span-1">
                    <Field label="Name">
                      <input
                        className={inputCls}
                        value={g.name}
                        onChange={(e) => patchAdGroup(g.key, { name: e.target.value })}
                        placeholder="Brand Exact"
                      />
                    </Field>
                  </div>
                  <Field label="Default bid">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={g.defaultBid}
                      onChange={(e) => patchAdGroup(g.key, { defaultBid: e.target.value })}
                      placeholder="1.50"
                    />
                  </Field>
                  <Field label="CPA goal" hint="Optional.">
                    <input
                      className={inputCls}
                      inputMode="decimal"
                      value={g.cpaGoal}
                      onChange={(e) => patchAdGroup(g.key, { cpaGoal: e.target.value })}
                      placeholder="5.00"
                    />
                  </Field>
                </div>
                <div className={`text-[12px] font-medium ${textPrimary} mt-3 mb-2`}>
                  Keywords{" "}
                  <span className={`font-normal ${textMuted}`}>
                    (optional — only used for Search Results placements)
                  </span>
                </div>
                {g.keywords.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {g.keywords.map((k) => (
                      <div key={k.key} className="grid grid-cols-[1fr_110px_90px_28px] gap-2 items-center">
                        <input
                          className={inputCls}
                          value={k.text}
                          onChange={(e) => patchKeyword(g.key, k.key, { text: e.target.value })}
                          placeholder="meditation app"
                        />
                        <select
                          className={inputCls}
                          value={k.matchType}
                          onChange={(e) => patchKeyword(g.key, k.key, { matchType: e.target.value as "EXACT" | "BROAD" })}
                        >
                          <option value="EXACT">Exact</option>
                          <option value="BROAD">Broad</option>
                        </select>
                        <input
                          className={inputCls}
                          inputMode="decimal"
                          value={k.bid}
                          onChange={(e) => patchKeyword(g.key, k.key, { bid: e.target.value })}
                          placeholder="Bid"
                          title="Keyword bid — falls back to the ad group default bid"
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
                <NegativeKeywordDraftEditor
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
