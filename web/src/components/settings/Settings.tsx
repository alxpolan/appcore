import { useState, useEffect } from "react";
import { useApi, apiPut } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { usePostHog } from "@posthog/react";
import AscAccountConnectSection from "./AscAccountConnectSection";
import AscCredentialsSection from "./AscCredentialsSection";
import GitHubSection from "./GitHubSection";
import PresetMetadataSection from "./PresetMetadataSection";
import { SettingsData } from "./types";
import { btnPrimary, inputCls, pageTitle, textareaCls } from "../../styles";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Settings({ addToast }: Props) {
  const posthog = usePostHog();
  const { canManageTeam } = usePermissions();
  const { data, loading, refetch } = useApi<SettingsData>("/settings");
  const [form, setForm] = useState<Partial<SettingsData>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: keyof SettingsData, value: any) => setForm((f: Partial<SettingsData>) => ({ ...f, [key]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTeam) {
      addToast("Only team admins can change team settings", "error");
      return;
    }
    setSaving(true);
    try {
      await apiPut("/settings", form);
      posthog?.capture("settings_saved");
      addToast("Settings saved", "success");
      refetch();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-gray-400 dark:text-[#5c6478]">
        <div className="spinner" /> Loading settings…
      </div>
    );

  return (
    <div className="max-w-3xl">
      <h1 className={`${pageTitle} mb-1`}>Team Settings</h1>
      {!canManageTeam && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/40 text-[12px] text-amber-800 dark:text-amber-300">
          Only team admins can edit these settings.
        </div>
      )}

      <fieldset disabled={!canManageTeam} className="contents">
        <form onSubmit={handleSave} className="flex flex-col gap-0">
          <AscAccountConnectSection data={data ?? null} refetch={refetch} addToast={addToast} />
          <AscCredentialsSection
            form={form}
            data={data ?? null}
            inputCls={inputCls}
            textareaCls={textareaCls}
            onChange={set}
          />
          <PresetMetadataSection form={form} inputCls={inputCls} onChange={set} />
          <GitHubSection />

          <div className="flex justify-end pb-2">
            <button
              className={btnPrimary}
              type="submit"
              disabled={saving || !canManageTeam}
              title={!canManageTeam ? "Only team admins can change team settings" : undefined}
            >
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </form>
      </fieldset>
    </div>
  );
}
