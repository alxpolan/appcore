import { useState, useCallback, useEffect } from "react";
import { X, Check } from "lucide-react";
import { authHeaders } from "../hooks/useApi";
import {
  borderDefault,
  btnSecSm,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
} from "../styles";

interface AgeRatingPanelProps {
  bundleId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

interface AgeRatingField {
  key: string;
  kind: "boolean" | "level" | "kidsAgeBand" | "overrideV2" | "koreaOverride" | "text" | "url";
  label: string;
}

const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "NONE", label: "None" },
  { value: "INFREQUENT_OR_MILD", label: "Infrequent / mild" },
  { value: "FREQUENT_OR_INTENSE", label: "Frequent / intense" },
  { value: "INFREQUENT", label: "Infrequent" },
  { value: "FREQUENT", label: "Frequent" },
];

const KIDS_OPTIONS = [
  { value: "FIVE_AND_UNDER", label: "5 and under" },
  { value: "SIX_TO_EIGHT", label: "6 – 8" },
  { value: "NINE_TO_ELEVEN", label: "9 – 11" },
];

const OVERRIDE_V2_OPTIONS = [
  { value: "NONE", label: "None" },
  { value: "NINE_PLUS", label: "9+" },
  { value: "THIRTEEN_PLUS", label: "13+" },
  { value: "SIXTEEN_PLUS", label: "16+" },
  { value: "EIGHTEEN_PLUS", label: "18+" },
  { value: "UNRATED", label: "Unrated" },
];

const KOREA_OPTIONS = [
  { value: "NONE", label: "None" },
  { value: "ALL", label: "All" },
  { value: "TWELVE_PLUS", label: "12+" },
  { value: "FIFTEEN_PLUS", label: "15+" },
  { value: "NINETEEN_PLUS", label: "19+" },
];

function optionsFor(kind: AgeRatingField["kind"]) {
  if (kind === "level") return LEVEL_OPTIONS;
  if (kind === "kidsAgeBand") return KIDS_OPTIONS;
  if (kind === "overrideV2") return OVERRIDE_V2_OPTIONS;

  return KOREA_OPTIONS;
}

export default function AgeRatingPanel({ bundleId, addToast }: AgeRatingPanelProps) {
  const [declarationId, setDeclarationId] = useState<string | null>(null);
  const [fields, setFields] = useState<AgeRatingField[]>([]);
  const [values, setValues] = useState<Record<string, boolean | string | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/age-rating?bundleId=${encodeURIComponent(bundleId)}`, {
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const json = await res.json();
      setDeclarationId(json.id);
      setFields(json.fields ?? []);
      setValues(json.attributes ?? {});
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [bundleId]);

  useEffect(() => {
    load();
  }, [load]);

  const setValue = (key: string, value: boolean | string | null) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!declarationId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/age-rating/${declarationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ attributes: values }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setValues(json.attributes ?? values);
      addToast("Age rating questionnaire saved", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  if (!declarationId) {
    return <p className={`text-[12px] ${textMuted} py-2`}>No age rating questionnaire found for this app.</p>;
  }

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden mt-2`}>
      <div className={`px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}>
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Content Questionnaire</span>
      </div>
      <div className="p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]">
        <div className="grid grid-cols-2 gap-2">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>{field.label}</label>
              {field.kind === "boolean" ? (
                <select
                  className={inputCls}
                  value={values[field.key] == null ? "" : String(values[field.key])}
                  onChange={(e) =>
                    setValue(
                      field.key,
                      e.target.value === "" ? null : e.target.value === "true",
                    )
                  }
                >
                  <option value="">Not set</option>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : field.kind === "text" || field.kind === "url" ? (
                <input
                  className={inputCls}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setValue(field.key, e.target.value.trim() ? e.target.value : null)}
                  placeholder="Not set"
                  inputMode={field.kind === "url" ? "url" : undefined}
                />
              ) : (
                <select
                  className={inputCls}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => setValue(field.key, e.target.value ? e.target.value : null)}
                >
                  <option value="">Not set</option>
                  {optionsFor(field.kind).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={load} disabled={saving} className={btnSecSm}>
            <X className="w-3 h-3" />
            Reset
          </button>
          <button onClick={save} disabled={saving} className={btnSecSm}>
            {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
            Save Questionnaire
          </button>
        </div>
      </div>
    </div>
  );
}
