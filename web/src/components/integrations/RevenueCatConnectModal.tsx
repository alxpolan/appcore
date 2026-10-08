import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { borderDefault, btnPrimary, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import Field from "../settings/Field";

interface Props {
  bundleId: string;
  onClose: () => void;
  onConnected: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

interface ProjectOption {
  projectId: string;
  projectName: string;
}

export default function RevenueCatConnectModal({ bundleId, onClose, onConnected, addToast }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const submit = async (projectId?: string) => {
    setConnecting(true);
    try {
      const result = await apiPost<{
        ok?: boolean;
        projectName?: string;
        needsProjectSelection?: boolean;
        projects?: ProjectOption[];
      }>("/revenuecat/connect", { apiKey, projectId, bundleId });
      if (result.needsProjectSelection && result.projects) {
        setProjectOptions(result.projects);
        setSelectedProjectId(result.projects[0]?.projectId ?? "");
        return;
      }
      addToast(`Connected to RevenueCat (${result.projectName})`, "success");
      onConnected();
      onClose();
    } catch (err: any) {
      addToast(err.message ?? "Failed to connect RevenueCat", "error");
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
          <h2 className={`text-lg font-semibold ${textPrimary}`}>Connect RevenueCat</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {projectOptions ? (
            <>
              <p className={`text-[13px] ${textSecondary} mb-4`}>
                This API key can see more than one RevenueCat project. Pick the one you want to connect — you can
                reconnect with a different key later from Integrations.
              </p>
              <Field label="Project">
                <select
                  className={inputCls}
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  {projectOptions.map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.projectName} ({p.projectId})
                    </option>
                  ))}
                </select>
              </Field>
              <button
                onClick={() => submit(selectedProjectId)}
                disabled={connecting}
                className={`${btnPrimary} w-full mt-5`}
              >
                {connecting ? "Connecting…" : "Connect this project"}
              </button>
            </>
          ) : (
            <>
              <p className={`text-[13px] ${textSecondary} mb-4`}>
                Marteso uses RevenueCat's API to pull subscription and revenue data next to your ASO metrics.
                RevenueCat Secret API keys are scoped to one project — this connects only the currently selected
                app; connect each of your other apps separately from their own Integrations page.
              </p>

              <ol className={`text-[13px] ${textSecondary} space-y-1.5 mb-4 list-decimal list-inside`}>
                <li>
                  In RevenueCat, go to{" "}
                  <span className={`font-medium ${textPrimary}`}>Project settings → API keys</span>
                </li>
                <li>
                  Create or copy a <span className={`font-medium ${textPrimary}`}>Secret API key</span> (starts
                  with <code className="text-[11px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] px-1.5 py-0.5 rounded">sk_</code>)
                </li>
                <li>Paste it below — we'll detect which project it belongs to.</li>
              </ol>

              <Field label="Secret API Key">
                <input
                  className={inputCls}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </Field>

              <p className={`text-[11px] ${textMuted} mt-3 mb-5`}>
                Your API key is encrypted at rest and only used to read data from RevenueCat on our servers.
              </p>

              <button
                onClick={() => submit()}
                disabled={!apiKey.trim() || connecting}
                className={`${btnPrimary} w-full`}
              >
                {connecting ? "Verifying…" : "Connect"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
