import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { borderDefault, btnSecSm, studioCardCls, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import {
  STUDIO_GEOMETRY_KEYS,
  type StudioItem,
  type StudioLayer,
  type StudioPresetInfo,
  type StudioStyle,
} from "./studioApi";

interface Props {
  disabled: boolean;
  layer: StudioLayer | null;
  item: StudioItem | null;
  title: string;
  onTitleChange: (title: string) => void;
  style: StudioStyle;
  onGeometryChange: (patch: Partial<StudioStyle>) => void;
  onDesignChange: (patch: Partial<StudioStyle>) => void;
  presets: StudioPresetInfo[];
  onApplyPreset: (preset: StudioPresetInfo) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (preset: StudioPresetInfo) => void;
  savingPreset: boolean;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className={`text-[13px] font-semibold ${textPrimary} mb-2`}>{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className={`inline-flex rounded-xl border ${borderDefault} p-0.5 gap-0.5 bg-[#fafbfc] dark:bg-[#252b38]`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-[5px] rounded-lg text-[12px] font-medium transition-all disabled:opacity-50 flex items-center justify-center min-w-[36px] ${
            value === opt.value ? "bg-white dark:bg-[#1c2028] shadow-sm text-[#595DD2]" : textSecondary
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const swatch = /^#[0-9a-f]{6}$/i.test(value) ? value : "#667eea";

  return (
    <label className="flex items-center gap-2.5">
      <input
        type="color"
        value={swatch}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded-lg border border-[#eef0f3] dark:border-[#2a2f3d] bg-transparent p-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      />
      <span className={`text-[12px] ${textSecondary} w-[104px] shrink-0`}>{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} !py-[5px] font-mono !text-[12px]`}
      />
    </label>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className={`text-[12px] ${textSecondary}`}>{label}</span>
      <span className={`text-[12px] font-medium ${textPrimary} text-right`}>{children}</span>
    </div>
  );
}

function NudgeControl({
  x,
  y,
  onChange,
  disabled,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  disabled: boolean;
}) {
  const clamp = (value: number) => Math.max(-2048, Math.min(2048, Math.round(value)));
  const nudge = (dx: number, dy: number) => (e: React.MouseEvent) => {
    const m = e.shiftKey ? 10 : 1;
    onChange(clamp(x + dx * m), clamp(y + dy * m));
  };
  const btn = `w-8 h-8 flex items-center justify-center rounded-lg border ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`;
  const fmt = (value: number) => (value > 0 ? `+${value}` : `${value}`);

  return (
    <div className="flex items-center gap-3">
      <div className="grid grid-cols-3 gap-1 shrink-0">
        <span />
        <button type="button" disabled={disabled} title="Move up (shift: 10px)" onClick={nudge(0, -1)} className={btn}>
          <ArrowUp className="w-4 h-4" />
        </button>
        <span />
        <button
          type="button"
          disabled={disabled}
          title="Move left (shift: 10px)"
          onClick={nudge(-1, 0)}
          className={btn}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button type="button" disabled={disabled} title="Reset position" onClick={() => onChange(0, 0)} className={btn}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          title="Move right (shift: 10px)"
          onClick={nudge(1, 0)}
          className={btn}
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <span />
        <button type="button" disabled={disabled} title="Move down (shift: 10px)" onClick={nudge(0, 1)} className={btn}>
          <ArrowDown className="w-4 h-4" />
        </button>
        <span />
      </div>
      <div className={`font-mono text-[12px] ${textSecondary} leading-5`}>
        <div>X {fmt(x)}</div>
        <div>Y {fmt(y)}</div>
      </div>
    </div>
  );
}

function ScaleSlider({
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={Math.round(min * 100)}
        max={Math.round(max * 100)}
        step={1}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 accent-[#595DD2] disabled:opacity-50"
      />
      <span className={`font-mono text-[12px] ${textSecondary} w-11 text-right shrink-0`}>
        {Math.round(value * 100)}%
      </span>
      <button
        type="button"
        disabled={disabled}
        title="Reset size"
        onClick={() => onChange(1)}
        className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-[#595DD2] transition-colors disabled:opacity-40 shrink-0`}
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function BoxSizeControl({
  w,
  h,
  onChange,
  disabled,
}: {
  w: number;
  h: number;
  onChange: (w: number, h: number) => void;
  disabled: boolean;
}) {
  const clamp = (value: number) => Math.max(0, Math.min(4096, Math.round(value)));

  return (
    <div className="flex items-center gap-2">
      <label className={`flex items-center gap-1.5 text-[12px] ${textSecondary}`}>
        W
        <input
          type="number"
          min={0}
          max={4096}
          step={10}
          value={w}
          disabled={disabled}
          title="Text box width, 0 follows the text"
          onChange={(e) => onChange(clamp(Number(e.target.value)), h)}
          className={`${inputCls} !w-20 font-mono`}
        />
      </label>
      <label className={`flex items-center gap-1.5 text-[12px] ${textSecondary}`}>
        H
        <input
          type="number"
          min={0}
          max={4096}
          step={10}
          value={h}
          disabled={disabled}
          title="Text box height, 0 shows every line"
          onChange={(e) => onChange(w, clamp(Number(e.target.value)))}
          className={`${inputCls} !w-20 font-mono`}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        title="Reset text box to auto"
        onClick={() => onChange(0, 0)}
        className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-[#595DD2] transition-colors disabled:opacity-40 shrink-0`}
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function StudioInspector({
  disabled,
  layer,
  item,
  title,
  onTitleChange,
  style,
  onGeometryChange,
  onDesignChange,
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  savingPreset,
}: Props) {
  const [presetName, setPresetName] = useState("");
  const [showPresetForm, setShowPresetForm] = useState(false);

  const patchStyle = (patch: Partial<StudioStyle>) => {
    const geo: Partial<StudioStyle> = {};
    const design: Partial<StudioStyle> = {};
    const geoSink = geo as Record<string, unknown>;
    const designSink = design as Record<string, unknown>;
    const geoKeys = new Set<string>(STUDIO_GEOMETRY_KEYS);

    for (const key of Object.keys(patch) as Array<keyof StudioStyle>) {
      if (patch[key] === undefined) continue;

      if (geoKeys.has(key)) {
        geoSink[key] = patch[key];
      } else {
        designSink[key] = patch[key];
      }
    }

    if (Object.keys(geo).length > 0) onGeometryChange(geo);
    if (Object.keys(design).length > 0) onDesignChange(design);
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    onSavePreset(presetName.trim());
    setPresetName("");
    setShowPresetForm(false);
  };

  const layerTitle =
    layer === "caption" ? "Caption" : layer === "device" ? "Device" : layer === "background" ? "Background" : "Studio";

  return (
    <div className={studioCardCls}>
      <div className={`text-[13px] font-semibold ${textPrimary}`}>{layerTitle}</div>
      <div className={`text-[11px] ${textMuted} mb-1`}>
        {layer === null
          ? "Click the phone, the caption or a layer to edit"
          : layer === "caption" && item
            ? item.basename.replace(/\.png$/i, "")
            : layer === "caption"
              ? "No screenshot selected"
              : "Applies to every screenshot"}
      </div>

      {layer === "caption" && (
        <>
          <Section label="Content">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[12px] ${textSecondary}`}>Text</span>
              <span className={`text-[11px] font-mono ${textMuted}`}>{title.length}/60</span>
            </div>
            <input
              type="text"
              value={title}
              disabled={disabled || !item}
              maxLength={60}
              placeholder="Screenshot headline"
              onChange={(e) => onTitleChange(e.target.value)}
              className={inputCls}
            />
          </Section>

          <Section label="Font">
            <Segmented
              options={[
                { value: "rounded", label: "Rounded" },
                { value: "inter", label: "Inter" },
                { value: "baloo", label: "Baloo" },
              ]}
              value={style.font}
              onChange={(v) => patchStyle({ font: v })}
              disabled={disabled}
            />
          </Section>

          <Section label="Placement">
            <Segmented
              options={[
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
              ]}
              value={style.textPosition}
              onChange={(v) => patchStyle({ textPosition: v })}
              disabled={disabled}
            />
          </Section>

          <Section label="Position">
            <NudgeControl
              x={style.titleOffsetX}
              y={style.titleOffsetY}
              onChange={(titleOffsetX, titleOffsetY) => patchStyle({ titleOffsetX, titleOffsetY })}
              disabled={disabled}
            />
          </Section>

          <Section label="Size">
            <ScaleSlider
              value={style.titleScale}
              min={0.2}
              max={3}
              onChange={(titleScale) => patchStyle({ titleScale })}
              disabled={disabled}
            />
          </Section>

          <Section label="Text box">
            <BoxSizeControl
              w={style.titleBoxW}
              h={style.titleBoxH}
              onChange={(titleBoxW, titleBoxH) => patchStyle({ titleBoxW, titleBoxH })}
              disabled={disabled}
            />
          </Section>

          <Section label="Appearance">
            <ColorRow
              label="Text color"
              value={style.textColor}
              onChange={(v) => patchStyle({ textColor: v })}
              disabled={disabled}
            />
          </Section>
        </>
      )}

      {layer === "background" && (
        <Section label="Appearance">
          <div className="flex flex-col gap-2.5">
            <ColorRow
              label="Gradient from"
              value={style.bgColor1}
              onChange={(v) => patchStyle({ bgColor1: v })}
              disabled={disabled}
            />
            <ColorRow
              label="Gradient to"
              value={style.bgColor2}
              onChange={(v) => patchStyle({ bgColor2: v })}
              disabled={disabled}
            />
          </div>
        </Section>
      )}

      {layer === "device" && (
        <>
          <Section label="Position">
            <NudgeControl
              x={style.offsetX}
              y={style.offsetY}
              onChange={(offsetX, offsetY) => patchStyle({ offsetX, offsetY })}
              disabled={disabled}
            />
          </Section>
          <Section label="Size">
            <ScaleSlider
              value={style.deviceScale}
              min={0.2}
              max={2}
              onChange={(deviceScale) => patchStyle({ deviceScale })}
              disabled={disabled}
            />
          </Section>
          <Section label="Details">
            <DetailRow label="Device">{item?.deviceLabel ?? "—"}</DetailRow>
            <DetailRow label="Caption key">{item?.descKey ?? "—"}</DetailRow>
            <DetailRow label="Source">
              {!item ? (
                "—"
              ) : item.hasRaw ? (
                <span className="text-sky-600 dark:text-sky-400">Stored</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">None</span>
              )}
            </DetailRow>
          </Section>
        </>
      )}

      <Section label="Style presets">
        {presets.length === 0 && (
          <p className={`text-[12px] ${textMuted} mb-2`}>No presets yet, save the current style to reuse it.</p>
        )}
        <div className="flex flex-col gap-1.5 mb-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className={`flex items-center gap-2 rounded-xl border ${borderDefault} pl-2 pr-1.5 py-1.5`}
            >
              <span
                className="w-6 h-6 rounded-md shrink-0 border border-black/10"
                style={{ background: `linear-gradient(135deg, ${preset.bgColor1}, ${preset.bgColor2})` }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onApplyPreset(preset)}
                title="Apply this preset"
                className={`flex-1 text-left text-[13px] font-medium ${textPrimary} truncate hover:text-[#595DD2] transition-colors disabled:opacity-50`}
              >
                {preset.name}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onDeletePreset(preset)}
                  title={`Delete ${preset.name}`}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {!disabled &&
          (showPresetForm ? (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={presetName}
                autoFocus
                maxLength={40}
                placeholder="Preset name"
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePreset();
                  if (e.key === "Escape") setShowPresetForm(false);
                }}
                className={`${inputCls} !py-[5px]`}
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={savingPreset || !presetName.trim()}
                className={btnSecSm}
              >
                {savingPreset ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowPresetForm(true)} className={btnSecSm}>
              <Plus className="w-3.5 h-3.5" />
              Save current style
            </button>
          ))}
      </Section>
    </div>
  );
}
