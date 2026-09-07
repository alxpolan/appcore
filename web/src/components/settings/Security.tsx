import { useState, useEffect, useCallback } from "react";
import { KeyRound, Trash2, Plus, Lock } from "lucide-react";
import { authHeaders } from "../../hooks/useApi";
import {
  borderDefault,
  btnPrimary,
  btnSecondary,
  cardCls,
  inputCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";

interface Passkey {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface MeResponse {
  passwordSet: boolean;
  passkeys: Passkey[];
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Security({ addToast }: Props) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: MeResponse = await res.json();
      setPasskeys(data.passkeys ?? []);
      setHasPassword(!!data.passwordSet);
    } catch (err: any) {
      addToast(err.message ?? "Failed to load security info", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const registerPasskey = async (name: string | null) => {
    setAdding(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");

      const optRes = await fetch("/api/auth/passkey/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });

      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error ?? "Failed to start passkey registration");

      const attestation = await startRegistration({ optionsJSON: optData.options });

      const verifyRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ registrationResponse: attestation, passkeyName: name }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Passkey registration failed");

      addToast("Passkey added", "success");
      setNewPasskeyName("");
      setShowNameInput(false);
      await load();
    } catch (err: any) {
      if (err?.name === "InvalidStateError") {
        // The authenticator (e.g. iCloud Keychain, shared across the user's
        // Apple devices) already holds a passkey for this account, so it
        // refuses to register a duplicate. This is expected — not a failure.
        addToast("This device already has a passkey for your account.", "info");
        setShowNameInput(false);
        setNewPasskeyName("");
      } else if (err?.name === "NotAllowedError") {
        // User dismissed the system prompt or it timed out — stay quiet-ish.
        addToast("Passkey setup was cancelled.", "info");
      } else {
        addToast(err.message ?? "Failed to add passkey", "error");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleAddPasskey = () => {
    const name = newPasskeyName.trim() || null;
    registerPasskey(name);
  };

  const handleDeletePasskey = async (id: string) => {
    if (!window.confirm("Remove this passkey? You won't be able to sign in with it anymore.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/auth/passkey/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete passkey");
      addToast("Passkey removed", "success");
      await load();
    } catch (err: any) {
      addToast(err.message ?? "Failed to delete passkey", "error");
    } finally {
      setDeleting(null);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      addToast("New password must be at least 8 characters", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      addToast("Passwords don't match", "error");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPassword : undefined,
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update password");
      addToast(hasPassword ? "Password updated" : "Password set", "success");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setHasPassword(true);
    } catch (err: any) {
      addToast(err.message ?? "Failed to update password", "error");
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading security…
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className={`${pageTitle} mb-1`}>Security</h1>
      <p className="text-sm text-[#6b7280] dark:text-[#5c6478] mb-8">Manage your passkeys and password.</p>

      <div className={`${cardCls} mb-6`}>
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-xl border ${borderDefault} flex items-center justify-center shrink-0`}>
            <KeyRound className="w-5 h-5 text-[#595DD2]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[15px] font-semibold ${textPrimary}`}>Passkeys</div>
            <div className={`text-[12px] ${textMuted} mt-0.5`}>Sign in with Face ID, Touch ID, or your device PIN.</div>
          </div>
          {!showNameInput && (
            <button type="button" className={btnSecondary} disabled={adding} onClick={() => setShowNameInput(true)}>
              <Plus className="w-3.5 h-3.5" />
              Add passkey
            </button>
          )}
        </div>

        {showNameInput && (
          <div
            className={`mb-4 p-4 rounded-xl border ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38] flex flex-col gap-3`}
          >
            <label className={`text-[12px] font-medium ${textSecondary}`}>
              Passkey name <span className={textMuted}>(optional)</span>
            </label>
            <input
              className={inputCls}
              value={newPasskeyName}
              onChange={(e) => setNewPasskeyName(e.target.value)}
              placeholder="e.g. MacBook Pro, iPhone"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddPasskey();
                }
                if (e.key === "Escape") {
                  setShowNameInput(false);
                  setNewPasskeyName("");
                }
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className={btnSecondary}
                disabled={adding}
                onClick={() => {
                  setShowNameInput(false);
                  setNewPasskeyName("");
                }}
              >
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={adding} onClick={handleAddPasskey}>
                {adding ? "Setting up…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {passkeys && passkeys.length === 0 ? (
          <div className={`text-[13px] ${textMuted} text-center py-6 border border-dashed ${borderDefault} rounded-xl`}>
            No passkeys yet. Add one to sign in faster next time.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {passkeys?.map((pk) => (
              <li
                key={pk.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028]`}
              >
                <div className={`w-9 h-9 rounded-lg border ${borderDefault} flex items-center justify-center shrink-0`}>
                  <KeyRound className="w-4 h-4 text-gray-400 dark:text-[#5c6478]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-medium ${textPrimary} truncate`}>
                    {pk.name || "Unnamed passkey"}
                  </div>
                  <div className={`text-[11px] ${textMuted} mt-0.5`}>
                    Added {formatDate(pk.createdAt)}
                    {pk.lastUsedAt ? ` · Last used ${formatDate(pk.lastUsedAt)}` : " · Never used"}
                  </div>
                </div>
                <button
                  type="button"
                  className="p-2 rounded-lg text-gray-400 dark:text-[#5c6478] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  disabled={deleting === pk.id}
                  onClick={() => handleDeletePasskey(pk.id)}
                  aria-label="Remove passkey"
                  title="Remove passkey"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-xl border ${borderDefault} flex items-center justify-center shrink-0`}>
            <Lock className="w-5 h-5 text-[#595DD2]" />
          </div>
          <div className="min-w-0">
            <div className={`text-[15px] font-semibold ${textPrimary}`}>
              {hasPassword ? "Change password" : "Set password"}
            </div>
            <div className={`text-[12px] ${textMuted} mt-0.5`}>
              {hasPassword
                ? "Use a strong password with at least 8 characters."
                : "You signed in via SSO. Set a password to enable email + password sign-in."}
            </div>
          </div>
        </div>

        <form onSubmit={handleSavePassword} className="flex flex-col gap-4">
          {hasPassword && (
            <div>
              <label className="block text-[12px] font-medium text-[#374151] dark:text-[#c4cad8] mb-1.5">
                Current password
              </label>
              <input
                className={inputCls}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-[#374151] dark:text-[#c4cad8] mb-1.5">
              New password
            </label>
            <input
              className={inputCls}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] dark:text-[#c4cad8] mb-1.5">
              Confirm new password
            </label>
            <input
              className={inputCls}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex justify-end pt-1">
            <button type="submit" className={btnPrimary} disabled={savingPassword}>
              {savingPassword ? "Saving…" : hasPassword ? "Update password" : "Set password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
