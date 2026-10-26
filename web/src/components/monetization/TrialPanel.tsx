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
import type { SubscriptionIntroductoryOffer } from "../../types";
import { territoryFlagSrc } from "../../utils/territoryFlags";

interface TrialPanelProps {
  subscriptionId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

const DURATION_LABELS: Record<string, string> = {
  ONE_DAY: "1 Day",
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
  FREE_TRIAL: "Free Trial",
  PAY_AS_YOU_GO: "Pay As You Go",
  PAY_UP_FRONT: "Pay Up Front",
};

function formatLength(duration: string, periods: number) {
  const label = DURATION_LABELS[duration] ?? duration;

  return periods > 1 ? `${label} × ${periods} periods` : label;
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "Always";

  const left = start ? new Date(start).toLocaleDateString() : "…";
  const right = end ? new Date(end).toLocaleDateString() : "…";

  return `${left} – ${right}`;
}

function TerritoryCell({ territory }: { territory: string | null }) {
  if (!territory) {
    return <span className={textSecondary}>All territories</span>;
  }

  return (
    <span className="flex items-center gap-1.5">
      {territoryFlagSrc(territory) != null && (
        <img
          src={territoryFlagSrc(territory)!}
          alt=""
          width={20}
          height={15}
          className="h-[14px] w-[19px] object-contain shrink-0 rounded-xs"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {territory}
    </span>
  );
}

export default function TrialPanel({ subscriptionId, addToast }: TrialPanelProps) {
  const [offers, setOffers] = useState<SubscriptionIntroductoryOffer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [duration, setDuration] = useState("ONE_WEEK");
  const [periods, setPeriods] = useState("1");
  const [territory, setTerritory] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}/introductory-offers`, {
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
    setEditingId(null);
    setDuration("ONE_WEEK");
    setPeriods("1");
    setTerritory("");
    setShowForm(true);
  };

  const openEdit = (offer: SubscriptionIntroductoryOffer) => {
    setEditingId(offer.id);
    setDuration(offer.duration);
    setPeriods(String(offer.numberOfPeriods));
    setTerritory(offer.territory ?? "");
    setShowForm(true);
  };

  const save = async () => {
    const count = parseInt(periods) || 1;
    setSaving(true);
    try {
      if (editingId) {
        const del = await fetch(`/api/asc/subscriptions/introductory-offers/${editingId}`, {
          method: "DELETE",
          headers: authHeaders(),
        });

        if (!del.ok) throw new Error((await del.json()).error ?? `HTTP ${del.status}`);
      }

      const res = await fetch("/api/asc/subscriptions/introductory-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          subscriptionId,
          offerMode: "FREE_TRIAL",
          duration,
          numberOfPeriods: count,
          territory: territory.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setShowForm(false);
      setEditingId(null);
      await load();
      addToast(editingId ? "Free trial updated" : "Free trial enabled", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this introductory offer?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/subscriptions/introductory-offers/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setOffers((list) => list?.filter((offer) => offer.id !== id) ?? null);
      addToast("Introductory offer removed", "success");
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
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Free Trial</span>
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
          No free trial configured. New subscribers start paying immediately.
        </p>
      ) : (
        offers &&
        offers.length > 0 && (
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Offer</th>
                <th className={TH}>Length</th>
                <th className={TH}>Territory</th>
                <th className={TH}>Availability</th>
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
                    <span className={badgeOutline(offer.offerMode === "FREE_TRIAL" ? "success_tonal" : "info_tonal")}>
                      {MODE_LABELS[offer.offerMode] ?? offer.offerMode}
                    </span>
                  </td>
                  <td className={`${TD} font-medium ${textPrimary}`}>
                    {formatLength(offer.duration, offer.numberOfPeriods)}
                  </td>
                  <td className={`${TD} font-mono font-medium ${textPrimary}`}>
                    <TerritoryCell territory={offer.territory} />
                  </td>
                  <td className={`${TD} ${textSecondary}`}>{formatDateRange(offer.startDate, offer.endDate)}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {offer.offerMode === "FREE_TRIAL" && (
                        <button
                          onClick={() => openEdit(offer)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
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
            {editingId ? "Edit Free Trial" : "Add Free Trial"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Duration</label>
              <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
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
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Territory (optional)</label>
              <input
                className={inputCls}
                value={territory}
                onChange={(e) => setTerritory(e.target.value.toUpperCase())}
                placeholder="All territories"
                maxLength={3}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className={btnSecSm}
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button onClick={save} disabled={saving} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              {editingId ? "Save Trial" : "Enable Trial"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
