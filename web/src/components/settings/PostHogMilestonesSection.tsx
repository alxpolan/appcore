import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiGet, apiPut } from "../../hooks/useApi";
import SectionCard from "./SectionCard";
import { btnPrimary, btnSecondary, inputCls, textSecondary } from "../../styles";
import type { PostHogMilestoneDefinition } from "../../types";

interface Props {
  bundleId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function PostHogMilestonesSection({ bundleId, addToast }: Props) {
  const [milestones, setMilestones] = useState<PostHogMilestoneDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiGet<{ milestones: PostHogMilestoneDefinition[] }>("/posthog/milestones", { bundleId })
      .then((d) => {
        setMilestones(d.milestones);
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

  const addRow = () => {
    setMilestones((prev) => [...prev, { eventName: "", minCount: 1, label: "" }]);
    setDirty(true);
  };

  const removeRow = (index: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const handleSave = async () => {
    const valid = milestones.filter((m) => m.eventName.trim() && m.label.trim() && m.minCount >= 1);
    setSaving(true);
    try {
      const result = await apiPut<{ milestones: PostHogMilestoneDefinition[] }>("/posthog/milestones", {
        bundleId,
        milestones: valid,
      });
      setMilestones(result.milestones);
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
          <div key={i} className="flex items-center gap-2">
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
      </div>
    </SectionCard>
  );
}
