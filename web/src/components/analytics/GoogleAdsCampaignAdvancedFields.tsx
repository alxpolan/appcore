import { Plus, X } from "lucide-react";
import { btnSecSm, inputCls, textMuted, textPrimary } from "../../styles";
import Field from "../settings/Field";

export type GoogleAdsBiddingStrategy = "MANUAL_CPC" | "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA" | "TARGET_ROAS";

export type GoogleAdsDayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

const DAYS_OF_WEEK: GoogleAdsDayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export interface AdScheduleDraft {
  key: number;
  dayOfWeek: GoogleAdsDayOfWeek;
  startHour: string;
  endHour: string;
}

export interface SitelinkDraft {
  key: number;
  linkText: string;
  finalUrl: string;
  description1: string;
  description2: string;
}

export interface StructuredSnippetDraft {
  key: number;
  header: string;
  valuesText: string;
}

export interface CallDraft {
  key: number;
  phoneNumber: string;
  countryCode: string;
}

export interface DeviceBidAdjustmentsDraft {
  mobile: string;
  desktop: string;
  tablet: string;
}

let nextKey = 1;
export const newAdScheduleDraft = (): AdScheduleDraft => ({
  key: nextKey++,
  dayOfWeek: "MONDAY",
  startHour: "9",
  endHour: "17",
});
export const newSitelinkDraft = (): SitelinkDraft => ({
  key: nextKey++,
  linkText: "",
  finalUrl: "",
  description1: "",
  description2: "",
});
export const newStructuredSnippetDraft = (): StructuredSnippetDraft => ({ key: nextKey++, header: "", valuesText: "" });
export const newCallDraft = (): CallDraft => ({ key: nextKey++, phoneNumber: "", countryCode: "" });

const removeBtnCls = `w-7 h-7 flex items-center justify-center rounded-lg shrink-0 ${textMuted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`;

export function BiddingStrategyFields({
  strategy,
  onStrategyChange,
  cpcBidCeiling,
  onCpcBidCeilingChange,
  targetCpa,
  onTargetCpaChange,
  targetRoas,
  onTargetRoasChange,
}: {
  strategy: GoogleAdsBiddingStrategy;
  onStrategyChange: (v: GoogleAdsBiddingStrategy) => void;
  cpcBidCeiling: string;
  onCpcBidCeilingChange: (v: string) => void;
  targetCpa: string;
  onTargetCpaChange: (v: string) => void;
  targetRoas: string;
  onTargetRoasChange: (v: string) => void;
}) {
  return (
    <>
      <Field label="Bidding strategy">
        <select
          className={inputCls}
          value={strategy}
          onChange={(e) => onStrategyChange(e.target.value as GoogleAdsBiddingStrategy)}
        >
          <option value="MANUAL_CPC">Manual CPC</option>
          <option value="MAXIMIZE_CLICKS">Maximize clicks</option>
          <option value="MAXIMIZE_CONVERSIONS">Maximize conversions</option>
          <option value="TARGET_CPA">Target CPA</option>
          <option value="TARGET_ROAS">Target ROAS</option>
        </select>
      </Field>

      {strategy !== "MANUAL_CPC" && (
        <Field label="Max CPC cap" hint="Optional.">
          <input
            className={inputCls}
            inputMode="decimal"
            value={cpcBidCeiling}
            onChange={(e) => onCpcBidCeilingChange(e.target.value)}
            placeholder="2.00"
          />
        </Field>
      )}

      {(strategy === "TARGET_CPA" || strategy === "MAXIMIZE_CONVERSIONS") && (
        <Field
          label="Target CPA"
          hint={strategy === "TARGET_CPA" ? "Required." : "Optional."}
        >
          <input
            className={inputCls}
            inputMode="decimal"
            value={targetCpa}
            onChange={(e) => onTargetCpaChange(e.target.value)}
            placeholder="15"
          />
        </Field>
      )}

      {strategy === "TARGET_ROAS" && (
        <Field label="Target ROAS" hint="As a percent, e.g. 300 for 300%.">
          <input
            className={inputCls}
            inputMode="decimal"
            value={targetRoas}
            onChange={(e) => onTargetRoasChange(e.target.value)}
            placeholder="300"
          />
        </Field>
      )}
    </>
  );
}

export function DeviceBidAdjustmentsFields({
  value,
  onChange,
}: {
  value: DeviceBidAdjustmentsDraft;
  onChange: (v: DeviceBidAdjustmentsDraft) => void;
}) {
  return (
    <>
      <Field label="Mobile bid adj." hint="Percent, -90 to 900. Optional.">
        <input
          className={inputCls}
          inputMode="decimal"
          value={value.mobile}
          onChange={(e) => onChange({ ...value, mobile: e.target.value })}
          placeholder="e.g. 20"
        />
      </Field>
      <Field label="Desktop bid adj." hint="Percent, -90 to 900. Optional.">
        <input
          className={inputCls}
          inputMode="decimal"
          value={value.desktop}
          onChange={(e) => onChange({ ...value, desktop: e.target.value })}
          placeholder="e.g. -20"
        />
      </Field>
      <Field label="Tablet bid adj." hint="Percent, -90 to 900. Optional.">
        <input
          className={inputCls}
          inputMode="decimal"
          value={value.tablet}
          onChange={(e) => onChange({ ...value, tablet: e.target.value })}
          placeholder="e.g. -50"
        />
      </Field>
    </>
  );
}

