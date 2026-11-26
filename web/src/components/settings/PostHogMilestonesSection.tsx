import { useEffect, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { apiGet, apiPut } from "../../hooks/useApi";
import SectionCard from "./SectionCard";
import { btnPrimary, btnSecondary, inputCls, textMuted, textSecondary } from "../../styles";
import type { PostHogMilestoneDefinition } from "../../types";

interface MilestoneVariantInput {
  key: string;
  label: string;
  flagKey: string;
  flagValue: string;
}

const newVariant = (): MilestoneVariantInput => ({
  key: Math.random().toString(36).slice(2),
  label: "",
  flagKey: "",
  flagValue: "",
});

interface Props {
  bundleId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

type MilestoneRow = PostHogMilestoneDefinition & { key: string };

const newRow = (): MilestoneRow => ({
  eventName: "",
  minCount: 1,
  label: "",
  splitByVariant: true,
  key: Math.random().toString(36).slice(2),
});

export default function PostHogMilestonesSection({ bundleId, addToast }: Props) {
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [variants, setVariants] = useState<MilestoneVariantInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiGet<{ milestones: PostHogMilestoneDefinition[]; variants?: MilestoneVariantInput[] }>(
      "/posthog/milestones",
      { bundleId },
    )
      .then((d) => {
        setMilestones(
          d.milestones.map((m) => ({
            ...m,
            splitByVariant: m.splitByVariant !== false,
            key: Math.random().toString(36).slice(2),
          })),
        );
        setVariants(
          (d.variants ?? []).map((v) => ({
            key: v.key || Math.random().toString(36).slice(2),
            label: v.label,
            flagKey: v.flagKey,
            flagValue: v.flagValue,
          })),
        );
        setDirty(false);
      })
      .finally(() => setLoading(false));
  }, [bundleId]);

  const update = (index: number, field: keyof PostHogMilestoneDefinition, value: string) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: field === "minCount" ? Number(value) || 0 : value } : m)),
    );
    setDirty(true);
  };

  const toggleSplitByVariant = (index: number) => {
    setMilestones((prev) => prev.map((m, i) => (i === index ? { ...m, splitByVariant: !m.splitByVariant } : m)));
    setDirty(true);
  };

  const addRow = () => {
    setMilestones((prev) => [...prev, newRow()]);
    setDirty(true);
  };

  const removeRow = (index: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    setMilestones((prev) => {
      const next = [...prev];
      const target = index + dir;

      if (target < 0 || target >= next.length) return prev;

      [next[index], next[target]] = [next[target], next[index]];

      return next;
    });
    setDirty(true);
  };

  const updateVariant = (index: number, field: keyof Omit<MilestoneVariantInput, "key">, value: string) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
    setDirty(true);
  };

  const addVariant = () => {
    setVariants((prev) => [...prev, newVariant()]);
    setDirty(true);
  };

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const moveVariant = (index: number, dir: -1 | 1) => {
    setVariants((prev) => {
      const next = [...prev];
      const target = index + dir;

      if (target < 0 || target >= next.length) return prev;

      [next[index], next[target]] = [next[target], next[index]];

      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    const valid = milestones
      .filter((m) => m.eventName.trim() && m.label.trim() && m.minCount >= 1)
      .map(({ key, ...rest }) => rest);
    const validVariants = variants
      .filter((v) => v.label.trim() && v.flagKey.trim() && v.flagValue.trim())
      .map(({ key, ...rest }) => rest);
    setSaving(true);
    try {
      const result = await apiPut<{
        milestones: PostHogMilestoneDefinition[];
        variants?: { label: string; flagKey: string; flagValue: string }[];
      }>("/posthog/milestones", {
        bundleId,
        milestones: valid,
        variants: validVariants,
      });
      setMilestones(result.milestones.map((m) => ({ ...m, key: Math.random().toString(36).slice(2) })));
      setVariants(
        (result.variants ?? []).map((v) => ({ ...v, key: Math.random().toString(36).slice(2) })),
      );
      setDirty(false);
      addToast("Milestones saved", "success");
    } catch (err: any) {
      addToast(err.message ?? "Failed to save milestones", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <SectionCard
      title="PostHog Milestones"
      desc="PostHog events that show how far your Apple Search Ads installs actually get in the app — shown on each campaign's detail page next to the raw install count."
    >
      <div className="flex flex-col gap-2">
        {milestones.length === 0 && !dirty && (
          <p className={`text-sm ${textSecondary} mb-2`}>
            No milestones configured yet. Add a PostHog event name and a minimum count to track.
          </p>
        )}

        {milestones.map((m, i) => (
          <div key={m.key} className="flex items-center gap-2">
            <div className="flex flex-col shrink-0">
              <button
                onClick={() => moveRow(i, -1)}
                disabled={i === 0}
                className="p-0.5 rounded text-[#9ca3af] hover:text-[#595DD2] transition-colors disabled:opacity-20 disabled:pointer-events-none"
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => moveRow(i, 1)}
                disabled={i === milestones.length - 1}
                className="p-0.5 rounded text-[#9ca3af] hover:text-[#595DD2] transition-colors disabled:opacity-20 disabled:pointer-events-none"
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              className={`${inputCls} flex-1 min-w-0 font-mono text-[13px]`}
              placeholder="event_name"
              value={m.eventName}
              onChange={(e) => update(i, "eventName", e.target.value)}
              spellCheck={false}
            />
            <div className="w-20 shrink-0">
              <input
                type="number"
                min={1}
                className={`${inputCls} text-[13px]`}
                placeholder="min"
                value={m.minCount}
                onChange={(e) => update(i, "minCount", e.target.value)}
              />
            </div>
            <input
              type="text"
              className={`${inputCls} flex-1 min-w-0 text-[13px]`}
              placeholder="Label shown on campaign"
              value={m.label}
              onChange={(e) => update(i, "label", e.target.value)}
            />
            {variants.length > 0 && (
              <label
                className={`flex items-center gap-1.5 text-[12px] ${textMuted} shrink-0 cursor-pointer`}
                title="Show this milestone split by variant. Turn off for milestones where the variant doesn't matter yet, e.g. onboarding."
              >
                <input
                  type="checkbox"
                  checked={m.splitByVariant !== false}
                  onChange={() => toggleSplitByVariant(i)}
                />
                Split by variant
              </label>
            )}
            <button
              onClick={() => removeRow(i)}
              className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#ef4444] hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
              title="Remove"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button className={btnSecondary} onClick={addRow}>
            + Add Milestone
          </button>
          {dirty && (
            <button className={btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>

        <div className={`text-[12px] font-semibold ${textSecondary} uppercase tracking-wide pt-3`}>
          Experiment Variants
        </div>
        <p className={`text-[12px] ${textMuted} -mt-1`}>
          Split every milestone by a PostHog feature flag value, e.g. paywall copy A vs B. Leave empty for totals only.
        </p>

        {variants.map((v, i) => (
          <div key={v.key} className="flex items-center gap-2">
            <div className="flex flex-col shrink-0">
              <button
                onClick={() => moveVariant(i, -1)}
                disabled={i === 0}
                className="p-0.5 rounded text-[#9ca3af] hover:text-[#595DD2] transition-colors disabled:opacity-20 disabled:pointer-events-none"
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => moveVariant(i, 1)}
                disabled={i === variants.length - 1}
                className="p-0.5 rounded text-[#9ca3af] hover:text-[#595DD2] transition-colors disabled:opacity-20 disabled:pointer-events-none"
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              className={`${inputCls} flex-1 min-w-0 text-[13px]`}
              placeholder="Label, e.g. Paywall A"
              value={v.label}
              onChange={(e) => updateVariant(i, "label", e.target.value)}
            />
            <input
              type="text"
              className={`${inputCls} flex-1 min-w-0 font-mono text-[13px]`}
              placeholder="flag_key"
              value={v.flagKey}
              onChange={(e) => updateVariant(i, "flagKey", e.target.value)}
              spellCheck={false}
            />
            <input
              type="text"
              className={`${inputCls} max-w-28 shrink-0 font-mono text-[13px]`}
              placeholder="value"
              value={v.flagValue}
              onChange={(e) => updateVariant(i, "flagValue", e.target.value)}
              spellCheck={false}
            />
            <button
              onClick={() => removeVariant(i)}
              className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#ef4444] hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
              title="Remove"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button className={btnSecondary} onClick={addVariant}>
            + Add Variant
          </button>
          {dirty && (
            <button className={btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
