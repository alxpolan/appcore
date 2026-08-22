import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Field from "./Field";
import { SettingsData } from "./types";
import { borderDefault, textMuted, textPrimary } from "../../styles";

interface Props {
  form: Partial<SettingsData>;
  data: SettingsData | null;
  inputCls: string;
  textareaCls: string;
  onChange: (key: keyof SettingsData, value: any) => void;
}

export default function AscCredentialsSection({ form, data, inputCls, textareaCls, onChange }: Props) {
  const hasOwnKey = !!(data?.ascIssuerId || data?.ascKeyId || data?.ascPrivateKeySet);
  const [open, setOpen] = useState(hasOwnKey);

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4"
      >
        <div className="text-left">
          <div className={`text-[14px] font-semibold ${textPrimary}`}>Advanced: connect with your own API key</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Skip inviting our account and provide your own App Store Connect API credentials instead.
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 ${textMuted} shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Issuer ID" hint="Found in App Store Connect → Users & Access → Integrations">
              <input
                className={inputCls}
                type="text"
                value={form.ascIssuerId ?? ""}
                onChange={(e) => onChange("ascIssuerId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </Field>
            <Field label="Key ID">
              <input
                className={inputCls}
                type="text"
                value={form.ascKeyId ?? ""}
                onChange={(e) => onChange("ascKeyId", e.target.value)}
                placeholder="XXXXXXXXXX"
              />
            </Field>
            <Field label="Vendor Number" hint="Found in App Store Connect → Payments & Financial Reports">
              <input
                className={inputCls}
                type="text"
                value={form.ascVendorNumber ?? ""}
                onChange={(e) => onChange("ascVendorNumber", e.target.value)}
                placeholder="12345678"
              />
            </Field>
            <Field
              label="Private Key (.p8)"
              hint={
                data?.ascPrivateKeySet
                  ? "Key is set — paste a new key to replace."
                  : "Paste the full contents of your AuthKey_XXXXXX.p8 file."
              }
              fullWidth
            >
              <textarea
                className={textareaCls}
                rows={5}
                value={form.ascPrivateKey === "••••••••" ? "" : (form.ascPrivateKey ?? "")}
                onChange={(e) => onChange("ascPrivateKey", e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
