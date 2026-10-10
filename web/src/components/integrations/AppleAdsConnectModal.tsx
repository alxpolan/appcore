import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { borderDefault, btnPrimary, inputCls, textareaCls, textMuted, textPrimary, textSecondary } from "../../styles";
import Field from "../settings/Field";

interface Props {
  onClose: () => void;
  onConnected: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AppleAdsConnectModal({ onClose, onConnected, addToast }: Props) {
  const [form, setForm] = useState({ clientId: "", teamId: "", keyId: "", privateKey: "" });
  const [connecting, setConnecting] = useState(false);

  const onChange = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = Object.values(form).every((v) => v.trim().length > 0);

  const submit = async () => {
    setConnecting(true);
    try {
      await apiPost<{ ok?: boolean }>("/apple-ads/connect", form);
      addToast("Connected to Apple Search Ads — now map a campaign group per app below.", "success");
      onConnected();
      onClose();
    } catch (err: any) {
      addToast(err.message ?? "Failed to connect Apple Search Ads", "error");
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
          <h2 className={`text-lg font-semibold ${textPrimary}`}>Connect Apple Search Ads</h2>
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
                Marteso uses Apple's Search Ads API to pull your campaign data. Apple API keys work differently
                from most services:{" "}
                <span className={`font-medium ${textPrimary}`}>you generate the key pair yourself</span> and only
                upload the public half to Apple.
              </p>

              <ol className={`text-[13px] ${textSecondary} space-y-1.5 mb-4 list-decimal list-inside`}>
                <li>
                  Generate a key pair:{" "}
                  <code className="text-[11px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] px-1.5 py-0.5 rounded">
                    openssl ecparam -genkey -name prime256v1 -noout -out private.pem
                  </code>
                  , then{" "}
                  <code className="text-[11px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] px-1.5 py-0.5 rounded">
                    openssl ec -in private.pem -pubout -out public.pem
                  </code>
                </li>
                <li>
                  In Search Ads Advanced, go to{" "}
                  <span className={`font-medium ${textPrimary}`}>Account Settings → API</span> and upload{" "}
                  <span className={`font-medium ${textPrimary}`}>public.pem</span>
                </li>
                <li>
                  Apple shows you a Client ID, Team ID and Key ID for that key — enter those below, along with the
                  contents of <span className={`font-medium ${textPrimary}`}>private.pem</span> (which you keep,
                  never upload). After connecting, map a campaign group per app in the Integrations card.
                </li>
              </ol>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Client ID">
                  <input
                    className={inputCls}
                    type="text"
                    value={form.clientId}
                    onChange={(e) => onChange("clientId", e.target.value)}
                    placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </Field>
                <Field label="Team ID">
                  <input
                    className={inputCls}
                    type="text"
                    value={form.teamId}
                    onChange={(e) => onChange("teamId", e.target.value)}
                    placeholder="SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </Field>
                <Field label="Key ID" fullWidth>
                  <input
                    className={inputCls}
                    type="text"
                    value={form.keyId}
                    onChange={(e) => onChange("keyId", e.target.value)}
                    placeholder="XXXXXXXXXX"
                  />
                </Field>
                <Field
                  label="Private Key (.pem)"
                  hint="The private half you generated yourself in step 1 — not anything shown by Apple."
                  fullWidth
                >
                  <textarea
                    className={textareaCls}
                    rows={6}
                    value={form.privateKey}
                    onChange={(e) => onChange("privateKey", e.target.value)}
                    placeholder="-----BEGIN EC PRIVATE KEY-----&#10;…&#10;-----END EC PRIVATE KEY-----"
                  />
                </Field>
              </div>

              <p className={`text-[11px] ${textMuted} mt-3 mb-5`}>
                Your private key is encrypted at rest and only used to generate short-lived API tokens on our
                servers.
              </p>

              <button
                onClick={() => submit()}
                disabled={!canSubmit || connecting}
                className={`${btnPrimary} w-full`}
              >
                {connecting ? "Verifying…" : "Connect"}
              </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
