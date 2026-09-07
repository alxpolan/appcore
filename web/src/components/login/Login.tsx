import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import AuthHeader from "./AuthHeader";
import type { AuthUser } from "../../types";
import { borderDefault, btnPrimary, inputCls, textMuted, textPrimary } from "../../styles";
import { usePostHog } from "@posthog/react";

export type { AuthUser };

interface Props {
  onAuth: (user: AuthUser) => void;
  mode?: "login" | "signup";
}

async function passkeySignIn(email: string): Promise<{ user: AuthUser }> {
  const { startAuthentication } = await import("@simplewebauthn/browser");

  const optRes = await fetch("/api/auth/passkey/login-options", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email || undefined }),
  });

  const optData = await optRes.json();
  if (!optRes.ok) throw new Error(optData.error ?? "Failed to start passkey auth");

  const assertion = await startAuthentication({ optionsJSON: optData.options });
  const verifyRes = await fetch("/api/auth/passkey/login-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: optData.sessionId,
      assertionResponse: assertion,
    }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(verifyData.error ?? "Passkey verification failed");

  return verifyData;
}

async function passkeyRegister(): Promise<void> {
  const { startRegistration } = await import("@simplewebauthn/browser");

  const optRes = await fetch("/api/auth/passkey/register-options", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  const optData = await optRes.json();
  if (!optRes.ok) throw new Error(optData.error ?? "Failed to start passkey registration");

  const attestation = await startRegistration({ optionsJSON: optData.options });

  const verifyRes = await fetch("/api/auth/passkey/register-verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationResponse: attestation }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(verifyData.error ?? "Passkey registration failed");
}

export default function Login({ onAuth, mode = "login" }: Props) {
  const navigate = useNavigate();
  const posthog = usePostHog();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<{ user: AuthUser } | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState<{ email: string } | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  const finishAuth = (user: AuthUser) => {
    onAuth(user);
  };

  const handleResend = async () => {
    if (!verifySent) return;
    setResendState("sending");

    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifySent.email }),
      });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body: Record<string, string> = { email, password };
      if (mode === "signup" && name) body.name = name;
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.verificationRequired) {
        posthog?.capture("email_verification_required", { mode });
        setResendState("idle");
        setVerifySent({ email: data.email ?? email });
        return;
      }

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (mode === "signup") {
        posthog?.identify(data.user.id, { email: data.user.email, name: data.user.name ?? undefined });
        posthog?.capture("user_signed_up", { method: "email" });
        finishAuth(data.user);
      } else {
        posthog?.identify(data.user.id, { email: data.user.email, name: data.user.name ?? undefined });
        posthog?.capture("user_logged_in", { method: "email" });

        if (data.hasPasskeys) {
          finishAuth(data.user);
        } else {
          setPendingAuth({ user: data.user });
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await passkeySignIn(email);
      posthog?.identify(data.user.id, { email: data.user.email, name: data.user.name ?? undefined });
      posthog?.capture("user_logged_in", { method: "passkey" });
      finishAuth(data.user);
    } catch (err: any) {
      // User dismissed/aborted the system passkey dialog (or it timed out) —
      // that's a deliberate cancel, not an error worth surfacing.
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
        posthog?.capture("passkey_login_cancelled");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/github/start");
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to start GitHub sign-in");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/google/start");
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to start Google sign-in");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/demo", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Demo login failed");
      posthog?.identify(data.user.id, { email: data.user.email, name: data.user.name ?? undefined });
      posthog?.capture("user_logged_in", { method: "demo" });
      finishAuth(data.user);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleAddPasskey = async () => {
    if (!pendingAuth) return;
    setPasskeyError(null);
    setPasskeyLoading(true);
    try {
      await passkeyRegister();
      posthog?.capture("passkey_added");

      finishAuth(pendingAuth.user);
    } catch (err: any) {
      // Cancelled/timed-out dialog or an already-synced passkey — none of these
      // are real errors; just continue without nagging the user.
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
        posthog?.capture("passkey_skipped");
        finishAuth(pendingAuth.user);
      } else if (err?.name === "InvalidStateError") {
        posthog?.capture("passkey_already_exists");
        finishAuth(pendingAuth.user);
      } else {
        setPasskeyError(err.message);
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  if (verifySent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117]">
        <div className={`w-[400px] bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-10`}>
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-[#fff0f2] dark:bg-[#2a1520] flex items-center justify-center">
              <KeyRound className="text-[#595DD2]" size={24} />
            </div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Confirm your email</h2>
            <p className="text-sm text-[#6b7280] dark:text-[#8b9ab0] leading-relaxed">
              We sent a confirmation link to <strong className={textPrimary}>{verifySent.email}</strong>. Click it to
              activate your account.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {resendState === "sent" ? (
              <p className={`text-center text-sm ${textMuted}`}>New link sent. Check your inbox.</p>
            ) : (
              <button
                onClick={handleResend}
                disabled={resendState === "sending"}
                className={`${btnPrimary} w-full justify-center`}
              >
                {resendState === "sending" ? "Sending…" : "Resend link"}
              </button>
            )}
            <button
              onClick={() => {
                setVerifySent(null);
                setResendState("idle");
                navigate("/login");
              }}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-[#6b7280] dark:text-[#8b9ab0] hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pendingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117]">
        <div className={`w-[400px] bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-10`}>
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-[#fff0f2] dark:bg-[#2a1520] flex items-center justify-center">
              <PasskeyIcon className="text-[#595DD2]" size={24} />
            </div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Add a Passkey?</h2>
            <p className="text-sm text-[#6b7280] dark:text-[#8b9ab0] leading-relaxed">
              Sign in faster next time using Face ID, Touch ID, or your device PIN — no password needed.
            </p>
          </div>

          {passkeyError && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-2.5 mb-4">
              {passkeyError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleAddPasskey}
              disabled={passkeyLoading}
              className={`${btnPrimary} w-full justify-center`}
            >
              {passkeyLoading ? "Setting up…" : "Set up Passkey"}
            </button>
            <button
              onClick={() => {
                posthog?.capture("passkey_skipped");
                finishAuth(pendingAuth.user);
              }}
              disabled={passkeyLoading}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-[#6b7280] dark:text-[#8b9ab0] hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117]">
      <div className={`w-[400px] bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-10`}>
        <AuthHeader mode={mode} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <label className="flex flex-col gap-1.5">
              <span className={`text-sm font-medium ${textPrimary}`}>Name</span>
              <input
                className={inputCls}
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className={`text-sm font-medium ${textPrimary}`}>Email</span>
            <input
              className={inputCls}
              type="email"
              placeholder="you@example.com"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={`text-sm font-medium ${textPrimary}`}>Password</span>
            <input
              className={inputCls}
              type="password"
              placeholder="••••••••"
              value={password}
              required
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-2.5">{error}</div>
          )}
          <button type="submit" disabled={loading} className={`${btnPrimary} w-full justify-center mt-1`}>
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[#eef0f3] dark:bg-[#2a2f3d]" />
          <span className={`text-xs ${textMuted}`}>or</span>
          <div className="flex-1 h-px bg-[#eef0f3] dark:bg-[#2a2f3d]" />
        </div>
        {mode === "login" && (
          <button
            type="button"
            disabled={loading}
            onClick={handlePasskeyLogin}
            className={`w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm font-medium ${textPrimary} hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50`}
          >
            <PasskeyIcon />
            Sign in with Passkey
          </button>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={handleGitHubLogin}
          className={`mt-2 w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm font-medium ${textPrimary} hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50`}
        >
          <GitHubIcon />
          {mode === "login" ? "Sign in with GitHub" : "Continue with GitHub"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleLogin}
          className={`mt-2 w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm font-medium ${textPrimary} hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50`}
        >
          <GoogleIcon />
          {mode === "login" ? "Sign in with Google" : "Continue with Google"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            disabled={loading}
            onClick={handleDemoLogin}
            className={`mt-2 w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border border-dashed ${borderDefault} bg-transparent text-sm font-medium ${textMuted} hover:bg-[#f8f9fb] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50`}
          >
            Try Demo
          </button>
        )}

        <div className={`mt-5 text-center text-sm ${textMuted}`}>
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <button
                className="text-[#595DD2] font-medium hover:underline"
                onClick={() => {
                  setError(null);
                  navigate("/signup");
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                className="text-[#595DD2] font-medium hover:underline"
                onClick={() => {
                  setError(null);
                  navigate("/login");
                }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PasskeyIcon({ className = "text-current", size = 18 }: { className?: string; size?: number }) {
  return <KeyRound width={size} height={size} className={className} />;
}

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.67 5.57.67 11.84c0 5.01 3.24 9.25 7.74 10.75.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.15.69-3.81-1.52-3.81-1.52-.52-1.31-1.27-1.66-1.27-1.66-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.51-.29-5.15-1.26-5.15-5.59 0-1.23.44-2.24 1.17-3.04-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.16.92-.26 1.9-.39 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.47 3.15-1.16 3.15-1.16.62 1.57.23 2.73.11 3.02.73.8 1.17 1.81 1.17 3.04 0 4.34-2.65 5.3-5.17 5.58.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.79.55 4.49-1.5 7.73-5.74 7.73-10.75C23.33 5.57 18.27.5 12 .5z" />
    </svg>
  );
}

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
