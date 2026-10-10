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
}

export default function GoogleAdsConnectModal({ onClose, onConnected, addToast }: Props) {
  const [form, setForm] = useState({ clientId: "", clientSecret: "", refreshToken: "", developerToken: "", customerId: "" });
  const [connecting, setConnecting] = useState(false);

  const onChange = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = Object.values(form).every((v) => v.trim().length > 0);

  const submit = async () => {
    setConnecting(true);
    try {
      await apiPost<{ ok?: boolean }>("/google-ads/connect", form);
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
          <p className={`text-[13px] ${textSecondary} mb-4`}>
            Marteso uses the Google Ads API to pull your campaign data. You need API access on your Google Ads
            account: create OAuth2 credentials in the{" "}
            <span className={`font-medium ${textPrimary}`}>Google Cloud Console</span>, generate a refresh token,
            and copy your <span className={`font-medium ${textPrimary}`}>developer token</span> from the Google Ads
            UI under <span className={`font-medium ${textPrimary}`}>Tools → Setup → API Center</span>.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Client ID" fullWidth>
              <input
                className={inputCls}
                type="text"
                value={form.clientId}
                onChange={(e) => onChange("clientId", e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </Field>
            <Field label="Client Secret" fullWidth>
              <input
                className={inputCls}
                type="password"
                value={form.clientSecret}
                onChange={(e) => onChange("clientSecret", e.target.value)}
                placeholder="GOCSPX-…"
              />
            </Field>
            <Field label="Refresh Token" fullWidth>
              <input
                className={inputCls}
                type="password"
                value={form.refreshToken}
                onChange={(e) => onChange("refreshToken", e.target.value)}
                placeholder="1//…"
              />
            </Field>
            <Field label="Developer Token" fullWidth>
              <input
                className={inputCls}
                type="password"
                value={form.developerToken}
                onChange={(e) => onChange("developerToken", e.target.value)}
                placeholder="…"
              />
            </Field>
            <Field label="Customer ID" hint="Your Google Ads account ID — dashes allowed." fullWidth>
              <input
                className={inputCls}
                type="text"
                inputMode="numeric"
                value={form.customerId}
                onChange={(e) => onChange("customerId", e.target.value)}
                placeholder="123-456-7890"
              />
            </Field>
          </div>

          <p className={`text-[11px] ${textMuted} mt-3 mb-5`}>
            Your secrets are encrypted at rest and only used to call the Google Ads API on your behalf.
          </p>

          <button onClick={() => submit()} disabled={!canSubmit || connecting} className={`${btnPrimary} w-full`}>
            {connecting ? "Verifying…" : "Connect"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
