import { useState, useCallback, useEffect } from "react";
import { Plus, Trash2, X, Check } from "lucide-react";
import { authHeaders } from "../../hooks/useApi";
import {
  TD,
  TH,
  borderDefault,
  btnSecSm,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import type { AppDataUsage, AppDataUsageCategory, DataUsagePublishState } from "../../types";

interface PrivacyPanelProps {
  bundleId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function titleCase(id: string | null) {
  if (!id) return "—";

  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function groupCategories(categories: AppDataUsageCategory[]) {
  const groups = new Map<string, AppDataUsageCategory[]>();

  for (const category of categories) {
    const key = category.groupingId ?? "OTHER";
    const list = groups.get(key) ?? [];

    list.push(category);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([groupingId, list]) => ({ groupingId, categories: list }))
    .sort((a, b) => a.groupingId.localeCompare(b.groupingId));
}

export default function PrivacyPanel({ bundleId, addToast }: PrivacyPanelProps) {
  const [usages, setUsages] = useState<AppDataUsage[] | null>(null);
  const [publishState, setPublishState] = useState<DataUsagePublishState | null>(null);
  const [categories, setCategories] = useState<AppDataUsageCategory[]>([]);
  const [purposes, setPurposes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [dataProtectionId, setDataProtectionId] = useState("DATA_NOT_LINKED_TO_YOU");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usagesRes, catalogsRes] = await Promise.all([
        fetch(`/api/asc/privacy/data-usages?bundleId=${encodeURIComponent(bundleId)}`, {
          headers: authHeaders(),
        }),
        fetch(`/api/asc/privacy/catalogs?bundleId=${encodeURIComponent(bundleId)}`, {
          headers: authHeaders(),
        }),
      ]);

      if (!usagesRes.ok) throw new Error((await usagesRes.json()).error ?? `HTTP ${usagesRes.status}`);
      if (!catalogsRes.ok) throw new Error((await catalogsRes.json()).error ?? `HTTP ${catalogsRes.status}`);
      const usagesJson = await usagesRes.json();
      setUsages(usagesJson.usages ?? usagesJson);
      setPublishState(usagesJson.publishState ?? null);
      const catalogs = await catalogsRes.json();
      setCategories(catalogs.categories ?? []);
      setPurposes(catalogs.purposes ?? []);
      setUnavailable(null);
    } catch (err: any) {
      addToast(err.message, "error");
      setUsages([]);
      setUnavailable(err.message);
    } finally {
      setLoading(false);
    }
  }, [bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!categoryId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/asc/privacy/data-usages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          categoryId,
          purposeId: purposeId || undefined,
          dataProtectionId: dataProtectionId.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setShowForm(false);
      setCategoryId("");
      setPurposeId("");
      await load();
      addToast("Data usage added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this data usage?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/asc/privacy/data-usages/${id}?bundleId=${encodeURIComponent(bundleId)}`,
        { method: "DELETE", headers: authHeaders() },
      );

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setUsages((list) => list?.filter((usage) => usage.id !== id) ?? null);
      addToast("Data usage removed", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !usages) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5`}>
        <h2 className={`text-[13px] font-bold uppercase tracking-widest ${textMuted} mb-1`}>App Privacy</h2>
        <p className={`text-[13px] ${textSecondary}`}>{unavailable}</p>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <h2 className={`text-[13px] font-bold uppercase tracking-widest ${textMuted}`}>
          App Privacy
          {publishState != null && (
            <span
              className={`ml-2 text-[11px] font-medium normal-case tracking-normal ${
                publishState.published ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {publishState.published ? "Published" : "Unpublished changes"}
            </span>
          )}
        </h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
      <p className={`text-[13px] ${textSecondary} mb-3`}>
        Data usages for the App Store privacy label, managed through Apple&apos;s web API.
      </p>

      {(!usages || usages.length === 0) && !showForm ? (
        <p className={`text-[12px] ${textMuted}`}>No data usages declared.</p>
      ) : (
        usages &&
        usages.length > 0 && (
          <table className="w-full mb-2">
            <thead>
              <tr>
                <th className={TH}>Category</th>
                <th className={TH}>Purpose</th>
                <th className={TH}>Protection</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {usages.map((usage) => (
                <tr
                  key={usage.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={`${TD} font-medium ${textPrimary}`}>{titleCase(usage.categoryId)}</td>
                  <td className={`${TD} ${textSecondary}`}>{titleCase(usage.purposeId)}</td>
                  <td className={`${TD} ${textSecondary}`}>{titleCase(usage.dataProtectionId)}</td>
                  <td className={`${TD} text-right`}>
                    <button
                      onClick={() => remove(usage.id)}
                      disabled={deletingId === usage.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                    >
                      {deletingId === usage.id ? (
                        <div className="spinner !w-3 !h-3" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {showForm && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Category</label>
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select…</option>
                {groupCategories(categories).map((group) => (
                  <optgroup key={group.groupingId} label={titleCase(group.groupingId)}>
                    {group.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {titleCase(c.id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Purpose (optional)</label>
              <select className={inputCls} value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
                <option value="">None</option>
                {purposes.map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Protection (optional)</label>
              <input
                className={inputCls}
                value={dataProtectionId}
                onChange={(e) => setDataProtectionId(e.target.value)}
                placeholder="DATA_NOT_LINKED_TO_YOU"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setCategoryId("");
                setPurposeId("");
              }}
              className={btnSecSm}
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            <button onClick={save} disabled={saving || !categoryId} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              Add Usage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
