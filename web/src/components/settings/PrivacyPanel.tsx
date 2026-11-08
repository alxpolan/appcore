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

interface SessionStatus {
  configured: boolean;
  valid: boolean;
  checkedAt: string | null;
  reason: string | null;
}

export default function PrivacyPanel({ bundleId, addToast }: PrivacyPanelProps) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [loginStage, setLoginStage] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [loginCode, setLoginCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
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

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/asc/privacy/session", { headers: authHeaders() });

      if (res.ok) setSession(await res.json());
    } catch {
      return;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await loadSession();
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

      if (err.message === "APPLE_SESSION_EXPIRED") await loadSession();
    } finally {
      setLoading(false);
    }
  }, [bundleId, loadSession]);

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

  const pollLogin = useCallback(async (id: string) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const res = await fetch(`/api/asc/privacy/session/login/${id}`, { headers: authHeaders() });

        if (!res.ok) break;
        const state = await res.json();
        setLoginStage(state.stage);
        setLoginMessage(state.message ?? null);

        if (state.stage === "done" || state.stage === "failed") {
          if (state.stage === "done") {
            setShowLogin(false);
            setLoginPassword("");
            setLoginCode("");
            setLoginId(null);
            await loadSession();
            await load();
            addToast("Apple session renewed", "success");
          } else if (state.message) {
            addToast(state.message, "error");
          }

          break;
        }
      } catch {
        break;
      }
    }

    setLoginBusy(false);
  }, [loadSession, load, addToast]);

  const startLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) return;
    setLoginBusy(true);
    setLoginMessage(null);
    try {
      const res = await fetch("/api/asc/privacy/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLoginId(json.id);
      setLoginStage(json.stage);
      void pollLogin(json.id);
    } catch (err: any) {
      addToast(err.message, "error");
      setLoginBusy(false);
    }
  };

  const submitCode = async () => {
    if (!loginId || !loginCode.trim()) return;
    try {
      const res = await fetch(`/api/asc/privacy/session/login/${loginId}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ code: loginCode.trim() }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLoginCode("");
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  const closeLogin = async () => {
    if (loginId && loginStage !== "done") {
      await fetch(`/api/asc/privacy/session/login/${loginId}/cancel`, {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => undefined);
    }

    setShowLogin(false);
    setLoginId(null);
    setLoginStage(null);
    setLoginPassword("");
    setLoginCode("");
    setLoginBusy(false);
  };

  const openLogin = () => {
    setLoginId(null);
    setLoginStage(null);
    setLoginMessage(null);
    setLoginPassword("");
    setLoginCode("");
    setShowLogin(true);
  };

  const loginModal = showLogin && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeLogin}>
      <div
        className={`w-full max-w-sm rounded-2xl border ${borderDefault} bg-white dark:bg-[#1c2028] p-5 flex flex-col gap-2`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className={`text-[13px] font-semibold ${textPrimary}`}>Bei Apple anmelden</p>
        <p className={`text-[12px] ${textSecondary}`}>
          Erneuert die Apple-Web-Session für den Datenschutzbogen. Das Passwort wird nur für diesen Login verwendet
          und nicht gespeichert.
        </p>
        {loginStage == null && (
          <>
            <input
              className={inputCls}
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Apple-ID (E-Mail)"
              autoComplete="username"
            />
            <input
              className={inputCls}
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Passwort"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") void startLogin();
              }}
            />
          </>
        )}
        {loginStage === "2fa" && (
          <>
            <p className={`text-[12px] ${textSecondary}`}>
              {loginMessage ?? "Gib den 6-stelligen Code von deinem vertrauenswürdigen Gerät ein."}
            </p>
            <input
              className={inputCls}
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCode();
              }}
            />
          </>
        )}
        {loginStage != null && loginStage !== "2fa" && (
          <p className={`text-[12px] ${textSecondary}`}>
            {loginStage === "password" ? "Melde an…" : (loginMessage ?? loginStage)}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={closeLogin} className={btnSecSm}>
            <X className="w-3 h-3" />
            Abbrechen
          </button>
          {loginStage == null && (
            <button onClick={startLogin} disabled={loginBusy || !loginEmail.trim() || !loginPassword} className={btnSecSm}>
              {loginBusy ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              Anmelden
            </button>
          )}
          {loginStage === "2fa" && (
            <button onClick={submitCode} disabled={!loginCode.trim()} className={btnSecSm}>
              <Check className="w-3 h-3" />
              Bestätigen
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (loading && !usages) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  if (unavailable) {
    return (
      <>
      <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5`}>
        <h2 className={`text-[13px] font-bold uppercase tracking-widest ${textMuted} mb-1`}>App Privacy</h2>
        <p className={`text-[13px] ${textSecondary} mb-3`}>{unavailable}</p>
        <button onClick={openLogin} className={btnSecSm}>
          <Check className="w-3 h-3" />
          Anmelden
        </button>
      </div>
      {loginModal}
      </>
  );
  }

  return (
    <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <h2 className={`text-[13px] font-bold uppercase tracking-widest ${textMuted}`}>
          App Privacy
          {session != null && (
            <span
              className={`ml-2 text-[11px] font-medium normal-case tracking-normal ${
                session.valid ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {session.valid ? "Session active" : session.configured ? "Session expired" : "No session"}
            </span>
          )}
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
        <div className="flex items-center gap-3">
          {session != null && !session.valid && (
            <button
              onClick={openLogin}
              className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
            >
              <Check className="w-3.5 h-3.5" /> Anmelden
            </button>
          )}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
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
      {loginModal}
    </div>
  );
}
