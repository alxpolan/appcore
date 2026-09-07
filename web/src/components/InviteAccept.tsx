import { useState, useEffect } from "react";
import { textPrimary } from "../styles";
import { useParams, useNavigate } from "react-router-dom";
import type { AuthUser } from "../types";

interface InviteInfo {
  email: string;
  role: string;
  teamName: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export default function InviteAccept({ onAuth }: { onAuth: (u: AuthUser) => void }) {
  const { token: routeToken } = useParams<{ token: string }>();
  const hashMatch = window.location.hash.match(/^#\/invite\/([a-f0-9]+)$/);
  const token = routeToken ?? hashMatch?.[1];
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/team/invite/${token}`)
      .then((r) =>
        r.ok
          ? r.json()
          : r.json().then((e: any) => {
            throw new Error(e.error);
          }),
      )
      .then((d: InviteInfo) => {
        setInvite(d);
        setEmail(d.email);
      })
      .catch((e) => setLoadError(e.message));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = mode === "signup" ? { email, password, name, inviteToken: token } : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      let finalUser = json.user;

      if (mode === "login" && token) {
        const acceptRes = await fetch("/api/auth/accept-invite", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const acceptJson = await acceptRes.json();
        if (!acceptRes.ok) throw new Error(acceptJson.error ?? "Failed to accept invite");
        finalUser = { ...json.user, teamId: acceptJson.teamId };
      }

      onAuth(finalUser);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117] px-4">
        <div className="max-w-sm w-full text-center">
          <img src="/logo-wordmark.svg" alt="Marteso" className="h-[30px] w-auto mb-8 mx-auto" />
          <div className="p-6 bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl">
            <p className="text-sm font-semibold text-[#1a1a2e] dark:text-[#e8eaf0] mb-1">Invalid invitation</p>
            <p className="text-xs text-gray-400 dark:text-[#5c6478]">{loadError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117]">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117] px-4">
      <div className="max-w-sm w-full">
        <img src="/logo-wordmark.svg" alt="Marteso" className="h-[30px] w-auto mb-8 mx-auto" />

        <div className="mb-4 p-4 bg-[#eef0fd] dark:bg-[#23253f] border border-[#595DD2]/20 rounded-xl text-center">
          <p className="text-sm font-semibold text-[#1a1a2e] dark:text-[#e8eaf0]">You've been invited</p>
          <p className="text-sm text-gray-600 dark:text-[#8b93a5] mt-0.5">
            to join team <strong className="text-[#595DD2]">{invite.teamName}</strong> as{" "}
            <strong className="text-[#595DD2]">{ROLE_LABELS[invite.role] ?? invite.role}</strong>
          </p>
        </div>

        <div className="bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-2xl p-6">
          <div className="flex rounded-lg bg-[#f7f8fa] dark:bg-[#252b38] p-0.5 mb-5">
            {(["signup", "login"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${mode === m ? "bg-white dark:bg-[#1c2028] text-[#1a1a2e] dark:text-[#e8eaf0] shadow-sm" : "text-gray-500 dark:text-[#5c6478]"}`}
              >
                {m === "signup" ? "Sign up" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`px-3 py-2.5 text-sm rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] bg-[#f7f8fa] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2]`}
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`px-3 py-2.5 text-sm rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] bg-[#f7f8fa] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2]`}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={`px-3 py-2.5 text-sm rounded-xl border border-[#e5e7eb] dark:border-[#2a2f3d] bg-[#f7f8fa] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#595DD2]`}
            />
            {error && <p className="text-xs text-[#595DD2]">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 py-2.5 rounded-xl bg-[#595DD2] text-white text-sm font-semibold hover:bg-[#484CBE] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "…" : mode === "signup" ? "Sign up & Join" : "Sign in & Join"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
