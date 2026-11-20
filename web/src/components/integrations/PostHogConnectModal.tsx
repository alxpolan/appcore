import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { borderDefault, btnPrimary, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import Field from "../settings/Field";

interface Props {
  onClose: () => void;
  onConnected: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

interface ProjectOption {
  projectId: string;
  projectName: string;
  organizationName: string;
}

const HOST_OPTIONS = [
  { value: "https://us.posthog.com", label: "US Cloud (us.posthog.com)" },
  { value: "https://eu.posthog.com", label: "EU Cloud (eu.posthog.com)" },
  { value: "custom", label: "Self-hosted / other" },
];

export default function PostHogConnectModal({ onClose, onConnected, addToast }: Props) {
  const [hostOption, setHostOption] = useState(HOST_OPTIONS[0].value);
  const [customHost, setCustomHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const host = hostOption === "custom" ? customHost.trim() : hostOption;

  const submit = async (projectId?: string) => {
    setConnecting(true);
    try {
      const result = await apiPost<{
        ok?: boolean;
        projectName?: string;
        needsProjectSelection?: boolean;
        projects?: ProjectOption[];
      }>("/posthog/connect", { apiKey, host, projectId });
      if (result.needsProjectSelection && result.projects) {
        setProjectOptions(result.projects);
        setSelectedProjectId(result.projects[0]?.projectId ?? "");

        return;
      }
      addToast(`Connected to PostHog (${result.projectName})`, "success");
      onConnected();
      onClose();
    } catch (err: any) {
      addToast(err.message ?? "Failed to connect PostHog", "error");
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
          <h2 className={`text-lg font-semibold ${textPrimary}`}>Connect PostHog</h2>
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
                This API key can see more than one PostHog project. Pick the one you want to connect — you can
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
                      {p.projectName} ({p.organizationName})
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
                Marteso uses PostHog's API to pull product analytics like funnels, retention and events next to
                your ASO metrics.
              </p>

              <ol className={`text-[13px] ${textSecondary} space-y-1.5 mb-4 list-decimal list-inside`}>
                <li>
                  In PostHog, go to <span className={`font-medium ${textPrimary}`}>Settings → Personal API keys</span>
                </li>
                <li>
                  Create a key with read access to{" "}
                  <span className={`font-medium ${textPrimary}`}>Project</span> and{" "}
                  <span className={`font-medium ${textPrimary}`}>Organization</span> scopes
                </li>
                <li>Pick your region below and paste the key — we'll detect which project it belongs to.</li>
              </ol>

              <Field label="Region">
                <select className={inputCls} value={hostOption} onChange={(e) => setHostOption(e.target.value)}>
                  {HOST_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>

              {hostOption === "custom" && (
                <div className="mt-3">
                  <Field label="PostHog URL">
                    <input
                      className={inputCls}
                      value={customHost}
                      onChange={(e) => setCustomHost(e.target.value)}
                      placeholder="https://posthog.example.com"
                    />
                  </Field>
                </div>
              )}

              <div className="mt-3">
                <Field label="Personal API Key">
                  <input
                    className={inputCls}
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="phx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  />
                </Field>
              </div>

              <p className={`text-[11px] ${textMuted} mt-3 mb-5`}>
                Your API key is encrypted at rest and only used to read data from PostHog on our servers.
              </p>

              <button
                onClick={() => submit()}
                disabled={!apiKey.trim() || !host || connecting}
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
