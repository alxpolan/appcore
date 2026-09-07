import { useState } from "react";
import { textPrimary } from "../../styles";
import SectionCard from "./SectionCard";
import Field from "./Field";
import { SettingsData } from "./types";

interface Props {
  form: Partial<SettingsData>;
  inputCls: string;
  onChange: (key: keyof SettingsData, value: any) => void;
}

export default function PresetMetadataSection({ form, inputCls, onChange }: Props) {
  const [showDemoCredentials, setShowDemoCredentials] = useState(form.reviewerDemoAccountRequired ?? false);

  const handleDemoRequired = (val: boolean) => {
    setShowDemoCredentials(val);
    onChange("reviewerDemoAccountRequired", val);
  };

  return (
    <SectionCard
      title="Preset Metadata"
      desc="Default values pre-filled when creating a new version. Can be overridden per app in the Versions view."
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Copyright" hint="e.g. © 2025 Your Company" fullWidth>
          <input
            type="text"
            className={inputCls}
            value={form.presetCopyright ?? ""}
            onChange={(e) => onChange("presetCopyright", e.target.value)}
            placeholder="© 2025 Your Company"
          />
        </Field>

        <div className="col-span-2 border-t border-[#f3f4f6] dark:border-[#2a2f3d] pt-4 mt-1">
          <p className={`text-[13px] font-semibold ${textPrimary} mb-3`}>App Review Contact</p>
        </div>

        <Field label="First Name">
          <input
            type="text"
            className={inputCls}
            value={form.reviewerFirstName ?? ""}
            onChange={(e) => onChange("reviewerFirstName", e.target.value)}
            placeholder="Max"
          />
        </Field>
        <Field label="Last Name">
          <input
            type="text"
            className={inputCls}
            value={form.reviewerLastName ?? ""}
            onChange={(e) => onChange("reviewerLastName", e.target.value)}
            placeholder="Mustermann"
          />
        </Field>
        <Field label="Phone Number" hint="Include country code, e.g. +49 151 12345678">
          <input
            type="tel"
            className={inputCls}
            value={form.reviewerPhone ?? ""}
            onChange={(e) => onChange("reviewerPhone", e.target.value)}
            placeholder="+49 151 12345678"
          />
        </Field>
        <Field label="E-Mail">
          <input
            type="email"
            className={inputCls}
            value={form.reviewerEmail ?? ""}
            onChange={(e) => onChange("reviewerEmail", e.target.value)}
            placeholder="review@yourcompany.com"
          />
        </Field>

        <div className="col-span-2 flex items-center gap-3 pt-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.reviewerDemoAccountRequired ?? false}
              onChange={(e) => handleDemoRequired(e.target.checked)}
              className="w-4 h-4 rounded accent-[#595DD2]"
            />
            <span className={`text-[13px] ${textPrimary}`}>Login required (Demo Account)</span>
          </label>
        </div>

        {showDemoCredentials && (
          <>
            <Field label="Demo Username">
              <input
                type="text"
                className={inputCls}
                value={form.reviewerDemoUsername ?? ""}
                onChange={(e) => onChange("reviewerDemoUsername", e.target.value)}
                placeholder="demo@example.com"
              />
            </Field>
            <Field label="Demo Password">
              <input
                type="password"
                autoComplete="off"
                className={inputCls}
                value={form.reviewerDemoPassword ?? ""}
                onChange={(e) => onChange("reviewerDemoPassword", e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          </>
        )}
      </div>
    </SectionCard>
  );
}
