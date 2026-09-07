import { useState, useCallback, useEffect } from "react";
import { Plus, RefreshCw, Pencil, Trash2, X, Check, Star, Globe, Archive, ArrowLeft } from "lucide-react";
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

interface Achievement {
  id: string;
  referenceName: string;
  vendorIdentifier: string;
  points: number;
  showBeforeEarned: boolean;
  repeatable: boolean;
  archived: boolean;
}

interface AchievementLocalization {
  id: string;
  locale: string;
  name: string;
  afterEarnedDescription: string;
  beforeEarnedDescription: string;
}

interface AchFormState {
  referenceName: string;
  vendorIdentifier: string;
  points: number;
  showBeforeEarned: boolean;
  repeatable: boolean;
}

const emptyForm = (): AchFormState => ({
  referenceName: "",
  vendorIdentifier: "",
  points: 10,
  showBeforeEarned: true,
  repeatable: false,
});

interface AchFormProps {
  initial?: Partial<AchFormState>;
  onSave: (v: AchFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lockVendorId?: boolean;
}

function AchForm({ initial, onSave, onCancel, saving, title, lockVendorId }: AchFormProps) {
  const [form, setForm] = useState<AchFormState>({ ...emptyForm(), ...initial });
  const set = <K extends keyof AchFormState>(k: K, v: AchFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

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
            placeholder="e.g. First Win"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Vendor Identifier</label>
          <input
            className={inputCls}
            value={form.vendorIdentifier}
            onChange={(e) => set("vendorIdentifier", e.target.value)}
            placeholder="e.g. com.app.achievement.firstwin"
            disabled={lockVendorId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Points</label>
          <input
            type="number"
            min={0}
            max={100}
            className={inputCls}
            value={form.points}
            onChange={(e) => set("points", Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-3 justify-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.showBeforeEarned}
              onChange={(e) => set("showBeforeEarned", e.target.checked)}
              className="w-3.5 h-3.5 accent-[#595DD2]"
            />
            <span className={`text-[12px] ${textSecondary}`}>Show before earned</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.repeatable}
              onChange={(e) => set("repeatable", e.target.checked)}
              className="w-3.5 h-3.5 accent-[#595DD2]"
            />
            <span className={`text-[12px] ${textSecondary}`}>Repeatable</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} disabled={saving} className={btnSecondary}>
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.referenceName.trim() || !form.vendorIdentifier.trim()}
          className={btnPrimary}
        >
          {saving ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />} Save
        </button>
      </div>
    </div>
  );
}

