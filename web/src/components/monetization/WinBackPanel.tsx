import { useState, useCallback, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { authHeaders } from "../../hooks/useApi";
import {
  TD,
  TH,
  badgeOutline,
  borderDefault,
  btnSecSm,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import type { SubscriptionWinBackOffer } from "../../types";

interface WinBackPanelProps {
  subscriptionId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

const DURATION_LABELS: Record<string, string> = {
  THREE_DAYS: "3 Days",
  ONE_WEEK: "1 Week",
  TWO_WEEKS: "2 Weeks",
  ONE_MONTH: "1 Month",
  TWO_MONTHS: "2 Months",
  THREE_MONTHS: "3 Months",
  SIX_MONTHS: "6 Months",
  ONE_YEAR: "1 Year",
};

const DURATIONS = Object.keys(DURATION_LABELS);

const MODE_LABELS: Record<string, string> = {
  FREE_TRIAL: "Free",
  PAY_AS_YOU_GO: "Pay As You Go",
  PAY_UP_FRONT: "Pay Up Front",
};

const MODES = Object.keys(MODE_LABELS);

const PRIORITIES = ["HIGH", "NORMAL"];

const PLAN_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  UPFRONT: "Upfront",
};

const INTENT_LABELS: Record<string, string> = {
  NOT_PROMOTED: "Not promoted",
  USE_AUTO_GENERATED_ASSETS: "Auto-generated assets",
};

function formatLength(duration: string, periods: number) {
  const label = DURATION_LABELS[duration] ?? duration;

  return periods > 1 ? `${label} × ${periods} periods` : label;
}

function formatLapsed(offer: SubscriptionWinBackOffer) {
  if (offer.customerEligibilityTimeSinceLastSubscribedMinMonths == null) return "—";

  return `lapsed ${offer.customerEligibilityTimeSinceLastSubscribedMinMonths}–${offer.customerEligibilityTimeSinceLastSubscribedMaxMonths ?? "…"} mo`;
}

export default function WinBackPanel({ subscriptionId, addToast }: WinBackPanelProps) {
  const [offers, setOffers] = useState<SubscriptionWinBackOffer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SubscriptionWinBackOffer | null>(null);
  const [referenceName, setReferenceName] = useState("");
  const [offerId, setOfferId] = useState("");
  const [offerMode, setOfferMode] = useState("PAY_AS_YOU_GO");
  const [duration, setDuration] = useState("ONE_MONTH");
  const [periods, setPeriods] = useState("1");
  const [paidMonths, setPaidMonths] = useState("1");
  const [lapsedMin, setLapsedMin] = useState("1");
  const [lapsedMax, setLapsedMax] = useState("12");
  const [waitMonths, setWaitMonths] = useState("");
  const [planType, setPlanType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState("HIGH");
  const [promotionIntent, setPromotionIntent] = useState("");
  const [priceIds, setPriceIds] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}/win-back-offers`, {
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setOffers(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [subscriptionId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditing(null);
    setReferenceName("");
    setOfferId("");
    setOfferMode("PAY_AS_YOU_GO");
    setDuration("ONE_MONTH");
    setPeriods("1");
    setPaidMonths("1");
    setLapsedMin("1");
    setLapsedMax("12");
    setWaitMonths("");
    setPlanType("");
    setStartDate("");
    setEndDate("");
    setPriority("HIGH");
    setPromotionIntent("");
    setPriceIds("");
    setShowForm(true);
  };

  const openEdit = (offer: SubscriptionWinBackOffer) => {
    setEditing(offer);
    setReferenceName(offer.referenceName);
    setOfferId(offer.offerId);
    setOfferMode(offer.offerMode);
    setDuration(offer.duration);
    setPeriods(String(offer.periodCount));
    setPaidMonths(String(offer.customerEligibilityPaidSubscriptionDurationInMonths));
    setLapsedMin(offer.customerEligibilityTimeSinceLastSubscribedMinMonths?.toString() ?? "");
    setLapsedMax(offer.customerEligibilityTimeSinceLastSubscribedMaxMonths?.toString() ?? "");
    setWaitMonths(offer.customerEligibilityWaitBetweenOffersInMonths?.toString() ?? "");
    setPlanType(offer.targetSubscriptionPlanType ?? "");
    setStartDate(offer.startDate ?? "");
    setEndDate(offer.endDate ?? "");
    setPriority(offer.priority ?? "HIGH");
    setPromotionIntent(offer.promotionIntent ?? "");
    setPriceIds(offer.priceIds.join(", "));
    setShowForm(true);
  };

  const optionalMonths = (raw: string) => {
    const trimmed = raw.trim();

    return trimmed ? parseInt(trimmed) : null;
  };

  const save = async () => {
    const ids = priceIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/asc/subscriptions/win-back-offers/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            customerEligibilityPaidSubscriptionDurationInMonths: parseInt(paidMonths) || 1,
            customerEligibilityTimeSinceLastSubscribedMinMonths: optionalMonths(lapsedMin),
            customerEligibilityTimeSinceLastSubscribedMaxMonths: optionalMonths(lapsedMax),
            customerEligibilityWaitBetweenOffersInMonths: optionalMonths(waitMonths),
            startDate: startDate.trim() || null,
            endDate: endDate.trim() || null,
            priority,
            promotionIntent: promotionIntent || null,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      } else {
        const res = await fetch("/api/asc/subscriptions/win-back-offers", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            subscriptionId,
            referenceName: referenceName.trim(),
            offerId: offerId.trim(),
            offerMode,
            duration,
            periodCount: parseInt(periods) || 1,
            customerEligibilityPaidSubscriptionDurationInMonths: parseInt(paidMonths) || 1,
            customerEligibilityTimeSinceLastSubscribedMinMonths: parseInt(lapsedMin) || 1,
            customerEligibilityTimeSinceLastSubscribedMaxMonths: parseInt(lapsedMax) || 1,
            ...(waitMonths.trim() ? { customerEligibilityWaitBetweenOffersInMonths: parseInt(waitMonths) } : {}),
            ...(planType ? { targetSubscriptionPlanType: planType } : {}),
            startDate: startDate.trim(),
            ...(endDate.trim() ? { endDate: endDate.trim() } : {}),
            priority,
            ...(promotionIntent ? { promotionIntent } : {}),
            priceIds: ids,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setShowForm(false);
      setEditing(null);
      await load();
      addToast(editing ? "Win-back offer updated" : "Win-back offer created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this win-back offer?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/subscriptions/win-back-offers/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setOffers((list) => list?.filter((offer) => offer.id !== id) ?? null);
      addToast("Win-back offer removed", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !offers) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
      >
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Win-Back Offers</span>
        {!showForm && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {(!offers || offers.length === 0) && !showForm ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>
          No win-back offers configured. Former subscribers come back at full price.
        </p>
      ) : (
        offers &&
        offers.length > 0 && (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Offer</th>
                <th className={TH}>Length</th>
                <th className={TH}>Eligibility</th>
                <th className={TH}>Active</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr
                  key={offer.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={TD}>
                    <div className="flex flex-col gap-1">
                      <span className={`font-medium ${textPrimary}`}>{offer.referenceName}</span>
                      <span>
                        <span className={badgeOutline("info_tonal")}>
                          {MODE_LABELS[offer.offerMode] ?? offer.offerMode}
                        </span>
                      </span>
                      <span className={`font-mono text-[11px] ${textSecondary}`}>{offer.offerId}</span>
                    </div>
                  </td>
                  <td className={`${TD} font-medium ${textPrimary}`}>
                    {formatLength(offer.duration, offer.periodCount)}
                  </td>
                  <td className={`${TD} ${textSecondary}`}>{formatLapsed(offer)}</td>
                  <td className={`${TD} ${textSecondary}`}>{offer.startDate ?? "—"}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(offer)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => remove(offer.id)}
                        disabled={deletingId === offer.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                      >
                        {deletingId === offer.id ? (
                          <div className="spinner !w-3 !h-3" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {showForm && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>
            {editing ? "Edit Win-Back Offer" : "Add Win-Back Offer"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Reference name</label>
              <input
                className={inputCls}
                value={referenceName}
                onChange={(e) => setReferenceName(e.target.value)}
                placeholder="Come back 50%"
                disabled={editing != null}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Offer ID</label>
              <input
                className={inputCls}
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                placeholder="winback_50"
                disabled={editing != null}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Mode</label>
              <select
                className={inputCls}
                value={offerMode}
                onChange={(e) => setOfferMode(e.target.value)}
                disabled={editing != null}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Duration</label>
              <select
                className={inputCls}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={editing != null}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {DURATION_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Periods</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={periods}
                onChange={(e) => setPeriods(e.target.value)}
                disabled={editing != null}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Paid months required</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={paidMonths}
                onChange={(e) => setPaidMonths(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Lapsed min (mo)</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={lapsedMin}
                onChange={(e) => setLapsedMin(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Lapsed max (mo)</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={lapsedMax}
                onChange={(e) => setLapsedMax(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Wait between offers (mo)</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={waitMonths}
                onChange={(e) => setWaitMonths(e.target.value)}
                placeholder="No wait"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Start date</label>
              <input
                className={inputCls}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>End date (optional)</label>
              <input
                className={inputCls}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Priority</label>
              <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Plan type (optional)</label>
              <select
                className={inputCls}
                value={planType}
                onChange={(e) => setPlanType(e.target.value)}
                disabled={editing != null}
              >
                <option value="">Any</option>
                {Object.entries(PLAN_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Promotion (optional)</label>
              <select
                className={inputCls}
                value={promotionIntent}
                onChange={(e) => setPromotionIntent(e.target.value)}
              >
                <option value="">Default</option>
                {Object.entries(INTENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Price IDs (comma separated)</label>
              <input
                className={inputCls}
                value={priceIds}
                onChange={(e) => setPriceIds(e.target.value)}
                placeholder="price1, price2"
                disabled={editing != null}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className={btnSecSm}
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button onClick={save} disabled={saving} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              {editing ? "Save Offer" : "Create Offer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
