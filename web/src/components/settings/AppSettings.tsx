import { useState } from "react";
import { borderDefault, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { Trash2 } from "lucide-react";
import { useApi, getActiveBundleId, apiDelete, apiPatch, setActiveBundleId } from "../../hooks/useApi";
import SigningSection from "./SigningSection";
import SnapshotEnvSection from "./SnapshotEnvSection";
import { RepoLinker } from "../Logs";
import type { AppItem, GitHubStatus } from "../../types";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AppSettings({ addToast }: Props) {
  const { data: apps, refetch: refetchApps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const { data: ghStatus } = useApi<GitHubStatus>("/github/status", [], true);

  const activeApp = apps?.find((a) => a.bundleId === getActiveBundleId() && a.isOwnApp);

  return (
    <div className="max-w-3xl">
      <h1 className={`${pageTitle} mb-5`}>App Settings</h1>

      {activeApp ? (
        <>
          <DisplayNameSection key={activeApp.id} app={activeApp} addToast={addToast} onSaved={refetchApps} />
          <RepoLinker
            appId={activeApp.id}
            appName={activeApp.displayName ?? activeApp.name}
            connected={!!ghStatus?.connected}
            addToast={addToast}
          />
        </>
      ) : (
        <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 text-sm ${textMuted}`}>
          No app selected. Choose an app from the sidebar to link a GitHub repo.
        </div>
      )}

      {activeApp && <SigningSection appId={activeApp.id} addToast={addToast} />}
      {activeApp && <SnapshotEnvSection appId={activeApp.id} addToast={addToast} />}
      {activeApp && <DangerZone app={activeApp} addToast={addToast} />}
    </div>
  );
}

function DisplayNameSection({
  app,
  addToast,
  onSaved,
}: {
  app: AppItem;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(app.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== (app.displayName ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch(`/apps/${app.id}`, { displayName: value.trim() || null });
      addToast("Display name updated", "success");
      window.dispatchEvent(new Event("app-changed"));
      onSaved();
    } catch (err: any) {
      addToast(err.message ?? "Failed to update display name", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5`}>
      <h2 className={`text-[13px] font-bold uppercase tracking-widest ${textMuted} mb-1`}>Display Name</h2>
      <p className={`text-[13px] ${textSecondary} mb-3`}>
        Your App Store title is often stuffed with keywords ("{app.name}"). Set a clean name to show instead,
        throughout this app's dashboard, sidebar and app switcher.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={app.name}
          className={`flex-1 rounded-xl px-3.5 py-[9px] text-[13px] border ${borderDefault} bg-white dark:bg-[#1c2028] ${textPrimary} focus:outline-none focus:ring-2 focus:ring-[#C4001E]/20`}
          disabled={saving}
        />
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-4 py-[9px] rounded-xl text-[13px] font-semibold bg-[#C4001E] text-white hover:bg-[#a8001a] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function DangerZone({
  app,
  addToast,
}: {
  app: AppItem;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const handleDelete = async () => {
    if (confirmText !== app.bundleId) return;
    setDeleting(true);
    try {
      await apiDelete(`/apps/${app.id}`);
      setActiveBundleId(null);
      addToast(`"${app.name}" has been removed.`, "success");
    } catch (err: any) {
      addToast(err.message ?? "Failed to delete app", "error");
      setDeleting(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 p-5">
      <h2 className="text-[13px] font-bold uppercase tracking-widest text-red-500 dark:text-red-400 mb-1">
        Danger Zone
      </h2>
      <p className={`text-[13px] ${textSecondary} mb-4`}>
        This app and all associated data (screenshots, builds, keywords, analyses) will be permanently deleted.
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-2 px-4 py-[9px] rounded-xl text-[13px] font-semibold border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 bg-white dark:bg-[#1c2028] hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
        >
          <Trash2 className="w-4 h-4" />
          Remove app
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-[#374151] dark:text-[#c8cdd3]">
            Confirm by typing the bundle ID:{" "}
            <span className="font-mono font-semibold text-red-500">{app.bundleId}</span>
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={app.bundleId}
            className={`w-full rounded-xl px-3.5 py-[9px] text-[13px] border border-red-300 dark:border-red-800 bg-white dark:bg-[#1c2028] ${textPrimary} focus:outline-none focus:ring-2 focus:ring-red-400/40`}
            disabled={deleting}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={confirmText !== app.bundleId || deleting}
              className="inline-flex items-center gap-1.5 px-4 py-[9px] rounded-xl text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <>
                  <div className="spinner !w-3.5 !h-3.5" /> Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              disabled={deleting}
              className={`px-4 py-[9px] rounded-xl text-[13px] font-medium border ${borderDefault} bg-white dark:bg-[#1c2028] ${textSecondary} hover:bg-gray-50 dark:hover:bg-[#252b38] transition-all`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