interface LocPanelProps {
  achievement: Achievement;
  bundleId: string | null;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function LocalizationsPanel({ achievement, bundleId, addToast }: LocPanelProps) {
  const [locs, setLocs] = useState<AchievementLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addLocale, setAddLocale] = useState("");
  const [addName, setAddName] = useState("");
  const [addAfter, setAddAfter] = useState("");
  const [addBefore, setAddBefore] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAfter, setEditAfter] = useState("");
  const [editBefore, setEditBefore] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/achievements/${achievement.id}/localizations${params}`, {
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
  }, [achievement.id, bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  const existingLocales = new Set(locs?.map((l) => l.locale) ?? []);

  const handleAdd = async () => {
    if (!addLocale || !addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/asc/gamecenter/achievement-localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          achievementId: achievement.id,
          locale: addLocale,
          name: addName,
          afterEarnedDescription: addAfter,
          beforeEarnedDescription: addBefore,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created: AchievementLocalization = await res.json();
      setLocs((prev) => [...(prev ?? []), created]);
      setShowAdd(false);
      setAddLocale("");
      setAddName("");
      setAddAfter("");
      setAddBefore("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (loc: AchievementLocalization) => {
    setEditingId(loc.id);
    setEditName(loc.name);
    setEditAfter(loc.afterEarnedDescription);
    setEditBefore(loc.beforeEarnedDescription);
  };

  const handleSave = async (loc: AchievementLocalization) => {
    setSavingId(loc.id);
    try {
      const res = await fetch(`/api/asc/gamecenter/achievement-localizations/${loc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          name: editName,
          afterEarnedDescription: editAfter,
          beforeEarnedDescription: editBefore,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(
        (prev) =>
          prev?.map((l) =>
            l.id === loc.id
              ? { ...l, name: editName, afterEarnedDescription: editAfter, beforeEarnedDescription: editBefore }
              : l,
          ) ?? null,
      );
      setEditingId(null);
      addToast("Saved", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/achievement-localizations/${id}${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((prev) => prev?.filter((l) => l.id !== id) ?? null);
      addToast("Deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !locs)
    return (
      <div className="flex justify-center py-6">
        <div className="spinner w-4 h-4" />
      </div>
    );

  const availableLocales = COMMON_LOCALES.filter((l) => !existingLocales.has(l));

  return (
    <div className="flex flex-col gap-3">
      {locs && locs.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Locale</th>
              <th className={TH}>Name</th>
              <th className={TH}>After Earned</th>
              <th className={TH}>Before Earned</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {locs.map((loc) =>
              editingId === loc.id ? (
                <tr key={loc.id} className={`border-t ${borderDefault}`}>
                  <td className={TD}>
                    <span className={`font-mono text-[12px] ${textSecondary}`}>{loc.locale}</span>
                  </td>
                  <td className={TD}>
                    <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editAfter}
                      onChange={(e) => setEditAfter(e.target.value)}
                      placeholder="After earned description"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editBefore}
                      onChange={(e) => setEditBefore(e.target.value)}
                      placeholder="Before earned description"
                    />
                  </td>
                  <td className={TD}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => handleSave(loc)} disabled={savingId === loc.id} className={btnPrimary}>
                        {savingId === loc.id ? (
                          <div className="spinner !w-3.5 !h-3.5" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button onClick={() => setEditingId(null)} className={btnSecondary}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={loc.id} className={`border-t ${borderDefault}`}>
                  <td className={TD}>
                    <span className={`font-mono text-[12px] ${textSecondary}`}>{loc.locale}</span>
                  </td>
                  <td className={TD}>
                    <span className={textPrimary}>{loc.name}</span>
                  </td>
                  <td className={TD}>
                    <span className={textSecondary}>{loc.afterEarnedDescription || "—"}</span>
                  </td>
                  <td className={TD}>
                    <span className={textSecondary}>{loc.beforeEarnedDescription || "—"}</span>
                  </td>
                  <td className={TD}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => startEdit(loc)} className={btnSecSm}>
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(loc.id)}
                        disabled={deletingId === loc.id}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${borderDefault} text-[12px] text-red-500 hover:border-red-300 dark:hover:border-red-800 transition-all disabled:opacity-50`}
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

      {showAdd ? (
        <div className={`rounded-xl border ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>Add Localization</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Locale</label>
              <select className={inputCls} value={addLocale} onChange={(e) => setAddLocale(e.target.value)}>
                <option value="">Select locale…</option>
                {availableLocales.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Name</label>
              <input
                className={inputCls}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="Achievement name"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className={`text-[11px] ${textSecondary} font-medium`}>After Earned Description</label>
              <input
                className={inputCls}
                value={addAfter}
                onChange={(e) => setAddAfter(e.target.value)}
                placeholder="Shown after unlocking"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Before Earned Description</label>
              <input
                className={inputCls}
                value={addBefore}
                onChange={(e) => setAddBefore(e.target.value)}
                placeholder="Shown before unlocking (hint)"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowAdd(false);
                setAddLocale("");
                setAddName("");
                setAddAfter("");
                setAddBefore("");
              }}
              disabled={adding}
              className={btnSecondary}
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={handleAdd} disabled={adding || !addLocale || !addName.trim()} className={btnPrimary}>
              {adding ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />} Add
            </button>
          </div>
        </div>
      ) : (
        availableLocales.length > 0 && (
          <button onClick={() => setShowAdd(true)} className={`self-start ${btnSecSm}`}>
            <Plus className="w-3.5 h-3.5" /> Add Localization
          </button>
        )
      )}
    </div>
  );
}

interface DetailViewProps {
  ach: Achievement;
  bundleId: string | null;
  onBack: () => void;
  onUpdated: (updated: Achievement) => void;
  onDeleted: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function DetailView({ ach, bundleId, onBack, onUpdated, onDeleted, addToast }: DetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleUpdate = async (form: AchFormState) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/gamecenter/achievements/${ach.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          referenceName: form.referenceName,
          points: form.points,
          showBeforeEarned: form.showBeforeEarned,
          repeatable: form.repeatable,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({ ...ach, ...form });
      setEditing(false);
      addToast("Achievement updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    try {
      const res = await fetch(`/api/asc/gamecenter/achievements/${ach.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, archived: !ach.archived }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({ ...ach, archived: !ach.archived });
      addToast(ach.archived ? "Unarchived" : "Archived", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${ach.referenceName}"?`)) return;
    setDeleting(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/achievements/${ach.id}${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onDeleted();
      addToast("Achievement deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  const fields = [
    { label: "Reference Name", value: <span className={textPrimary}>{ach.referenceName}</span> },
    {
      label: "Vendor Identifier",
      value: <span className={`font-mono text-[12px] ${textSecondary}`}>{ach.vendorIdentifier}</span>,
    },
    { label: "Points", value: <span className={textPrimary}>{ach.points}</span> },
    {
      label: "Show Before Earned",
      value: <span className={`text-[12px] font-medium ${textSecondary}`}>{ach.showBeforeEarned ? "Yes" : "No"}</span>,
    },
    {
      label: "Repeatable",
      value: <span className={`text-[12px] font-medium ${textSecondary}`}>{ach.repeatable ? "Yes" : "No"}</span>,
    },
    {
      label: "Status",
      value: ach.archived ? (
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
            <h1 className={`text-2xl font-semibold tracking-tight ${textPrimary} truncate`}>{ach.referenceName}</h1>
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
              <Archive className="w-3.5 h-3.5" /> {ach.archived ? "Unarchive" : "Archive"}
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
          <AchForm
            title="Edit Achievement"
            initial={{
              referenceName: ach.referenceName,
              vendorIdentifier: ach.vendorIdentifier,
              points: ach.points,
              showBeforeEarned: ach.showBeforeEarned,
              repeatable: ach.repeatable,
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
            <LocalizationsPanel achievement={ach} bundleId={bundleId} addToast={addToast} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Achievements({ addToast }: Props) {
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [gcDetailId, setGcDetailId] = useState<string | null>(null);
  const [gcEnabled, setGcEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedAch, setSelectedAch] = useState<Achievement | null>(null);
  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/achievements${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setAchievements(data.achievements ?? []);
      setGcDetailId(data.gcDetailId ?? null);
      setGcEnabled(data.gcEnabled ?? false);
    } catch (err: any) {
      addToast(err.message, "error");
      setAchievements([]);
    } finally {
      setLoading(false);
    }
  }, [bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      setSelectedAch(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const handleCreate = async (form: AchFormState) => {
    if (!gcDetailId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/asc/gamecenter/achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, gcDetailId, ...form }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created: Achievement = await res.json();
      setAchievements((prev) => [...(prev ?? []), created]);
      setShowCreate(false);
      addToast("Achievement created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setCreating(false);
    }
  };

  if (selectedAch) {
    return (
      <DetailView
        ach={selectedAch}
        bundleId={bundleId}
        onBack={() => setSelectedAch(null)}
        onUpdated={(updated) => {
          setAchievements((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? null);
          setSelectedAch(updated);
        }}
        onDeleted={() => {
          setAchievements((prev) => prev?.filter((a) => a.id !== selectedAch.id) ?? null);
          setSelectedAch(null);
        }}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={pageTitle}>Achievements</h1>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>Manage Game Center achievements for this app.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className={btnSecSm} title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {gcEnabled && gcDetailId && !showCreate && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> New Achievement
            </button>
          )}
        </div>
      </div>

      {showCreate && gcDetailId && (
        <AchForm
          title="New Achievement"
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          saving={creating}
        />
      )}

      {loading && !achievements ? (
        <div className={`${cardCls} flex items-center justify-center py-12`}>
          <div className="spinner w-5 h-5" />
        </div>
      ) : gcEnabled === false ? (
        <div className={cardCls}>
          <GcNotEnabled />
        </div>
      ) : achievements && achievements.length === 0 ? (
        <div className={`${cardCls} flex flex-col items-center justify-center py-12 gap-3`}>
          <Star className="w-10 h-10 text-[#9ca3af] dark:text-[#5c6478]" />
          <p className={`text-sm font-medium ${textSecondary}`}>No achievements yet.</p>
          {gcDetailId && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> New Achievement
            </button>
          )}
        </div>
      ) : (
        <div className={cardCls}>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Reference Name</th>
                <th className={TH}>Vendor Identifier</th>
                <th className={TH}>Points</th>
                <th className={TH}>Repeatable</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {achievements?.map((a) => (
                <tr
                  key={a.id}
                  className={`border-t ${borderDefault} cursor-pointer hover:bg-[#f9fafb] dark:hover:bg-[#1a1f2b] transition-colors`}
                  onClick={() => setSelectedAch(a)}
                >
                  <td className={TD}>
                    <span className={`font-medium ${textPrimary}`}>{a.referenceName}</span>
                  </td>
                  <td className={TD}>
                    <span className={`font-mono text-[12px] ${textSecondary}`}>{a.vendorIdentifier}</span>
                  </td>
                  <td className={TD}>
                    <span className={textSecondary}>{a.points}</span>
                  </td>
                  <td className={TD}>
                    <span className={textSecondary}>{a.repeatable ? "Yes" : "No"}</span>
                  </td>
                  <td className={TD}>
                    {a.archived ? (
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
