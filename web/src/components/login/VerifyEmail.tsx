import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePostHog } from "@posthog/react";
import type { AuthUser } from "../../types";
import { borderDefault, btnPrimary, inputCls, textMuted, textPrimary } from "../../styles";

type Status = "verifying" | "success" | "error";

export default function VerifyEmail({ onAuth }: { onAuth: (u: AuthUser) => void }) {
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [params] = useSearchParams();
  const token = params.get("token");

  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token.");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        posthog?.identify(data.user.id, { email: data.user.email, name: data.user.name ?? undefined });
        posthog?.capture("email_verified");
        setStatus("success");
        onAuth(data.user);
        navigate("/dashboard", { replace: true });
      } catch (err: any) {
        setStatus("error");
        setError(err.message ?? "Verification failed");
      }
    })();
  }, [token, onAuth, navigate, posthog]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117] px-4">
      <div className={`w-[400px] bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-10`}>
        <img src="/logo-wordmark.svg" alt="Marteso" className="h-[30px] w-auto mb-8 mx-auto" />

        {status === "verifying" && (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="spinner" />
            <p className={`text-sm ${textMuted}`}>Confirming your email…</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center text-center gap-2">
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Email confirmed</h2>
            <p className={`text-sm ${textMuted}`}>Taking you to your dashboard…</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <h2 className={`text-lg font-semibold ${textPrimary} mb-1`}>Link expired or invalid</h2>
              <p className={`text-sm ${textMuted}`}>{error}</p>
            </div>

            {resendState === "sent" ? (
              <div className="bg-[#eef0fd] dark:bg-[#23253f] border border-[#595DD2]/20 rounded-xl px-4 py-3 text-center">
                <p className={`text-sm ${textPrimary}`}>
                  If an account exists for that email, a fresh confirmation link is on its way.
                </p>
              </div>
            ) : (
              <form onSubmit={handleResend} className="flex flex-col gap-3">
                <input
                  className={inputCls}
                  type="email"
                  placeholder="you@example.com"
                  value={resendEmail}
                  required
                  onChange={(e) => setResendEmail(e.target.value)}
                  autoComplete="email"
                />
                <button
                  type="submit"
                  disabled={resendState === "sending"}
                  className={`${btnPrimary} w-full justify-center`}
                >
                  {resendState === "sending" ? "Sending…" : "Send a new link"}
                </button>
              </form>
            )}

            <button onClick={() => navigate("/login")} className={`text-center text-sm ${textMuted} hover:underline`}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
