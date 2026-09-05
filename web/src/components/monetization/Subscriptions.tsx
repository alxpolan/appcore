import { useState, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  Check,
  Globe,
  DollarSign,
  ArrowLeft,
  MoreHorizontal,
  Paperclip,
  FileText,
  Upload,
  Sparkles,
} from "lucide-react";
import { authHeaders, getActiveBundleId } from "../../hooks/useApi";
import {
  TD,
  TH,
  badgeOutline,
  borderDefault,
  btnPrimary,
  btnSecSm,
  btnSecondary,
  cardCls,
  inputCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import type {
  SubscriptionGroup,
  SubscriptionGroupLocalization,
  SubscriptionItem,
  SubscriptionLocalization,
  SubscriptionPrice,
  SubscriptionPricePoint,
  SubscriptionReviewScreenshot,
} from "../../types";
import { territoryFlagSrc } from "../../utils/territoryFlags";
import SmartPricingModal from "./SmartPricingModal";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

const PERIOD_LABELS: Record<string, string> = {
  ONE_WEEK: "1 Week",
  ONE_MONTH: "1 Month",
  TWO_MONTHS: "2 Months",
  THREE_MONTHS: "3 Months",
  SIX_MONTHS: "6 Months",
  ONE_YEAR: "1 Year",
};

const PERIODS = Object.keys(PERIOD_LABELS);

const STATE_SHORT: Record<string, string> = {
  APPROVED: "Approved",
  READY_TO_SUBMIT: "Ready",
  MISSING_METADATA: "Missing Metadata",
  WAITING_FOR_REVIEW: "In Review Queue",
  IN_REVIEW: "In Review",
  REJECTED: "Rejected",
  DEVELOPER_ACTION_NEEDED: "Action Needed",
  DEVELOPER_REMOVED_FROM_SALE: "Removed",
  REMOVED_FROM_SALE: "Removed",
  PENDING_BINARY_APPROVAL: "Pending",
};

function StatusBadge({ state }: { state: string }) {
  const label = STATE_SHORT[state] ?? state;
  const isApproved = state === "APPROVED" || state === "READY_TO_SUBMIT";
  const isError = state === "REJECTED" || state === "DEVELOPER_ACTION_NEEDED";
  const isWarning = state === "MISSING_METADATA";
  const variant = isApproved ? "success_tonal" : isError ? "danger_tonal" : isWarning ? "warning_tonal" : "info_tonal";
  return <span className={badgeOutline(variant)}>{label}</span>;
}

interface SubFormState {
  name: string;
  productId: string;
  familySharable: boolean;
  subscriptionPeriod: string;
  reviewNote: string;
  groupLevel: string;
}

const emptySubForm = (): SubFormState => ({
  name: "",
  productId: "",
  familySharable: false,
  subscriptionPeriod: "ONE_MONTH",
  reviewNote: "",
  groupLevel: "1",
});

interface SubFormProps {
  initial?: Partial<SubFormState>;
  onSave: (v: SubFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lockProductId?: boolean;
}

function SubForm({ initial, onSave, onCancel, saving, title, lockProductId }: SubFormProps) {
  const [form, setForm] = useState<SubFormState>({
    ...emptySubForm(),
    ...initial,
  });
  const set = (k: keyof SubFormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className={`rounded-xl border ${borderDefault} bg-[#fafbfc] dark:bg-[#1c2028] p-4 flex flex-col gap-3`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Pro Monthly"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Product ID</label>
          <input
            className={inputCls}
            value={form.productId}
            onChange={(e) => set("productId", e.target.value)}
            placeholder="e.g. com.app.pro.monthly"
            disabled={lockProductId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Period</label>
          <select
            className={inputCls}
            value={form.subscriptionPeriod}
            onChange={(e) => set("subscriptionPeriod", e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Group Level</label>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={10}
            value={form.groupLevel}
            onChange={(e) => set("groupLevel", e.target.value)}
            placeholder="1"
          />
        </div>
        <div className="flex flex-col gap-1 col-span-2">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Review Note (optional)</label>
          <input
            className={inputCls}
            value={form.reviewNote}
            onChange={(e) => set("reviewNote", e.target.value)}
            placeholder="Notes for App Review"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="familySharable"
          type="checkbox"
          checked={form.familySharable}
          onChange={(e) => set("familySharable", e.target.checked)}
          className="w-4 h-4 accent-[#C4001E]"
        />
        <label htmlFor="familySharable" className="text-[12px] text-[#374151] dark:text-[#c4cad8]">
          Family sharing enabled
        </label>
      </div>
      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onCancel} disabled={saving} className={btnSecondary}>
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.productId.trim()}
          className={btnPrimary}
        >
          {saving ? (
            <>
              <div className="spinner !w-3.5 !h-3.5" /> Saving…
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" /> Save
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LocalizationsPanel({ subscriptionId, addToast }: { subscriptionId: string; addToast: Props["addToast"] }) {
  const [locs, setLocs] = useState<SubscriptionLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLocale, setNewLocale] = useState("en-US");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}/localizations`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setLocs([]);
    } finally {
      setLoading(false);
    }
  }, [subscriptionId]);

  useEffect(() => {
    load();
  }, [load]);

  const addLoc = async () => {
    if (!newLocale.trim() || !newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/asc/subscriptions/localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          subscriptionId,
          locale: newLocale.trim(),
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLocs((l) => [...(l ?? []), json]);
      setShowAdd(false);
      setNewLocale("en-US");
      setNewName("");
      setNewDesc("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/localizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editName, description: editDesc }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(
        (l) => l?.map((loc) => (loc.id === id ? { ...loc, name: editName, description: editDesc } : loc)) ?? null,
      );
      setEditingId(null);
      addToast("Localization updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteLoc = async (id: string) => {
    if (!confirm("Delete this localization?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/subscriptions/localizations/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((l) => l?.filter((loc) => loc.id !== id) ?? null);
      addToast("Localization deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !locs) {
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
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Localizations</span>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 text-[12px] text-[#C4001E] hover:opacity-80 transition-opacity font-medium"
        >
          <Paperclip className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {(!locs || locs.length === 0) && !showAdd ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>No localizations yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Locale</th>
              <th className={TH}>Name</th>
              <th className={TH}>Description</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {locs?.map((loc) =>
              editingId === loc.id ? (
                <tr key={loc.id} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Display name"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                    />
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditingId(null)} className={btnSecSm}>
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => saveEdit(loc.id)}
                        disabled={savingEdit || !editName.trim()}
                        className={btnSecSm}
                      >
                        {savingEdit ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={loc.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={`${TD} font-medium ${textPrimary}`}>{loc.name}</td>
                  <td className={`${TD} ${textSecondary}`}>{loc.description || "—"}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingId(loc.id);
                          setEditName(loc.name);
                          setEditDesc(loc.description ?? "");
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#C4001E] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteLoc(loc.id)}
                        disabled={deletingId === loc.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                      >
                        {deletingId === loc.id ? <div className="spinner !w-3 !h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Locale</label>
              <input
                className={inputCls}
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
                placeholder="en-US"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
              <input
                className={inputCls}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Pro"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Description (optional)</label>
              <input
                className={inputCls}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Unlock all features"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={addLoc} disabled={saving || !newLocale.trim() || !newName.trim()} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Plus className="w-3 h-3" />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupLocalizationsPanel({ groupId, addToast }: { groupId: string; addToast: Props["addToast"] }) {
  const [locs, setLocs] = useState<SubscriptionGroupLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLocale, setNewLocale] = useState("en-US");
  const [newName, setNewName] = useState("");
  const [newCustomAppName, setNewCustomAppName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCustomAppName, setEditCustomAppName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/groups/${groupId}/localizations`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setLocs([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const addLoc = async () => {
    if (!newLocale.trim() || !newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/asc/subscriptions/groups/localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          groupId,
          locale: newLocale.trim(),
          name: newName.trim(),
          customAppName: newCustomAppName.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLocs((l) => [...(l ?? []), json]);
      setShowAdd(false);
      setNewLocale("en-US");
      setNewName("");
      setNewCustomAppName("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/groups/localizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editName, customAppName: editCustomAppName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(
        (l) =>
          l?.map((loc) =>
            loc.id === id ? { ...loc, name: editName, customAppName: editCustomAppName || null } : loc,
          ) ?? null,
      );
      setEditingId(null);
      addToast("Localization updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteLoc = async (id: string) => {
    if (!confirm("Delete this localization?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/subscriptions/groups/localizations/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((l) => l?.filter((loc) => loc.id !== id) ?? null);
      addToast("Localization deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !locs) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  return (
    <div className={`border-t ${borderDefault}`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
      >
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Group Localizations</span>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 text-[12px] text-[#C4001E] hover:opacity-80 transition-opacity font-medium"
        >
          <Paperclip className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {(!locs || locs.length === 0) && !showAdd ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>No localizations yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Locale</th>
              <th className={TH}>Display Name</th>
              <th className={TH}>Custom App Name</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {locs?.map((loc) =>
              editingId === loc.id ? (
                <tr key={loc.id} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Display name"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editCustomAppName}
                      onChange={(e) => setEditCustomAppName(e.target.value)}
                      placeholder="Custom app name (optional)"
                    />
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditingId(null)} className={btnSecSm}>
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => saveEdit(loc.id)}
                        disabled={savingEdit || !editName.trim()}
                        className={btnSecSm}
                      >
                        {savingEdit ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={loc.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={`${TD} font-medium ${textPrimary}`}>{loc.name}</td>
                  <td className={`${TD} ${textSecondary}`}>{loc.customAppName || "—"}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingId(loc.id);
                          setEditName(loc.name);
                          setEditCustomAppName(loc.customAppName ?? "");
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#C4001E] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteLoc(loc.id)}
                        disabled={deletingId === loc.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                      >
                        {deletingId === loc.id ? <div className="spinner !w-3 !h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Locale</label>
              <input
                className={inputCls}
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
                placeholder="en-US"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
              <input
                className={inputCls}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Pro Membership"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Custom App Name (optional)</label>
              <input
                className={inputCls}
                value={newCustomAppName}
                onChange={(e) => setNewCustomAppName(e.target.value)}
                placeholder="Shown instead of the app name"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={addLoc} disabled={saving || !newLocale.trim() || !newName.trim()} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Plus className="w-3 h-3" />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingPanel({ subscriptionId, addToast }: { subscriptionId: string; addToast: Props["addToast"] }) {
  const [prices, setPrices] = useState<SubscriptionPrice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [territory, setTerritory] = useState("USA");
  const [pricePoints, setPricePoints] = useState<SubscriptionPricePoint[] | null>(null);
  const [loadingPP, setLoadingPP] = useState(false);
  const [selectedPP, setSelectedPP] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPricePoints, setEditPricePoints] = useState<SubscriptionPricePoint[] | null>(null);
  const [editLoadingPP, setEditLoadingPP] = useState(false);
  const [editSelectedPP, setEditSelectedPP] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showSmart, setShowSmart] = useState(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}/prices`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPrices(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setPrices([]);
    } finally {
      setLoading(false);
    }
  }, [subscriptionId]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  const loadPricePoints = useCallback(
    async (terr: string) => {
      if (!terr.trim()) return;
      setLoadingPP(true);
      setPricePoints(null);
      setSelectedPP("");
      try {
        const res = await fetch(
          `/api/asc/subscriptions/${subscriptionId}/price-points?territory=${encodeURIComponent(terr.trim())}`,
          { headers: authHeaders() },
        );
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const data: SubscriptionPricePoint[] = await res.json();
        setPricePoints(data);
        if (data.length > 0) setSelectedPP(data[0].id);
      } catch (err: any) {
        addToast(err.message, "error");
        setPricePoints([]);
      } finally {
        setLoadingPP(false);
      }
    },
    [subscriptionId],
  );

  const handleTerritoryChange = (val: string) => {
    setTerritory(val);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => loadPricePoints(val), 600);
  };

  const openAdd = () => {
    setShowAdd(true);
    loadPricePoints(territory);
  };

  const addPrice = async () => {
    if (!selectedPP) return;
    setSaving(true);
    try {
      const res = await fetch("/api/asc/subscriptions/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          subscriptionId,
          pricePointId: selectedPP,
          territory,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setShowAdd(false);
      await loadPrices();
      addToast("Price set", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const startEditPrice = async (p: SubscriptionPrice) => {
    if (!p.territory) return;
    setEditingId(p.id);
    setEditPricePoints(null);
    setEditSelectedPP(p.pricePointId ?? "");
    setEditLoadingPP(true);

    try {
      const res = await fetch(
        `/api/asc/subscriptions/${subscriptionId}/price-points?territory=${encodeURIComponent(p.territory)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data: SubscriptionPricePoint[] = await res.json();
      setEditPricePoints(data);

      if (!data.some((pp) => pp.id === p.pricePointId)) {
        setEditSelectedPP(data[0]?.id ?? "");
      }
    } catch (err: any) {
      addToast(err.message, "error");
      setEditPricePoints([]);
    } finally {
      setEditLoadingPP(false);
    }
  };

  const cancelEditPrice = () => setEditingId(null);

  const saveEditPrice = async (p: SubscriptionPrice) => {
    if (!editSelectedPP || !p.territory) return;
    setSavingEdit(true);

    try {
      const res = await fetch("/api/asc/subscriptions/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          subscriptionId,
          pricePointId: editSelectedPP,
          territory: p.territory,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setEditingId(null);
      await loadPrices();
      addToast("Price updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const deletePrice = async (id: string) => {
    if (!confirm("Remove this price?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/subscriptions/prices/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPrices((p) => p?.filter((pr) => pr.id !== id) ?? null);
      addToast("Price removed", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !prices) {
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
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Pricing</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSmart(true)}
            className="inline-flex items-center gap-1 text-[12px] text-[#C4001E] hover:opacity-80 transition-opacity font-medium"
          >
            <Sparkles className="w-3.5 h-3.5" /> Smart Pricing
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 text-[12px] text-[#C4001E] hover:opacity-80 transition-opacity font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add Territory
          </button>
        </div>
      </div>

      <SmartPricingModal
        open={showSmart}
        onClose={() => setShowSmart(false)}
        kind="subscription"
        entityId={subscriptionId}
        currentUsaPricePointId={prices?.find((p) => p.territory === "USA")?.pricePointId ?? null}
        onApplied={loadPrices}
        addToast={addToast}
      />

      {(!prices || prices.length === 0) && !showAdd ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>No prices set yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Territory</th>
              <th className={TH}>Currency</th>
              <th className={TH}>Customer Price</th>
              <th className={TH}>Proceeds</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {prices?.map((p) => {
              const territoryCell = (
                <span className="flex items-center gap-1.5">
                  {territoryFlagSrc(p.territory) != null && (
                    <img
                      src={territoryFlagSrc(p.territory)!}
                      alt=""
                      width={20}
                      height={15}
                      className="h-[14px] w-[19px] object-contain shrink-0 rounded-xs"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  {p.territory}
                </span>
              );

              if (editingId === p.id) {
                const selectedEditPP = editPricePoints?.find((pp) => pp.id === editSelectedPP);
                return (
                  <tr key={p.id} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                    <td className={`${TD} font-mono font-medium ${textPrimary}`}>
                      {p.territory ? territoryCell : "—"}
                    </td>
                    <td className={`${TD} ${textSecondary}`}>{p.currency ?? "—"}</td>
                    <td className={TD}>
                      {editLoadingPP ? (
                        <div className={`${inputCls} ${textMuted}`}>Loading tiers…</div>
                      ) : editPricePoints && editPricePoints.length > 0 ? (
                        <select
                          className={inputCls}
                          value={editSelectedPP}
                          onChange={(e) => setEditSelectedPP(e.target.value)}
                        >
                          {editPricePoints.map((pp) => (
                            <option key={pp.id} value={pp.id}>
                              {pp.currency} {pp.customerPrice} (proceeds: {pp.proceeds})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className={`${inputCls} ${textMuted}`}>No tiers found</div>
                      )}
                    </td>
                    <td className={`${TD} ${textSecondary}`}>
                      {selectedEditPP ? `${p.currency ?? ""} ${selectedEditPP.proceeds}` : "—"}
                    </td>
                    <td className={`${TD} text-right`}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={cancelEditPrice} className={btnSecSm}>
                          <X className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => saveEditPrice(p)}
                          disabled={savingEdit || !editSelectedPP}
                          className={btnSecSm}
                        >
                          {savingEdit ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={p.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={`${TD} font-mono font-medium ${textPrimary}`}>{p.territory ? territoryCell : "—"}</td>
                  <td className={`${TD} ${textSecondary}`}>{p.currency ?? "—"}</td>
                  <td className={`${TD} font-semibold ${textPrimary}`}>
                    {p.customerPrice != null ? `${p.currency ?? ""} ${p.customerPrice}` : "—"}
                  </td>
                  <td className={`${TD} ${textSecondary}`}>
                    {p.proceeds != null ? `${p.currency ?? ""} ${p.proceeds}` : "—"}
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEditPrice(p)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#C4001E] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deletePrice(p.id)}
                        disabled={deletingId === p.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                      >
                        {deletingId === p.id ? <div className="spinner !w-3 !h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Territory (3-letter code)</label>
              <input
                className={inputCls}
                value={territory}
                onChange={(e) => handleTerritoryChange(e.target.value.toUpperCase())}
                placeholder="USA"
                maxLength={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>
                Price Tier
                {loadingPP && <span className="ml-1 text-[10px] text-[#9ca3af]">loading…</span>}
              </label>
              {pricePoints && pricePoints.length > 0 ? (
                <select className={inputCls} value={selectedPP} onChange={(e) => setSelectedPP(e.target.value)}>
                  {pricePoints.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.currency} {pp.customerPrice} (proceeds: {pp.proceeds})
                    </option>
                  ))}
                </select>
              ) : (
                <div className={`${inputCls} ${textMuted}`}>
                  {loadingPP ? "Loading tiers…" : pricePoints !== null ? "No tiers found" : "Enter territory first"}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={addPrice} disabled={saving || !selectedPP} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              Set Price
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReviewPanelProps {
  subscriptionId: string;
  reviewNote: string | null;
  onReviewNoteUpdated: (note: string | null) => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function ReviewPanel({ subscriptionId, reviewNote, onReviewNoteUpdated, addToast }: ReviewPanelProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(reviewNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [screenshot, setScreenshot] = useState<SubscriptionReviewScreenshot | null>(null);
  const [loadingScreenshot, setLoadingScreenshot] = useState(true);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [deletingScreenshot, setDeletingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingScreenshot(true);
    fetch(`/api/asc/subscriptions/${subscriptionId}/review-screenshot`, {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setScreenshot(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setScreenshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingScreenshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subscriptionId]);

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reviewNote: noteText || null }),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);

      onReviewNoteUpdated(noteText || null);
      setEditingNote(false);
      addToast("Review note saved", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingNote(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingScreenshot(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const res = await fetch(`/api/asc/subscriptions/${subscriptionId}/review-screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          fileData: base64,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      addToast("Screenshot uploaded — may take a moment to process", "success");

      const refresh = await fetch(`/api/asc/subscriptions/${subscriptionId}/review-screenshot`, {
        headers: authHeaders(),
      });
      if (refresh.ok) setScreenshot(await refresh.json());
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setUploadingScreenshot(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteScreenshot = async () => {
    if (!screenshot) return;
    if (!confirm("Delete this review screenshot?")) return;
    setDeletingScreenshot(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/review-screenshots/${screenshot.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setScreenshot(null);
      addToast("Screenshot deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingScreenshot(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[12px] font-semibold ${textSecondary} uppercase tracking-wide`}>Review Note</span>
          {!editingNote && (
            <button
              onClick={() => {
                setNoteText(reviewNote ?? "");
                setEditingNote(true);
              }}
              className="text-[12px] text-[#C4001E] hover:underline"
            >
              {reviewNote ? "Edit" : "Add"}
            </button>
          )}
        </div>
        {editingNote ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Notes for the App Review team…"
              className={`${inputCls} resize-none`}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#9ca3af]">{noteText.length}/4000</span>
              <div className="flex gap-2">
                <button onClick={() => setEditingNote(false)} className={btnSecondary}>
                  Cancel
                </button>
                <button onClick={handleSaveNote} disabled={savingNote} className={btnPrimary}>
                  {savingNote ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : reviewNote ? (
          <p
            className={`text-[13px] text-[#374151] dark:text-[#c4c9d6] whitespace-pre-wrap leading-relaxed rounded-xl bg-[#f9fafb] dark:bg-[#1a1f2b] border ${borderDefault} px-3.5 py-3`}
          >
            {reviewNote}
          </p>
        ) : (
          <p className={`text-[13px] ${textMuted} italic`}>No review note added.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[12px] font-semibold ${textSecondary} uppercase tracking-wide`}>
            Review Screenshot
          </span>
          {!loadingScreenshot && !screenshot && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingScreenshot}
              className="text-[12px] text-[#C4001E] hover:underline disabled:opacity-50"
            >
              {uploadingScreenshot ? "Uploading…" : "Upload"}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
        {loadingScreenshot ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9ca3af]">
            <div className="spinner !w-3.5 !h-3.5" /> Loading…
          </div>
        ) : screenshot ? (
          <div className={`relative w-fit rounded-xl overflow-hidden border ${borderDefault} group`}>
            {screenshot.imageUrl ? (
              <img
                src={screenshot.imageUrl}
                alt="Review screenshot"
                className="block max-w-xs max-h-48 object-contain"
              />
            ) : (
              <div className="flex items-center justify-center w-48 h-28 bg-[#f3f4f6] dark:bg-[#1a1f2b]">
                <Upload className="w-6 h-6 text-[#9ca3af]" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingScreenshot}
                className="px-2.5 py-1.5 rounded-lg bg-white text-[12px] font-medium text-[#111827] hover:bg-gray-100 transition disabled:opacity-50"
              >
                Replace
              </button>
              <button
                onClick={handleDeleteScreenshot}
                disabled={deletingScreenshot}
                className="px-2.5 py-1.5 rounded-lg bg-red-600 text-[12px] font-medium text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {deletingScreenshot ? "…" : "Delete"}
              </button>
            </div>
            {screenshot.fileName && (
              <p className={`px-2.5 py-1.5 text-[11px] ${textSecondary} border-t ${borderDefault} truncate`}>
                {screenshot.fileName}
              </p>
            )}
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center w-48 h-28 rounded-xl border-2 border-dashed border-[#d1d5db] dark:border-[#2a2f3d] ${textMuted} hover:border-[#C4001E] hover:text-[#C4001E] transition-colors cursor-pointer`}
          >
            {uploadingScreenshot ? (
              <div className="spinner !w-5 !h-5" />
            ) : (
              <>
                <Upload className="w-5 h-5 mb-1" />
                <span className="text-[12px]">Upload PNG/JPG</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface DetailViewProps {
  sub: SubscriptionItem;
  group: SubscriptionGroup;
  bundleId: string | null;
  onBack: () => void;
  onUpdated: (updated: SubscriptionItem) => void;
  onDeleted: () => void;
  addToast: Props["addToast"];
}

function DetailView({ sub, group, bundleId, onBack, onUpdated, onDeleted, addToast }: DetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"localizations" | "pricing" | "review">("localizations");

  const handleUpdate = async (form: SubFormState) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: form.name,
          familySharable: form.familySharable,
          subscriptionPeriod: form.subscriptionPeriod,
          reviewNote: form.reviewNote || undefined,
          groupLevel: parseInt(form.groupLevel) || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({
        ...sub,
        name: form.name,
        familySharable: form.familySharable,
        subscriptionPeriod: form.subscriptionPeriod,
        reviewNote: form.reviewNote || null,
        groupLevel: parseInt(form.groupLevel) || null,
      });
      setEditing(false);
      addToast("Subscription updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${sub.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/${sub.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onDeleted();
      addToast("Subscription deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
      setDeleting(false);
    }
  };

  const AppleLogo = () => (
    <svg className="w-3.5 h-3.5 text-[#555] dark:text-[#aaa] shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Identifier",
      value: <span className={`font-mono text-[13px] ${textPrimary}`}>{sub.productId}</span>,
    },
    {
      label: "App",
      value: (
        <span className={`flex items-center gap-1.5 text-[13px] ${textPrimary}`}>
          <AppleLogo />
          {bundleId ?? "App Store"}
        </span>
      ),
    },
    {
      label: "Store",
      value: <span className={`text-[13px] ${textPrimary}`}>App Store</span>,
    },
    {
      label: "Store Status",
      value: <StatusBadge state={sub.state} />,
    },
    {
      label: "Display Name",
      value: <span className={`text-[13px] ${textPrimary}`}>{sub.name}</span>,
    },
    {
      label: "Product Type",
      value: (
        <span className={`text-[13px] ${textPrimary}`}>
          Subscription
          {sub.subscriptionPeriod ? ` · ${PERIOD_LABELS[sub.subscriptionPeriod] ?? sub.subscriptionPeriod}` : ""}
        </span>
      ),
    },
    {
      label: "Subscription group",
      value: <span className={`text-[13px] ${textPrimary}`}>{group.referenceName}</span>,
    },
    {
      label: "Family sharing",
      value: <span className={`text-[13px] ${textPrimary}`}>{sub.familySharable ? "Enabled" : "Disabled"}</span>,
    },
  ];

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className={`p-2 rounded-xl border ${borderDefault} ${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0] hover:border-[#C4001E] transition-all shrink-0`}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className={`text-2xl font-semibold tracking-tight ${textPrimary} truncate`}>{sub.name}</h1>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className={`p-1.5 rounded-lg ${textMuted} hover:text-[#C4001E] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all`}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setEditing(true)} className={btnPrimary}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-xl border ${borderDefault} text-[13px] font-medium text-red-500 hover:border-red-300 dark:hover:border-red-800 transition-all disabled:opacity-50`}
            >
              {deleting ? <div className="spinner !w-3.5 !h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className={cardCls}>
          <SubForm
            title="Edit Subscription"
            initial={{
              name: sub.name,
              productId: sub.productId,
              familySharable: sub.familySharable,
              subscriptionPeriod: sub.subscriptionPeriod ?? "ONE_MONTH",
              reviewNote: sub.reviewNote ?? "",
              groupLevel: String(sub.groupLevel ?? 1),
            }}
            onSave={handleUpdate}
            onCancel={() => setEditing(false)}
            saving={saving}
            lockProductId
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={cardCls}>
            <dl className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
              {fields.map(({ label, value }) => (
                <div key={label} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <dt className={`w-44 shrink-0 text-[12px] font-medium ${textSecondary}`}>{label}</dt>
                  <dd className="flex-1 min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={cardCls}>
            <div className={`flex gap-1 mb-4 pb-3 border-b ${borderDefault}`}>
              <button
                onClick={() => setActiveTab("localizations")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "localizations"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <Globe className="w-3.5 h-3.5" /> Localizations
              </button>
              <button
                onClick={() => setActiveTab("pricing")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "pricing"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" /> Pricing
              </button>
              <button
                onClick={() => setActiveTab("review")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "review"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> Review
              </button>
            </div>
            {activeTab === "localizations" ? (
              <LocalizationsPanel subscriptionId={sub.id} addToast={addToast} />
            ) : activeTab === "pricing" ? (
              <PricingPanel subscriptionId={sub.id} addToast={addToast} />
            ) : (
              <ReviewPanel
                subscriptionId={sub.id}
                reviewNote={sub.reviewNote}
                onReviewNoteUpdated={(note) => onUpdated({ ...sub, reviewNote: note })}
                addToast={addToast}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface GroupTableProps {
  group: SubscriptionGroup;
  bundleId: string | null;
  onSelectSub: (sub: SubscriptionItem) => void;
  onGroupUpdated: (id: string, referenceName: string) => void;
  onGroupDeleted: (id: string) => void;
  onSubCreated: (groupId: string, sub: SubscriptionItem) => void;
  addToast: Props["addToast"];
}

function GroupTable({
  group,
  bundleId,
  onSelectSub,
  onGroupUpdated,
  onGroupDeleted,
  onSubCreated,
  addToast,
}: GroupTableProps) {
  const [showNewSub, setShowNewSub] = useState(false);
  const [savingSub, setSavingSub] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group.referenceName);
  const [savingName, setSavingName] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [showLocalizations, setShowLocalizations] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowGroupMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const saveName = async () => {
    if (!nameVal.trim()) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ referenceName: nameVal.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onGroupUpdated(group.id, nameVal.trim());
      setEditingName(false);
      addToast("Group name updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingName(false);
    }
  };

  const deleteGroup = async () => {
    if (!confirm(`Delete group "${group.referenceName}"? This cannot be undone.`)) return;
    setDeletingGroup(true);
    try {
      const res = await fetch(`/api/asc/subscriptions/groups/${group.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onGroupDeleted(group.id);
      addToast("Group deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
      setDeletingGroup(false);
    }
  };

  const createSub = async (form: SubFormState) => {
    setSavingSub(true);
    try {
      const res = await fetch("/api/asc/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          groupId: group.id,
          name: form.name,
          productId: form.productId,
          familySharable: form.familySharable,
          subscriptionPeriod: form.subscriptionPeriod,
          reviewNote: form.reviewNote || undefined,
          groupLevel: parseInt(form.groupLevel) || 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSubCreated(group.id, json as SubscriptionItem);
      setShowNewSub(false);
      addToast("Subscription created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingSub(false);
    }
  };

  const AppleLogo = () => (
    <svg className={`w-3.5 h-3.5 ${textMuted} shrink-0`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );

  return (
    <div className={`${cardCls} overflow-hidden !p-0`}>
      <div className={`flex items-center justify-between px-5 py-4 border-b ${borderDefault}`}>
        <div className="flex items-center gap-2 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                className={`${inputCls} py-1.5 text-sm font-semibold`}
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setNameVal(group.referenceName);
                  }
                }}
                autoFocus
              />
              <button onClick={saveName} disabled={savingName} className={btnSecSm}>
                {savingName ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setNameVal(group.referenceName);
                }}
                className={btnSecSm}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <>
              <AppleLogo />
              <span className={`text-[14px] font-semibold ${textPrimary} truncate`}>
                {group.referenceName} (App Store)
              </span>
            </>
          )}
        </div>

        {!editingName && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowNewSub(true)}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#C4001E] hover:opacity-80 transition-opacity"
            >
              <Plus className="w-4 h-4" /> New
            </button>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowGroupMenu((v) => !v)}
                className={`p-1.5 rounded-lg ${textMuted} hover:text-[#111827] dark:hover:text-[#e8eaf0] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all`}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showGroupMenu && (
                <div
                  className={`absolute right-0 top-full mt-1 w-44 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] shadow-lg z-10 py-1 overflow-hidden`}
                >
                  <button
                    onClick={() => {
                      setShowGroupMenu(false);
                      setEditingName(true);
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#374151] dark:text-[#c4cad8] hover:bg-[#f3f4f6] dark:hover:bg-[#252b38] flex items-center gap-2 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Rename group
                  </button>
                  <button
                    onClick={() => {
                      setShowGroupMenu(false);
                      setShowLocalizations((v) => !v);
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#374151] dark:text-[#c4cad8] hover:bg-[#f3f4f6] dark:hover:bg-[#252b38] flex items-center gap-2 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" /> {showLocalizations ? "Hide localizations" : "Edit localizations"}
                  </button>
                  <button
                    onClick={() => {
                      setShowGroupMenu(false);
                      deleteGroup();
                    }}
                    disabled={deletingGroup}
                    className="w-full text-left px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {deletingGroup ? <div className="spinner !w-3.5 !h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete group
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showLocalizations && <GroupLocalizationsPanel groupId={group.id} addToast={addToast} />}

      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Product</th>
            <th className={TH}>Status</th>
            <th className={TH}>Period</th>
            <th className={TH}>Group Level</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {group.subscriptions.length === 0 && !showNewSub && (
            <tr>
              <td colSpan={5} className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                No subscriptions yet — click <strong>+ New</strong> to add one
              </td>
            </tr>
          )}
          {group.subscriptions.map((sub) => (
            <tr
              key={sub.id}
              onClick={() => onSelectSub(sub)}
              className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] cursor-pointer transition-colors"
            >
              <td className={TD}>
                <div>
                  <p className={`text-[13px] font-medium ${textPrimary}`}>{sub.name}</p>
                  <p className={`text-[11px] font-mono ${textMuted} mt-0.5`}>{sub.productId}</p>
                </div>
              </td>
              <td className={TD}>
                <StatusBadge state={sub.state} />
              </td>
              <td className={`${TD} ${textSecondary}`}>
                {sub.subscriptionPeriod ? (PERIOD_LABELS[sub.subscriptionPeriod] ?? sub.subscriptionPeriod) : "—"}
              </td>
              <td className={`${TD} ${textSecondary}`}>{sub.groupLevel ?? "—"}</td>
              <td className={`${TD} text-right`}>
                <MoreHorizontal
                  className={`w-4 h-4 ${textMuted} opacity-0 group-hover:opacity-100 transition-opacity`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showNewSub && (
        <div className={`border-t ${borderDefault} p-4`}>
          <SubForm
            title="New Subscription"
            onSave={createSub}
            onCancel={() => setShowNewSub(false)}
            saving={savingSub}
          />
        </div>
      )}
    </div>
  );
}

export default function MonetizationSubscriptions({ addToast }: Props) {
  const [groups, setGroups] = useState<SubscriptionGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [selectedSub, setSelectedSub] = useState<{
    sub: SubscriptionItem;
    group: SubscriptionGroup;
  } | null>(null);

  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = bundleId
        ? `/api/asc/subscriptions/groups?bundleId=${encodeURIComponent(bundleId)}`
        : "/api/asc/subscriptions/groups";
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setGroups(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      setGroups(null);
      setSelectedSub(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    try {
      const res = await fetch("/api/asc/subscriptions/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ referenceName: newGroupName.trim(), bundleId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setGroups((g) => [...(g ?? []), json as SubscriptionGroup]);
      setNewGroupName("");
      setShowNewGroupForm(false);
      addToast("Subscription group created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleGroupUpdated = (id: string, referenceName: string) =>
    setGroups((g) => g?.map((group) => (group.id === id ? { ...group, referenceName } : group)) ?? null);

  const handleGroupDeleted = (id: string) => setGroups((g) => g?.filter((group) => group.id !== id) ?? null);

  const handleSubCreated = (groupId: string, sub: SubscriptionItem) =>
    setGroups(
      (g) =>
        g?.map((group) =>
          group.id === groupId ? { ...group, subscriptions: [...group.subscriptions, sub] } : group,
        ) ?? null,
    );

  const handleSubUpdated = (updated: SubscriptionItem) => {
    setGroups(
      (g) =>
        g?.map((group) => ({
          ...group,
          subscriptions: group.subscriptions.map((s) => (s.id === updated.id ? updated : s)),
        })) ?? null,
    );
    setSelectedSub((prev) => (prev && prev.sub.id === updated.id ? { ...prev, sub: updated } : prev));
  };

  const handleSubDeleted = () => {
    if (!selectedSub) return;
    const {
      group: { id: groupId },
      sub: { id: subId },
    } = selectedSub;
    setGroups(
      (g) =>
        g?.map((group) =>
          group.id === groupId
            ? {
                ...group,
                subscriptions: group.subscriptions.filter((s) => s.id !== subId),
              }
            : group,
        ) ?? null,
    );
    setSelectedSub(null);
  };

  if (selectedSub) {
    return (
      <DetailView
        sub={selectedSub.sub}
        group={selectedSub.group}
        bundleId={bundleId}
        onBack={() => setSelectedSub(null)}
        onUpdated={handleSubUpdated}
        onDeleted={handleSubDeleted}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`${pageTitle}`}>Subscriptions</h1>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={btnSecondary}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => setShowNewGroupForm(true)} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" /> New Group
          </button>
        </div>
      </div>

      {showNewGroupForm && (
        <div className={`${cardCls} mb-4 flex flex-col gap-3`}>
          <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>
            New Subscription Group
          </p>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createGroup();
                if (e.key === "Escape") setShowNewGroupForm(false);
              }}
              placeholder="e.g. Pro Access"
              autoFocus
            />
            <button onClick={createGroup} disabled={creatingGroup || !newGroupName.trim()} className={btnPrimary}>
              {creatingGroup ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              Create
            </button>
            <button onClick={() => setShowNewGroupForm(false)} className={btnSecondary}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {loading && !groups && (
        <div className={`flex items-center justify-center py-16 gap-2 ${textMuted} text-sm`}>
          <div className="spinner" /> Loading subscriptions…
        </div>
      )}

      {groups && groups.length === 0 && (
        <div className={`${cardCls} flex flex-col items-center justify-center py-16 gap-4 text-center`}>
          <div className="w-12 h-12 rounded-2xl bg-[#fef2f3] dark:bg-[#2a1f23] flex items-center justify-center">
            <svg
              className="w-6 h-6 text-[#C4001E]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </div>
          <div>
            <p className={`text-[15px] font-semibold ${textPrimary}`}>No subscription groups</p>
            <p className={`text-sm ${textSecondary} mt-1`}>Create your first group to start adding subscriptions.</p>
          </div>
          <button onClick={() => setShowNewGroupForm(true)} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" /> New Group
          </button>
        </div>
      )}

      {groups && groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <GroupTable
              key={group.id}
              group={group}
              bundleId={bundleId}
              onSelectSub={(sub) => setSelectedSub({ sub, group })}
              onGroupUpdated={handleGroupUpdated}
              onGroupDeleted={handleGroupDeleted}
              onSubCreated={handleSubCreated}
              addToast={addToast}
            />
          ))}
        </div>
      )}
    </div>
  );
}
