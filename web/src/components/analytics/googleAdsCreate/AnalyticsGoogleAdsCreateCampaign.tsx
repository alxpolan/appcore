import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  ClipboardList,
  Layers,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { apiPost } from "../../../hooks/useApi";
import { borderDefault, btnPrimary, btnSecondary, textMuted, textPrimary, textSecondary } from "../../../styles";
import { AdGroupsStep, BasicsStep, BiddingStep, ExtrasStep } from "./CreateSteps";
import { ReviewStep } from "./ReviewStep";
import { useCampaignDraft } from "./useCampaignDraft";
import { STEP_VALIDATORS } from "./validation";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const STEPS = [
  { label: "Basics", icon: ClipboardList },
  { label: "Bidding", icon: Target },
  { label: "Ad groups", icon: Layers },
  { label: "Extras", icon: Sparkles },
  { label: "Review", icon: ClipboardCheck },
];

const LAST_STEP = STEPS.length - 1;

export default function AnalyticsGoogleAdsCreateCampaign({ onClose, onCreated }: Props) {
  const draft = useCampaignDraft();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const goTo = (next: number) => {
    if (creating || next > reached) return;
    setStep(next);
    setError(null);

    contentRef.current?.scrollTo({ top: 0 });
  };

  const next = () => {
    const stepError = STEP_VALIDATORS[step](draft);
    if (stepError) {
      setError(stepError);

      return;
    }
    setError(null);
    setReached((r) => Math.max(r, step + 1));
    setStep(step + 1);

    contentRef.current?.scrollTo({ top: 0 });
  };

  const back = () => {
    if (step === 0) {
      onClose();

      return;
    }
    goTo(step - 1);
  };

  const submit = async () => {
    setError(null);
    const blockingError = STEP_VALIDATORS.map((validate) => validate(draft)).find(Boolean);
    if (blockingError) {
      setError(blockingError);

      return;
    }

    setCreating(true);
    try {
      await apiPost("/google-ads/campaigns", {
        name: draft.name.trim(),
        dailyBudgetAmount: Number(draft.dailyBudget),
        status: draft.startPaused ? "PAUSED" : "ENABLED",
        displayNetworkEnabled: draft.displayNetwork,
        searchPartnersEnabled: draft.searchPartners,
        presenceOnlyTargeting: draft.presenceOnly,
        biddingStrategy: draft.biddingStrategy,
        ...(draft.startDate ? { startDate: draft.startDate } : {}),
        ...(draft.endDate ? { endDate: draft.endDate } : {}),
        ...(draft.cpcBidCeiling && Number(draft.cpcBidCeiling) > 0
          ? { cpcBidCeiling: Number(draft.cpcBidCeiling) }
          : {}),
        ...(draft.biddingStrategy === "TARGET_CPA" ||
        (draft.biddingStrategy === "MAXIMIZE_CONVERSIONS" && draft.targetCpa)
          ? { targetCpa: Number(draft.targetCpa) }
          : {}),
        ...(draft.biddingStrategy === "TARGET_ROAS" ? { targetRoas: Number(draft.targetRoas) } : {}),
        ...(draft.adSchedule.length > 0
          ? {
              adSchedule: draft.adSchedule.map((s) => ({
                dayOfWeek: s.dayOfWeek,
                startHour: Number(s.startHour),
                endHour: Number(s.endHour),
              })),
            }
          : {}),
        ...(draft.deviceBidAdjustments.mobile ||
        draft.deviceBidAdjustments.desktop ||
        draft.deviceBidAdjustments.tablet
          ? {
              deviceBidAdjustments: {
                ...(draft.deviceBidAdjustments.mobile ? { mobile: Number(draft.deviceBidAdjustments.mobile) } : {}),
                ...(draft.deviceBidAdjustments.desktop
                  ? { desktop: Number(draft.deviceBidAdjustments.desktop) }
                  : {}),
                ...(draft.deviceBidAdjustments.tablet ? { tablet: Number(draft.deviceBidAdjustments.tablet) } : {}),
              },
            }
          : {}),
        ...(draft.sitelinks.length > 0
          ? {
              sitelinks: draft.sitelinks.map((s) => ({
                linkText: s.linkText.trim(),
                finalUrl: s.finalUrl.trim(),
                ...(s.description1.trim() ? { description1: s.description1.trim() } : {}),
                ...(s.description2.trim() ? { description2: s.description2.trim() } : {}),
              })),
            }
          : {}),
        ...(draft.callouts.length > 0 ? { callouts: draft.callouts.map((c) => c.trim()) } : {}),
        ...(draft.structuredSnippets.length > 0
          ? {
              structuredSnippets: draft.structuredSnippets.map((s) => ({
                header: s.header.trim(),
                values: s.valuesText
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })),
            }
          : {}),
        ...(draft.calls.length > 0
          ? {
              calls: draft.calls.map((c) => ({ phoneNumber: c.phoneNumber.trim(), countryCode: c.countryCode })),
            }
          : {}),
        negativeKeywords: draft.campaignNegatives.map((k) => ({ text: k.text.trim(), matchType: k.matchType })),
        adGroups: draft.adGroups.map((g) => ({
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

  const onLastStep = step === LAST_STEP;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-start justify-center sm:pt-10 sm:pb-10">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={creating ? undefined : onClose} />
      <div
        className={`relative w-full max-w-2xl max-h-[92vh] sm:max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className={`flex items-center justify-between pl-4 sm:pl-6 pr-3 sm:pr-4 pt-4 pb-3 shrink-0`}>
          <div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>New campaign</h2>
            <p className={`text-[12px] ${textMuted} sm:hidden`}>
              Step {step + 1} of {STEPS.length} · {STEPS[step].label}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="hidden sm:flex items-center px-6 pb-4 shrink-0">
          {STEPS.map((s, i) => {
            const done = i < step || i < reached;
            const current = i === step;
            const reachable = i <= reached;

            return (
              <div key={s.label} className={`flex items-center ${i < LAST_STEP ? "flex-1" : ""}`}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  disabled={!reachable || creating}
                  className={`flex items-center gap-2 ${reachable && !creating ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors ${
                      done
                        ? "bg-emerald-500 text-white"
                        : current
                          ? "bg-[#595DD2] text-white"
                          : "bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-[#5c6478]"
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span
                    className={`text-[12px] font-semibold whitespace-nowrap ${
                      current ? textPrimary : textMuted
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
                {i < LAST_STEP && <div className="flex-1 h-px bg-gray-200 dark:bg-white/10 mx-3 min-w-4" />}
              </div>
            );
          })}
        </div>

        <div className="flex sm:hidden items-center gap-1.5 px-4 pb-3 shrink-0">
          {STEPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => goTo(i)}
              disabled={i > reached || creating}
              aria-label={s.label}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < step ? "bg-emerald-500" : i === step ? "bg-[#595DD2]" : "bg-gray-200 dark:bg-white/10"
              }`}
            />
          ))}
        </div>

        <div ref={contentRef} className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto flex-1 min-h-0">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl text-[13px] font-medium bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          {step === 0 && <BasicsStep draft={draft} />}
          {step === 1 && <BiddingStep draft={draft} />}
          {step === 2 && <AdGroupsStep draft={draft} />}
          {step === 3 && <ExtrasStep draft={draft} />}
          {step === 4 && <ReviewStep draft={draft} onEdit={goTo} />}
        </div>

        <div className={`flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t ${borderDefault} shrink-0`}>
          <div className={`text-[12px] ${textMuted} mr-auto hidden md:block`}>
            {draft.adGroups.length} ad group{draft.adGroups.length === 1 ? "" : "s"} · {draft.keywordCount} keyword
            {draft.keywordCount === 1 ? "" : "s"} · {draft.negativeCount} negative
            {draft.negativeCount === 1 ? "" : "s"}
          </div>
          <button onClick={back} disabled={creating} className={`${btnSecondary} mr-auto md:mr-0`}>
            {step === 0 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </>
            )}
          </button>
          {!onLastStep ? (
            <button onClick={next} disabled={creating} className={btnPrimary}>
              Continue <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={submit} disabled={creating} className={btnPrimary}>
              {creating ? "Creating…" : "Create campaign"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
