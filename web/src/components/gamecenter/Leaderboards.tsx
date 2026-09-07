import { useState, useCallback, useEffect } from "react";
import { Plus, RefreshCw, Pencil, Trash2, X, Check, Trophy, Globe, Archive, ArrowLeft } from "lucide-react";
import { authHeaders, getActiveBundleId } from "../../hooks/useApi";
import {
  TD,
  TH,
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
import { COMMON_LOCALES, GcNotEnabled } from "./shared";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

interface Leaderboard {
  id: string;
  referenceName: string;
  vendorIdentifier: string;
  defaultFormatter: string;
  archived: boolean;
  scoreSortType: string;
  submissionType: string;
}

interface LeaderboardLocalization {
  id: string;
  locale: string;
  name: string;
  formatterSuffix: string;
  formatterSuffixSingular: string;
}

const FORMATTER_LABELS: Record<string, string> = {
  INTEGER: "Integer",
  DECIMAL: "Decimal",
  FRACTION: "Fraction",
  ELAPSED_TIME_MILLISECONDS: "Time (ms)",
  ELAPSED_TIME_SECONDS: "Time (s)",
  ELAPSED_TIME_MINUTES: "Time (min)",
  ELAPSED_TIME_HOURS: "Time (h)",
  ELAPSED_TIME: "Elapsed Time",
  MONEY: "Money",
  FIXED_POINT: "Fixed Point",
};

const SORT_LABELS: Record<string, string> = {
  HIGH_TO_LOW: "High to Low",
  LOW_TO_HIGH: "Low to High",
};

const FORMATTERS = Object.keys(FORMATTER_LABELS);

interface LbFormState {
  referenceName: string;
  vendorIdentifier: string;
  defaultFormatter: string;
  scoreSortType: string;
  submissionType: string;
}

const emptyLbForm = (): LbFormState => ({
  referenceName: "",
  vendorIdentifier: "",
  defaultFormatter: "INTEGER",
  scoreSortType: "HIGH_TO_LOW",
  submissionType: "INDIVIDUAL",
});

interface LbFormProps {
  initial?: Partial<LbFormState>;
  onSave: (v: LbFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lockVendorId?: boolean;
}

function LbForm({ initial, onSave, onCancel, saving, title, lockVendorId }: LbFormProps) {
  const [form, setForm] = useState<LbFormState>({
    ...emptyLbForm(),
    ...initial,
  });
  const set = (k: keyof LbFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className={`rounded-xl border ${borderDefault} bg-[#fafbfc] dark:bg-[#1c2028] p-4 flex flex-col gap-3`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Reference Name</label>
          <input
            className={inputCls}
            value={form.referenceName}
            onChange={(e) => set("referenceName", e.target.value)}
            placeholder="e.g. All-Time High Score"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Vendor Identifier</label>
          <input
            className={inputCls}
            value={form.vendorIdentifier}
            onChange={(e) => set("vendorIdentifier", e.target.value)}
            placeholder="e.g. com.app.leaderboard.alltime"
            disabled={lockVendorId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Score Format</label>
          <select
            className={inputCls}
            value={form.defaultFormatter}
            onChange={(e) => set("defaultFormatter", e.target.value)}
          >
            {FORMATTERS.map((f) => (
              <option key={f} value={f}>
                {FORMATTER_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Sort Order</label>
          <select
            className={inputCls}
            value={form.scoreSortType}
            onChange={(e) => set("scoreSortType", e.target.value)}
          >
            <option value="HIGH_TO_LOW">High to Low</option>
            <option value="LOW_TO_HIGH">Low to High</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Submission Type</label>
          <select
            className={inputCls}
            value={form.submissionType}
            onChange={(e) => set("submissionType", e.target.value)}
          >
            <option value="INDIVIDUAL">Individual</option>
            <option value="TEAM">Team</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onCancel} disabled={saving} className={btnSecondary}>
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.referenceName.trim() || !form.vendorIdentifier.trim()}
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

function LocalizationsPanel({ leaderboard, addToast }: { leaderboard: Leaderboard; addToast: Props["addToast"] }) {
  const [locs, setLocs] = useState<LeaderboardLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLocale, setNewLocale] = useState("en-US");
  const [newName, setNewName] = useState("");
  const [newSuffix, setNewSuffix] = useState("");
  const [newSuffixSingular, setNewSuffixSingular] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSuffix, setEditSuffix] = useState("");
  const [editSuffixSingular, setEditSuffixSingular] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/leaderboards/${leaderboard.id}/localizations${params}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setLocs([]);
    } finally {
      setLoading(false);
    }
  }, [leaderboard.id, bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!newName.trim() || !newLocale) return;
    setSaving(true);
    try {
      const res = await fetch("/api/asc/gamecenter/leaderboard-localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          leaderboardId: leaderboard.id,
          locale: newLocale,
          name: newName.trim(),
          ...(newSuffix.trim() ? { formatterSuffix: newSuffix.trim() } : {}),
          ...(newSuffixSingular.trim() ? { formatterSuffixSingular: newSuffixSingular.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created = await res.json();
      setLocs((prev) => [...(prev ?? []), created]);
      setShowAdd(false);
      setNewLocale("en-US");
      setNewName("");
      setNewSuffix("");
      setNewSuffixSingular("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (loc: LeaderboardLocalization) => {
    setEditingId(loc.id);
    setEditName(loc.name);
    setEditSuffix(loc.formatterSuffix);
    setEditSuffixSingular(loc.formatterSuffixSingular);
  };

  const handleEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/asc/gamecenter/leaderboard-localizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          name: editName.trim(),
          formatterSuffix: editSuffix.trim(),
          formatterSuffixSingular: editSuffixSingular.trim(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(
        (prev) =>
          prev?.map((l) =>
            l.id === id
              ? {
                  ...l,
                  name: editName.trim(),
                  formatterSuffix: editSuffix.trim(),
                  formatterSuffixSingular: editSuffixSingular.trim(),
                }
              : l,
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

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/asc/gamecenter/leaderboard-localizations/${id}?bundleId=${encodeURIComponent(bundleId ?? "")}`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((prev) => prev?.filter((l) => l.id !== id) ?? null);
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

  const existingLocales = new Set(locs?.map((l) => l.locale) ?? []);

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
      >
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Localizations</span>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Add
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
              <th className={TH}>Suffix (plural)</th>
              <th className={TH}>Suffix (singular)</th>
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
                      value={editSuffix}
                      onChange={(e) => setEditSuffix(e.target.value)}
                      placeholder="points"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editSuffixSingular}
                      onChange={(e) => setEditSuffixSingular(e.target.value)}
                      placeholder="point"
                    />
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditingId(null)} className={btnSecSm}>
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleEdit(loc.id)}
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
                  <td className={`${TD} ${textSecondary}`}>{loc.formatterSuffix || "—"}</td>
                  <td className={`${TD} ${textSecondary}`}>{loc.formatterSuffixSingular || "—"}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(loc)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(loc.id)}
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Locale</label>
              <select className={inputCls} value={newLocale} onChange={(e) => setNewLocale(e.target.value)}>
                {COMMON_LOCALES.filter((l) => !existingLocales.has(l)).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
              <input
                className={inputCls}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="High Score"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Suffix (plural)</label>
              <input
                className={inputCls}
                value={newSuffix}
                onChange={(e) => setNewSuffix(e.target.value)}
                placeholder="points"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Suffix (singular)</label>
              <input
                className={inputCls}
                value={newSuffixSingular}
                onChange={(e) => setNewSuffixSingular(e.target.value)}
                placeholder="point"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={handleAdd} disabled={saving || !newLocale.trim() || !newName.trim()} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Plus className="w-3 h-3" />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface DetailViewProps {
  lb: Leaderboard;
  bundleId: string | null;
  onBack: () => void;
  onUpdated: (updated: Leaderboard) => void;
  onDeleted: () => void;
  addToast: Props["addToast"];
}

function DetailView({ lb, bundleId, onBack, onUpdated, onDeleted, addToast }: DetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleUpdate = async (form: LbFormState) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/gamecenter/leaderboards/${lb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, referenceName: form.referenceName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({ ...lb, referenceName: form.referenceName });
      setEditing(false);
      addToast("Leaderboard updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${lb.referenceName}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/leaderboards/${lb.id}${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onDeleted();
      addToast("Leaderboard deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
      setDeleting(false);
    }
  };

  const handleArchiveToggle = async () => {
    try {
      const res = await fetch(`/api/asc/gamecenter/leaderboards/${lb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, archived: !lb.archived }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({ ...lb, archived: !lb.archived });
      addToast(lb.archived ? "Unarchived" : "Archived", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Vendor Identifier",
      value: <span className={`font-mono text-[13px] ${textPrimary}`}>{lb.vendorIdentifier}</span>,
    },
    {
      label: "Score Format",
      value: (
        <span className={`text-[13px] ${textPrimary}`}>
          {FORMATTER_LABELS[lb.defaultFormatter] ?? lb.defaultFormatter}
        </span>
      ),
    },
    {
      label: "Sort Order",
      value: <span className={`text-[13px] ${textPrimary}`}>{SORT_LABELS[lb.scoreSortType] ?? lb.scoreSortType}</span>,
    },
    {
      label: "Submission Type",
      value: (
        <span className={`text-[13px] ${textPrimary}`}>
          {lb.submissionType === "INDIVIDUAL" ? "Individual" : "Team"}
        </span>
      ),
    },
    {
      label: "Status",
      value: lb.archived ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-[#252b38] dark:text-[#8b93a5]">
          <Archive className="w-3 h-3" /> Archived
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className={`p-2 rounded-xl border ${borderDefault} ${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0] hover:border-[#595DD2] transition-all shrink-0`}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className={`text-2xl font-semibold tracking-tight ${textPrimary} truncate`}>{lb.referenceName}</h1>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className={`p-1.5 rounded-lg ${textMuted} hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all`}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button onClick={handleArchiveToggle} className={btnSecondary}>
              <Archive className="w-3.5 h-3.5" /> {lb.archived ? "Unarchive" : "Archive"}
            </button>
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
          <LbForm
            title="Edit Leaderboard"
            initial={{
              referenceName: lb.referenceName,
              vendorIdentifier: lb.vendorIdentifier,
              defaultFormatter: lb.defaultFormatter,
              scoreSortType: lb.scoreSortType,
              submissionType: lb.submissionType,
            }}
            onSave={handleUpdate}
            onCancel={() => setEditing(false)}
            saving={saving}
            lockVendorId
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`}
              >
                <Globe className="w-3.5 h-3.5" /> Localizations
              </button>
            </div>
            <LocalizationsPanel leaderboard={lb} addToast={addToast} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Leaderboards({ addToast }: Props) {
  const [leaderboards, setLeaderboards] = useState<Leaderboard[] | null>(null);
  const [gcDetailId, setGcDetailId] = useState<string | null>(null);
  const [gcEnabled, setGcEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedLb, setSelectedLb] = useState<Leaderboard | null>(null);
  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/leaderboards${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setLeaderboards(data.leaderboards ?? []);
      setGcDetailId(data.gcDetailId ?? null);
      setGcEnabled(data.gcEnabled ?? false);
    } catch (err: any) {
      addToast(err.message, "error");
      setLeaderboards([]);
    } finally {
      setLoading(false);
    }
  }, [bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      setSelectedLb(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const handleCreate = async (form: LbFormState) => {
    if (!gcDetailId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/asc/gamecenter/leaderboards", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, gcDetailId, ...form }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created: Leaderboard = await res.json();
      setLeaderboards((prev) => [...(prev ?? []), created]);
      setShowCreate(false);
      addToast("Leaderboard created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setCreating(false);
    }
  };

  if (selectedLb) {
    return (
      <DetailView
        lb={selectedLb}
        bundleId={bundleId}
        onBack={() => setSelectedLb(null)}
        onUpdated={(updated) => {
          setLeaderboards((prev) => prev?.map((l) => (l.id === updated.id ? updated : l)) ?? null);
          setSelectedLb(updated);
        }}
        onDeleted={() => {
          setLeaderboards((prev) => prev?.filter((l) => l.id !== selectedLb.id) ?? null);
          setSelectedLb(null);
        }}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={pageTitle}>Leaderboards</h1>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>Manage Game Center leaderboards for this app.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className={btnSecSm} title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {gcEnabled && gcDetailId && !showCreate && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> New Leaderboard
            </button>
          )}
        </div>
      </div>

      {showCreate && gcDetailId && (
        <LbForm title="New Leaderboard" onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={creating} />
      )}

      {loading && !leaderboards ? (
        <div className={`${cardCls} flex items-center justify-center py-12`}>
          <div className="spinner w-5 h-5" />
        </div>
      ) : gcEnabled === false ? (
        <div className={cardCls}>
          <GcNotEnabled />
        </div>
      ) : leaderboards && leaderboards.length === 0 ? (
        <div className={`${cardCls} flex flex-col items-center justify-center py-12 gap-3`}>
          <Trophy className="w-10 h-10 text-[#9ca3af] dark:text-[#5c6478]" />
          <p className={`text-sm font-medium ${textSecondary}`}>No leaderboards yet.</p>
          {gcDetailId && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Create First Leaderboard
            </button>
          )}
        </div>
      ) : (
        <div className={cardCls}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className={TH}>Reference Name</th>
                <th className={TH}>Vendor Identifier</th>
                <th className={TH}>Format</th>
                <th className={TH}>Sort</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(leaderboards ?? []).map((lb) => (
                <tr
                  key={lb.id}
                  onClick={() => setSelectedLb(lb)}
                  className="group hover:bg-[#fafbfc] dark:hover:bg-[#1a1f2a] transition-colors cursor-pointer"
                >
                  <td className={`${TD} font-medium ${textPrimary}`}>{lb.referenceName}</td>
                  <td className={`${TD} font-mono text-[12px] ${textSecondary}`}>{lb.vendorIdentifier}</td>
                  <td className={`${TD} text-[12px] ${textSecondary}`}>
                    {FORMATTER_LABELS[lb.defaultFormatter] ?? lb.defaultFormatter}
                  </td>
                  <td className={`${TD} text-[12px] ${textSecondary}`}>
                    {SORT_LABELS[lb.scoreSortType] ?? lb.scoreSortType}
                  </td>
                  <td className={TD}>
                    {lb.archived ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-[#252b38] dark:text-[#8b93a5]">
                        <Archive className="w-3 h-3" /> Archived
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