export function AdScheduleEditor({
  items,
  onChange,
}: {
  items: AdScheduleDraft[];
  onChange: (items: AdScheduleDraft[]) => void;
}) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((s) => (
            <div key={s.key} className="grid grid-cols-[1fr_90px_16px_90px_28px] gap-2 items-center">
              <select
                className={inputCls}
                value={s.dayOfWeek}
                onChange={(e) =>
                  onChange(items.map((x) => (x.key === s.key ? { ...x, dayOfWeek: e.target.value as GoogleAdsDayOfWeek } : x)))
                }
              >
                {DAYS_OF_WEEK.map((d) => (
                  <option key={d} value={d}>
                    {d[0] + d.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                inputMode="numeric"
                value={s.startHour}
                onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, startHour: e.target.value } : x)))}
                placeholder="9"
                title="Start hour (0-24)"
              />
              <span className={`text-center ${textMuted}`}>–</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={s.endHour}
                onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, endHour: e.target.value } : x)))}
                placeholder="17"
                title="End hour (0-24)"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.key !== s.key))}
                aria-label="Remove schedule window"
                className={removeBtnCls}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, newAdScheduleDraft()])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Schedule window
      </button>
    </div>
  );
}

export function SitelinksEditor({
  items,
  onChange,
}: {
  items: SitelinkDraft[];
  onChange: (items: SitelinkDraft[]) => void;
}) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((s) => (
            <div key={s.key} className={`border ${textMuted} border-dashed rounded-xl p-3 space-y-2`}>
              <div className="grid grid-cols-[1fr_1fr_28px] gap-2 items-center">
                <input
                  className={inputCls}
                  value={s.linkText}
                  onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, linkText: e.target.value } : x)))}
                  placeholder="Link text (max 25 chars)"
                  maxLength={25}
                />
                <input
                  className={inputCls}
                  value={s.finalUrl}
                  onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, finalUrl: e.target.value } : x)))}
                  placeholder="https://..."
                />
                <button
                  type="button"
                  onClick={() => onChange(items.filter((x) => x.key !== s.key))}
                  aria-label="Remove sitelink"
                  className={removeBtnCls}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  value={s.description1}
                  onChange={(e) =>
                    onChange(items.map((x) => (x.key === s.key ? { ...x, description1: e.target.value } : x)))
                  }
                  placeholder="Description line 1 (optional, max 35 chars)"
                  maxLength={35}
                />
                <input
                  className={inputCls}
                  value={s.description2}
                  onChange={(e) =>
                    onChange(items.map((x) => (x.key === s.key ? { ...x, description2: e.target.value } : x)))
                  }
                  placeholder="Description line 2 (optional, max 35 chars)"
                  maxLength={35}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, newSitelinkDraft()])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Sitelink
      </button>
    </div>
  );
}

export function CalloutsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((text, i) => (
            <div key={i} className="grid grid-cols-[1fr_28px] gap-2 items-center">
              <input
                className={inputCls}
                value={text}
                onChange={(e) => onChange(items.map((t, j) => (j === i ? e.target.value : t)))}
                placeholder="Free shipping (max 25 chars)"
                maxLength={25}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label="Remove callout"
                className={removeBtnCls}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, ""])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Callout
      </button>
    </div>
  );
}

export function StructuredSnippetsEditor({
  items,
  onChange,
}: {
  items: StructuredSnippetDraft[];
  onChange: (items: StructuredSnippetDraft[]) => void;
}) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((s) => (
            <div key={s.key} className="grid grid-cols-[140px_1fr_28px] gap-2 items-center">
              <input
                className={inputCls}
                value={s.header}
                onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, header: e.target.value } : x)))}
                placeholder="Brands"
                title='A Google-defined header, e.g. "Brands", "Styles", "Types"'
              />
              <input
                className={inputCls}
                value={s.valuesText}
                onChange={(e) => onChange(items.map((x) => (x.key === s.key ? { ...x, valuesText: e.target.value } : x)))}
                placeholder="Nike, Adidas, Puma (comma-separated)"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.key !== s.key))}
                aria-label="Remove structured snippet"
                className={removeBtnCls}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, newStructuredSnippetDraft()])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Structured snippet
      </button>
    </div>
  );
}

export function CallsEditor({ items, onChange }: { items: CallDraft[]; onChange: (items: CallDraft[]) => void }) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((c) => (
            <div key={c.key} className="grid grid-cols-[1fr_90px_28px] gap-2 items-center">
              <input
                className={inputCls}
                value={c.phoneNumber}
                onChange={(e) => onChange(items.map((x) => (x.key === c.key ? { ...x, phoneNumber: e.target.value } : x)))}
                placeholder="+1 555 123 4567"
              />
              <input
                className={inputCls}
                value={c.countryCode}
                onChange={(e) =>
                  onChange(
                    items.map((x) =>
                      x.key === c.key ? { ...x, countryCode: e.target.value.toUpperCase().slice(0, 2) } : x,
                    ),
                  )
                }
                placeholder="US"
                maxLength={2}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.key !== c.key))}
                aria-label="Remove call extension"
                className={removeBtnCls}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, newCallDraft()])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Call extension
      </button>
    </div>
  );
}
