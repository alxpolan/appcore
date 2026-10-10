import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { borderDefault, btnPrimary, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import Field from "../settings/Field";

interface Props {
  onClose: () => void;
  onConnected: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  oauthAvailable: boolean;
  oauthRedirectUri: string;
}

export default function GoogleAdsConnectModal({ onClose, onConnected, addToast, oauthAvailable, oauthRedirectUri }: Props) {
  const [developerToken, setDeveloperToken] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [starting, setStarting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ clientId: "", clientSecret: "", refreshToken: "", developerToken: "", customerId: "" });
  const [connecting, setConnecting] = useState(false);

  const canOAuth = developerToken.trim().length > 0 && customerId.trim().length > 0;

  const startOAuth = async () => {
    setStarting(true);
    try {
      const { url } = await apiPost<{ url: string }>("/google-ads/oauth/start", {
        developerToken: developerToken.trim(),
        customerId: customerId.trim(),
      });
      window.location.href = url;
    } catch (err: any) {
      addToast(err.message ?? "Failed to start Google sign-in", "error");
      setStarting(false);
    }
  };

  const onManualChange = (key: keyof typeof manual, value: string) => setManual((f) => ({ ...f, [key]: value }));
  const canManual = Object.values(manual).every((v) => v.trim().length > 0);

  const submitManual = async () => {
    setConnecting(true);
    try {
      await apiPost<{ ok?: boolean }>("/google-ads/connect", manual);
      addToast("Connected to Google Ads.", "success");
      onConnected();
      onClose();
    } catch (err: any) {
      addToast(err.message ?? "Failed to connect Google Ads", "error");
    } finally {
      setConnecting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
          <h2 className={`text-lg font-semibold ${textPrimary}`}>Connect Google Ads</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {oauthAvailable ? (
            <>
              <p className={`text-[13px] ${textSecondary} mb-4`}>
                Enter your developer token and customer ID, then sign in with the Google account that has access
                to your Google Ads account. Marteso fetches and stores the access tokens for you — no manual
                token juggling.
              </p>
              <div className="grid grid-cols-1 gap-4">
                <Field
                  label="Developer Token"
                  hint="Google Ads UI → Tools → Setup → API Center. Needs API access on your account."
                >
                  <input
                    className={inputCls}
                    type="password"
                    value={developerToken}
                    onChange={(e) => setDeveloperToken(e.target.value)}
                    placeholder="…"
                  />
                </Field>
                <Field label="Customer ID" hint="Your Google Ads account ID — dashes allowed.">
                  <input
                    className={inputCls}
                    type="text"
                    inputMode="numeric"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    placeholder="123-456-7890"
                  />
                </Field>
              </div>
              <button
                onClick={() => startOAuth()}
                disabled={!canOAuth || starting}
                className={`${btnPrimary} w-full mt-5`}
              >
                {starting ? "Redirecting to Google…" : "Connect with Google"}
              </button>
              <div className="mt-4 text-center">
                <button onClick={() => setShowManual((v) => !v)} className={`text-[12px] font-medium text-[#595DD2] hover:underline`}>
                  {showManual ? "Hide manual setup" : "Or connect manually with your own OAuth client"}
                </button>
              </div>
            </>
          ) : (
            <p className={`text-[13px] ${textSecondary} mb-4`}>
              One-click sign-in isn't configured on this server yet. To enable it, create a{" "}
              <span className={`font-medium ${textPrimary}`}>Web application</span> OAuth client with the Google
              Ads API enabled, register this redirect URI on it, and set{" "}
              <span className={`font-medium ${textPrimary}`}>GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET</span>:
              <code className="block mt-2 text-[11px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] px-2 py-1.5 rounded-lg break-all">
                {oauthRedirectUri}
              </code>
            </p>
          )}

          {(!oauthAvailable || showManual) && (
            <div className={oauthAvailable ? "mt-4 pt-4 border-t border-[#f3f4f6] dark:border-[#2a2f3d]" : ""}>
              <p className={`text-[13px] ${textSecondary} mb-4`}>
                Use your own OAuth credentials: create them in the Google Cloud Console, generate a refresh
                token (e.g. via the OAuth Playground with your own credentials), and enter everything below.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Client ID" fullWidth>
                  <input
                    className={inputCls}
                    type="text"
                    value={manual.clientId}
                    onChange={(e) => onManualChange("clientId", e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                  />
                </Field>
                <Field label="Client Secret" fullWidth>
                  <input
                    className={inputCls}
                    type="password"
                    value={manual.clientSecret}
                    onChange={(e) => onManualChange("clientSecret", e.target.value)}
                    placeholder="GOCSPX-…"
                  />
                </Field>
                <Field label="Refresh Token" fullWidth>
                  <input
                    className={inputCls}
                    type="password"
                    value={manual.refreshToken}
                    onChange={(e) => onManualChange("refreshToken", e.target.value)}
                    placeholder="1//…"
                  />
                </Field>
                <Field label="Developer Token" fullWidth>
                  <input
                    className={inputCls}
                    type="password"
                    value={manual.developerToken}
                    onChange={(e) => onManualChange("developerToken", e.target.value)}
                    placeholder="…"
                  />
                </Field>
                <Field label="Customer ID" hint="Dashes allowed." fullWidth>
                  <input
                    className={inputCls}
                    type="text"
                    inputMode="numeric"
                    value={manual.customerId}
                    onChange={(e) => onManualChange("customerId", e.target.value)}
                    placeholder="123-456-7890"
                  />
                </Field>
              </div>

              <p className={`text-[11px] ${textMuted} mt-3 mb-5`}>
                Your secrets are encrypted at rest and only used to call the Google Ads API on your behalf.
              </p>

              <button
                onClick={() => submitManual()}
                disabled={!canManual || connecting}
                className={`${btnPrimary} w-full ${oauthAvailable ? "" : ""}`}
              >
                {connecting ? "Verifying…" : "Connect"}
              </button>
            </div>
          )}

          {oauthAvailable && !showManual && (
            <p className={`text-[11px] ${textMuted} mt-4 text-center`}>
              Tokens are encrypted at rest and only used for Google Ads API calls.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
