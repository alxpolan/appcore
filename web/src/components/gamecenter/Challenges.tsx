import { useState, useCallback, useEffect } from "react";
import { Plus, RefreshCw, Pencil, Trash2, X, Check, Swords, Globe, ArrowLeft } from "lucide-react";
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

interface Challenge {
  id: string;
  referenceName: string;
  vendorIdentifier: string;
}

interface ChallengeLocalization {
  id: string;
  locale: string;
  name: string;
}

interface ChalFormState {
  referenceName: string;
  vendorIdentifier: string;
}

const emptyForm = (): ChalFormState => ({
  referenceName: "",
  vendorIdentifier: "",
});

interface ChalFormProps {
  initial?: Partial<ChalFormState>;
  onSave: (v: ChalFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lockVendorId?: boolean;
}

function ChalForm({ initial, onSave, onCancel, saving, title, lockVendorId }: ChalFormProps) {
  const [form, setForm] = useState<ChalFormState>({ ...emptyForm(), ...initial });
  const set = <K extends keyof ChalFormState>(k: K, v: ChalFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

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
            placeholder="e.g. Weekly Challenge"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Vendor Identifier</label>
          <input
            className={inputCls}
            value={form.vendorIdentifier}
            onChange={(e) => set("vendorIdentifier", e.target.value)}
            placeholder="e.g. com.app.challenge.weekly"
            disabled={lockVendorId}
          />
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
  challenge: Challenge;
  bundleId: string | null;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function LocalizationsPanel({ challenge, bundleId, addToast }: LocPanelProps) {
  const [locs, setLocs] = useState<ChallengeLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addLocale, setAddLocale] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/challenges/${challenge.id}/localizations${params}`, {
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
  }, [challenge.id, bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  const existingLocales = new Set(locs?.map((l) => l.locale) ?? []);
  const availableLocales = COMMON_LOCALES.filter((l) => !existingLocales.has(l));

  const handleAdd = async () => {
    if (!addLocale || !addName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/asc/gamecenter/challenge-localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, challengeId: challenge.id, locale: addLocale, name: addName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created: ChallengeLocalization = await res.json();
      setLocs((prev) => [...(prev ?? []), created]);
      setShowAdd(false);
      setAddLocale("");
      setAddName("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setAdding(false);
    }
  };

  const handleSave = async (loc: ChallengeLocalization) => {
    setSavingId(loc.id);
    try {
      const res = await fetch(`/api/asc/gamecenter/challenge-localizations/${loc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, name: editName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((prev) => prev?.map((l) => (l.id === loc.id ? { ...l, name: editName } : l)) ?? null);
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
      const res = await fetch(`/api/asc/gamecenter/challenge-localizations/${id}${params}`, {
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

  return (
    <div className="flex flex-col gap-3">
      {locs && locs.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Locale</th>
              <th className={TH}>Name</th>
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
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => {
                          setEditingId(loc.id);
                          setEditName(loc.name);
                        }}
                        className={btnSecSm}
                      >
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
                placeholder="Challenge name"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowAdd(false);
                setAddLocale("");
                setAddName("");
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
  chal: Challenge;
  bundleId: string | null;
  onBack: () => void;
  onUpdated: (updated: Challenge) => void;
  onDeleted: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function DetailView({ chal, bundleId, onBack, onUpdated, onDeleted, addToast }: DetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleUpdate = async (form: ChalFormState) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/gamecenter/challenges/${chal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, referenceName: form.referenceName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onUpdated({ ...chal, referenceName: form.referenceName });
      setEditing(false);
      addToast("Challenge updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${chal.referenceName}"?`)) return;
    setDeleting(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/challenges/${chal.id}${params}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      onDeleted();
      addToast("Challenge deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  const fields = [
    { label: "Reference Name", value: <span className={textPrimary}>{chal.referenceName}</span> },
    {
      label: "Vendor Identifier",
      value: <span className={`font-mono text-[12px] ${textSecondary}`}>{chal.vendorIdentifier}</span>,
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
            <h1 className={`text-2xl font-semibold tracking-tight ${textPrimary} truncate`}>{chal.referenceName}</h1>
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
          <ChalForm
            title="Edit Challenge"
            initial={{ referenceName: chal.referenceName, vendorIdentifier: chal.vendorIdentifier }}
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
            <LocalizationsPanel challenge={chal} bundleId={bundleId} addToast={addToast} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Challenges({ addToast }: Props) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [gcDetailId, setGcDetailId] = useState<string | null>(null);
  const [gcEnabled, setGcEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedChal, setSelectedChal] = useState<Challenge | null>(null);
  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = bundleId ? `?bundleId=${encodeURIComponent(bundleId)}` : "";
      const res = await fetch(`/api/asc/gamecenter/challenges${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setChallenges(data.challenges ?? []);
      setGcDetailId(data.gcDetailId ?? null);
      setGcEnabled(data.gcEnabled ?? false);
    } catch (err: any) {
      addToast(err.message, "error");
      setChallenges([]);
    } finally {
      setLoading(false);
    }
  }, [bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      setSelectedChal(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const handleCreate = async (form: ChalFormState) => {
    if (!gcDetailId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/asc/gamecenter/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bundleId, gcDetailId, ...form }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const created: Challenge = await res.json();
      setChallenges((prev) => [...(prev ?? []), created]);
      setShowCreate(false);
      addToast("Challenge created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setCreating(false);
    }
  };

  if (selectedChal) {
    return (
      <DetailView
        chal={selectedChal}
        bundleId={bundleId}
        onBack={() => setSelectedChal(null)}
        onUpdated={(updated) => {
          setChallenges((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
          setSelectedChal(updated);
        }}
        onDeleted={() => {
          setChallenges((prev) => prev?.filter((c) => c.id !== selectedChal.id) ?? null);
          setSelectedChal(null);
        }}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={pageTitle}>Challenges</h1>
          <p className={`text-sm mt-0.5 ${textSecondary}`}>
            Manage Game Center leaderboard sets (challenge groups) for this app.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className={btnSecSm} title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {gcEnabled && gcDetailId && !showCreate && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> New Challenge
            </button>
          )}
        </div>
      </div>

      {showCreate && gcDetailId && (
        <ChalForm title="New Challenge" onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={creating} />
      )}

      {loading && !challenges ? (
        <div className={`${cardCls} flex items-center justify-center py-12`}>
          <div className="spinner w-5 h-5" />
        </div>
      ) : gcEnabled === false ? (
        <div className={cardCls}>
          <GcNotEnabled />
        </div>
      ) : challenges && challenges.length === 0 ? (
        <div className={`${cardCls} flex flex-col items-center justify-center py-12 gap-3`}>
          <Swords className="w-10 h-10 text-[#9ca3af] dark:text-[#5c6478]" />
          <p className={`text-sm font-medium ${textSecondary}`}>No challenges yet.</p>
          {gcDetailId && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> New Challenge
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
              </tr>
            </thead>
            <tbody>
              {challenges?.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t ${borderDefault} cursor-pointer hover:bg-[#f9fafb] dark:hover:bg-[#1a1f2b] transition-colors`}
                  onClick={() => setSelectedChal(c)}
                >
                  <td className={TD}>
                    <span className={`font-medium ${textPrimary}`}>{c.referenceName}</span>
                  </td>
                  <td className={TD}>
                    <span className={`font-mono text-[12px] ${textSecondary}`}>{c.vendorIdentifier}</span>
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
