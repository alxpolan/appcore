import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, GitBranch } from "lucide-react";
import { useApi, apiPost, apiPut, getActiveBundleId, authHeaders } from "../hooks/useApi";
import {
  badgeOutline,
  borderDefault,
  btnPrimary,
  btnSecSm,
  btnSecondary,
  cardCls,
  pageTitle,
  textPrimary,
  textSecondary,
} from "../styles";
import type { GitHubRepo, AppRepoLink, RepoBranch, ScreenshotJob, BuildJob, AppItem, Framework } from "../types";

const FRAMEWORK_LABELS: Record<Framework, string> = {
  capacitor: "Capacitor",
  native: "iOS native",
};

const LOG_PREFIX_COLORS: { prefix: string; color: string }[] = [
  { prefix: "[capture]", color: "#38bdf8" },
  { prefix: "[repo]", color: "#b700ff" },
  { prefix: "[build]", color: "#a78bfa" },
  { prefix: "[frame]", color: "#34d399" },
  { prefix: "[framing]", color: "#b9fc00" },
  { prefix: "[signing]", color: "#38c600" },
  { prefix: "[config]", color: "#0169fb" },
];

function renderLogLine(line: string, i: number) {
  const entry = LOG_PREFIX_COLORS.find(({ prefix }) => line.startsWith(prefix));
  if (entry) {
    return (
      <span key={i} className="block text-[#e5e7eb]">
        <span style={{ color: entry.color }}>{entry.prefix}</span>
        {line.slice(entry.prefix.length)}
      </span>
    );
  }
  return (
    <span key={i} className="block text-[#e5e7eb]">
      {line}
    </span>
  );
}

function useLazyLogs(path: string | null) {
  const [logs, setLogs] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path || logs !== null || loading) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api${path}`, { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setLogs(Array.isArray(d.logs) ? d.logs : []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { logs, loading, error };
}

function useStreamingLogs(jobId: string | null, appId: string | null, active: boolean) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId || !appId || !active) return;

    let es: EventSource | null = null;
    let cancelled = false;
    let replaying = true;
    const replayBatch: string[] = [];

    function connect() {
      if (cancelled) return;
      replaying = true;
      replayBatch.length = 0;
      const url = `/api/github/screenshots/${appId}/${jobId}/logs/stream`;
      es = new EventSource(url);

      es.addEventListener("log", (e) => {
        if (cancelled) return;
        const line = JSON.parse((e as MessageEvent).data) as string;
        if (replaying) {
          replayBatch.push(line);
        } else {
          setLines((prev) => [...prev, line]);
          setLiveCount((n) => n + 1);
        }
      });

      es.addEventListener("done", () => {
        if (cancelled) return;
        if (replaying && replayBatch.length > 0) {
          setLines((prev) => [...prev, ...replayBatch]);
        }
        replaying = false;
        setDone(true);
        es?.close();
      });

      es.addEventListener("waiting", () => {
        if (replaying && replayBatch.length > 0) {
          setLines((prev) => [...prev, ...replayBatch]);
        }
        replaying = false;
        es?.close();
        if (!cancelled) retryRef.current = setTimeout(connect, 2000);
      });

      es.onerror = () => {
        if (replaying && replayBatch.length > 0) {
          setLines((prev) => [...prev, ...replayBatch]);
        }
        replaying = false;
        es?.close();
        if (!cancelled) retryRef.current = setTimeout(connect, 3000);
      };

      // flush replay batch once server stops sending buffered lines
      setTimeout(() => {
        if (replaying && !cancelled) {
          if (replayBatch.length > 0) setLines((prev) => [...prev, ...replayBatch]);
          replaying = false;
        }
      }, 500);
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [jobId, appId, active]);

  return { lines, done, liveCount };
}

function LogsBlock({ logs, loading, error }: { logs: string[] | null; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-[12px] ${textSecondary} py-2`}>
        <div className="spinner !w-3 !h-3" /> Loading logs…
      </div>
    );
  }
  if (error) {
    return <div className="text-[12px] text-red-500">Failed to load logs: {error}</div>;
  }
  if (!logs || logs.length === 0) {
    return <div className={`text-[12px] ${textSecondary}`}>No logs captured.</div>;
  }
  return (
    <div>
      <div className={`text-[11px] font-medium ${textSecondary} uppercase tracking-wide mb-1`}>
        Logs ({logs.length} lines)
      </div>
      <pre className="text-[11px] bg-[#111827] rounded-lg p-3 overflow-x-auto max-h-[400px] overflow-y-auto font-mono leading-relaxed">
        {logs.map(renderLogLine)}
      </pre>
    </div>
  );
}

export function RepoLinker({
  appId,
  appName,
  connected,
  addToast,
}: {
  appId: string;
  appName: string;
  connected: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data: link, refetch } = useApi<AppRepoLink>(`/github/app-repo/${appId}`, [appId], true);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [dirs, setDirs] = useState<string[] | null>(null);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string>("");
  const [framework, setFramework] = useState<Framework>("native");
  const [detectingFramework, setDetectingFramework] = useState(false);
  const [savingFramework, setSavingFramework] = useState(false);
  const [branches, setBranches] = useState<RepoBranch[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [savingBranch, setSavingBranch] = useState(false);
  const [step, setStep] = useState<"repo" | "dir">("repo");
  const [linking, setLinking] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const loadRepos = async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/github/repos", { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRepos(await res.json());
    } catch (err: any) {
      addToast(`Failed to load repos: ${err.message}`, "error");
    } finally {
      setLoadingRepos(false);
    }
  };

  const loadDirs = async (repoFullName: string) => {
    const [owner, repo] = repoFullName.split("/");
    setLoadingDirs(true);
    setDirs(null);
    try {
      const res = await fetch(`/api/github/repo-dirs/${owner}/${repo}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDirs(await res.json());
    } catch (err: any) {
      addToast(`Failed to load directories: ${err.message}`, "error");
      setDirs([]);
    } finally {
      setLoadingDirs(false);
    }
  };

  const loadBranches = async (repoFullName: string, preselect?: string | null) => {
    const [owner, repo] = repoFullName.split("/");
    setLoadingBranches(true);
    setBranches(null);
    try {
      const res = await fetch(`/api/github/repo-branches/${owner}/${repo}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RepoBranch[];
      setBranches(data);
      // Keep an already-linked branch if it still exists, otherwise fall back to the
      // repo default, which the API sorts to the front.
      const keep = preselect && data.some((b) => b.name === preselect) ? preselect : null;
      setSelectedBranch(keep ?? data.find((b) => b.isDefault)?.name ?? data[0]?.name ?? "");
    } catch (err: any) {
      addToast(`Failed to load branches: ${err.message}`, "error");
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  };

  const detectFramework = async (repoFullName: string) => {
    const [owner, repo] = repoFullName.split("/");
    setDetectingFramework(true);
    try {
      const res = await fetch(`/api/github/detect-framework/${owner}/${repo}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { framework: Framework };
      setFramework(data.framework);
    } catch {
      setFramework("native");
    } finally {
      setDetectingFramework(false);
    }
  };

  const handleRepoNext = () => {
    if (!selectedRepo) return;
    setStep("dir");
    setSelectedDir("");
    loadDirs(selectedRepo);
    loadBranches(selectedRepo, selectedRepo === link?.repoFullName ? link?.branch : null);
    detectFramework(selectedRepo);
  };

  const handleLink = async () => {
    if (!selectedRepo) return;
    setLinking(true);
    try {
      await apiPost("/github/link", {
        appId,
        repoFullName: selectedRepo,
        iosDir: selectedDir || null,
        framework,
        branch: selectedBranch || null,
      });
      addToast(`Linked ${selectedRepo} → ${appName}`, "success");
      setShowPicker(false);
      setSelectedRepo("");
      setSelectedDir("");
      setStep("repo");
      refetch();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setLinking(false);
    }
  };

  const handleFrameworkChange = async (next: Framework) => {
    setSavingFramework(true);
    try {
      await apiPut(`/github/framework/${appId}`, { framework: next });
      addToast(`Framework set to ${FRAMEWORK_LABELS[next]}`, "success");
      refetch();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingFramework(false);
    }
  };

  const handleBranchChange = async (next: string) => {
    setSavingBranch(true);
    try {
      await apiPut(`/github/branch/${appId}`, { branch: next });
      addToast(`Branch set to ${next}`, "success");
      refetch();
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingBranch(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm("Remove the repo link? The webhook will be deleted.")) return;
    try {
      await apiPost("/github/unlink", { appId });
      addToast("Repo unlinked", "info");
      refetch();
    } catch (err: any) {
      addToast(err.message, "error");
    }
  };

  // Populates the branch dropdown on the linked card. Keyed on primitives so a refetch
  // after saving does not retrigger the load.
  useEffect(() => {
    if (link?.linked && link.repoFullName) {
      loadBranches(link.repoFullName, link.branch);
    }
  }, [link?.linked, link?.repoFullName]);

  const openPicker = () => {
    setShowPicker(true);
    setStep("repo");
    setSelectedDir("");
    setFramework(link?.framework ?? "native");
    if (!repos) loadRepos();
  };

  return (
    <div className={`${cardCls} mb-5`}>
      <h2 className={`text-[18px] font-semibold ${textPrimary} mb-1`}>GitHub Repository</h2>
      <p className={`text-xs ${textSecondary} mb-4`}>
        Link a GitHub repo to this app. On every push, Marteso will automatically generate screenshots and binary.
      </p>

      {link?.linked ? (
        <div className="flex flex-col gap-3">
          <div
            className={`flex justify-between gap-2 bg-[#f8f9fb] dark:bg-[#252b38] border ${borderDefault} rounded-xl px-4 py-2.5 w-full`}
          >
            <div className="flex items-center gap-3">
              <GitBranch className={`w-5 h-5 ${textPrimary}`} />
              <div>
                <div className={`text-sm font-medium ${textPrimary}`}>{link.repoFullName}</div>
                <div className={`text-[11px] ${textSecondary}`}>
                  {link.iosDir ? `iOS folder: ${link.iosDir}/` : "Repo connected"}
                </div>
              </div>
            </div>
            <div>
              <button className={btnSecSm} onClick={handleUnlink}>
                Unlink
              </button>
              {connected && (
                <button className={btnSecSm} onClick={openPicker}>
                  Change
                </button>
              )}
            </div>
          </div>
          <div
            className={`flex items-center justify-between gap-3 bg-[#f8f9fb] dark:bg-[#252b38] border ${borderDefault} rounded-xl px-4 py-2.5 w-full`}
          >
            <div className="flex">
              <img
                src={(link.framework ?? "native") === "capacitor" ? "/capacitor.svg" : "/native.svg"}
                alt={(link.framework ?? "native") === "capacitor" ? "Capacitor" : "Native"}
                className="h-7 w-auto pr-2 self-center"
              />
              <div>
                <div className={`text-sm font-medium ${textPrimary}`}>Framework</div>
                <div className={`text-[11px] ${textSecondary}`}>
                  Auto-detected on link - change it here if it&apos;s wrong.
                </div>
              </div>
            </div>
            <select
              className={`px-3 py-1.5 rounded-lg border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} disabled:opacity-50`}
              value={link.framework ?? "native"}
              disabled={savingFramework}
              onChange={(e) => handleFrameworkChange(e.target.value as Framework)}
            >
              <option value="capacitor">{FRAMEWORK_LABELS.capacitor}</option>
              <option value="native">{FRAMEWORK_LABELS.native}</option>
            </select>
          </div>
          <div
            className={`flex items-center justify-between gap-3 bg-[#f8f9fb] dark:bg-[#252b38] border ${borderDefault} rounded-xl px-4 py-2.5 w-full`}
          >
            <div className="flex items-center gap-3">
              <GitBranch className={`w-5 h-5 ${textPrimary}`} />
              <div>
                <div className={`text-sm font-medium ${textPrimary}`}>Branch</div>
                <div className={`text-[11px] ${textSecondary}`}>
                  {link.branch
                    ? "Only pushes to this branch trigger screenshots and builds."
                    : "No branch set - every push to any branch triggers a run."}
                </div>
              </div>
            </div>
            <select
              className={`px-3 py-1.5 rounded-lg border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} disabled:opacity-50`}
              value={link.branch ?? ""}
              disabled={savingBranch || loadingBranches}
              onChange={(e) => handleBranchChange(e.target.value)}
            >
              {loadingBranches && <option value="">Loading…</option>}
              {!loadingBranches && !link.branch && <option value="">— Any branch —</option>}
              {/* Keeps a deleted or renamed branch visible instead of silently showing another one. */}
              {link.branch && !branches?.some((b) => b.name === link.branch) && (
                <option value={link.branch}>{link.branch}</option>
              )}
              {branches?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div>
          {connected ? (
            <button className={btnPrimary} onClick={openPicker}>
              <GitBranch className="w-4 h-4" />
              Link Repository
            </button>
          ) : (
            <p className={`text-sm ${textSecondary}`}>Connect GitHub in Team Settings to link a repo.</p>
          )}
        </div>
      )}

      {showPicker && (
        <div className={`mt-4 border ${borderDefault} rounded-xl p-4 bg-[#f8f9fb] dark:bg-[#161920]`}>
          {step === "repo" ? (
            <>
              <h3 className={`text-sm font-medium ${textPrimary} mb-3`}>Select a repository</h3>
              {loadingRepos ? (
                <div className={`flex items-center gap-2 text-sm ${textSecondary} py-4`}>
                  <div className="spinner !w-4 !h-4" /> Loading repositories…
                </div>
              ) : (
                <>
                  <select
                    className={`w-full px-3 py-2 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} mb-3`}
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                  >
                    <option value="">— Choose a repo —</option>
                    {repos?.map((r) => (
                      <option key={r.id} value={r.fullName}>
                        {r.fullName}
                        {r.private ? " 🔒" : ""}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button className={btnPrimary} onClick={handleRepoNext} disabled={!selectedRepo}>
                      Next
                    </button>
                    <button className={btnSecondary} onClick={() => setShowPicker(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h3 className={`text-sm font-medium ${textPrimary} mb-0.5`}>iOS app folder</h3>
              <p className={`text-xs ${textSecondary} mb-3`}>
                Select the folder that contains the iOS app code (e.g. <code className="font-mono">ios</code> for React
                Native). Leave as root if the Xcode project is at the repo root.
              </p>
              {loadingDirs ? (
                <div className={`flex items-center gap-2 text-sm ${textSecondary} py-4`}>
                  <div className="spinner !w-4 !h-4" /> Scanning folders…
                </div>
              ) : (
                <>
                  <select
                    className={`w-full px-3 py-2 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} mb-3`}
                    value={selectedDir}
                    onChange={(e) => setSelectedDir(e.target.value)}
                  >
                    <option value="">/ (repo root)</option>
                    {dirs?.map((d) => (
                      <option key={d} value={d}>
                        {d}/
                      </option>
                    ))}
                  </select>

                  <h3 className={`text-sm font-medium ${textPrimary} mb-0.5`}>Branch</h3>
                  <p className={`text-xs ${textSecondary} mb-3`}>
                    {loadingBranches
                      ? "Loading branches…"
                      : "Only pushes to this branch trigger screenshots and builds."}
                  </p>
                  <select
                    className={`w-full px-3 py-2 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} mb-3 disabled:opacity-50`}
                    value={selectedBranch}
                    disabled={loadingBranches}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                  >
                    {branches?.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>

                  <h3 className={`text-sm font-medium ${textPrimary} mb-0.5`}>Framework</h3>
                  <p className={`text-xs ${textSecondary} mb-3`}>
                    {detectingFramework ? "Detecting…" : "Auto-detected - change it if it's wrong."}
                  </p>
                  <select
                    className={`w-full px-3 py-2 rounded-xl border ${borderDefault} bg-white dark:bg-[#1c2028] text-sm ${textPrimary} mb-3 disabled:opacity-50`}
                    value={framework}
                    disabled={detectingFramework}
                    onChange={(e) => setFramework(e.target.value as Framework)}
                  >
                    <option value="capacitor">{FRAMEWORK_LABELS.capacitor}</option>
                    <option value="native">{FRAMEWORK_LABELS.native}</option>
                  </select>

                  <div className="flex gap-2">
                    <button className={btnPrimary} onClick={handleLink} disabled={linking}>
                      {linking ? "Linking…" : "Link"}
                    </button>
                    <button className={btnSecondary} onClick={() => setStep("repo")}>
                      Back
                    </button>
                    <button className={btnSecondary} onClick={() => setShowPicker(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ScreenshotJobsTable({
  appId,
  addToast,
}: {
  appId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data: jobs, loading, refetch } = useApi<ScreenshotJob[]>(`/github/screenshots/${appId}`, [appId], true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await apiPost(`/github/screenshots/trigger/${appId}`);
      addToast("Screenshot job started", "success");
      setTimeout(refetch, 800);
    } catch {
      addToast("Failed to trigger screenshot job", "error");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className={`${cardCls} mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <h2 className={`text-[16px] font-semibold ${textPrimary}`}>Screenshot Jobs</h2>
        <button onClick={handleTrigger} disabled={triggering} className={btnSecSm}>
          {triggering ? "Starting…" : "Run Now"}
        </button>
      </div>
      <p className={`text-xs ${textSecondary} mb-4`}>Recent screenshot generation runs triggered by GitHub pushes.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-8 justify-center">
          <div className="spinner !w-4 !h-4" /> Loading…
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-[#5c6478]">
          No screenshot jobs yet. Link a repo and push a commit to trigger one.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              expanded={expandedJob === j.id}
              onToggle={() => setExpandedJob(expandedJob === j.id ? null : j.id)}
              addToast={addToast}
              onJobDone={() => setTimeout(refetch, 1000)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  expanded,
  onToggle,
  addToast,
  onJobDone,
}: {
  job: ScreenshotJob;
  expanded: boolean;
  onToggle: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  onJobDone?: () => void;
}) {
  const [framedUrls] = useState<string[]>([]);
  const isActive = job.status === "PENDING" || job.status === "RUNNING";

  const {
    logs: lazyLogs,
    loading: logsLoading,
    error: logsError,
  } = useLazyLogs(!isActive && expanded ? `/github/screenshots/${job.appId}/${job.id}/logs` : null);
  const {
    lines: streamLines,
    done: streamDone,
    liveCount,
  } = useStreamingLogs(isActive ? job.id : null, isActive ? job.appId : null, expanded);

  const logsRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [liveCount]);

  useEffect(() => {
    if (streamDone) onJobDone?.();
  }, [streamDone, onJobDone]);

  const displayLogs: string[] | null = isActive ? streamLines : lazyLogs;

  return (
    <div
      className={`bg-[#fafbfc] dark:bg-[#252b38] border ${borderDefault} ${textPrimary} hover:border-[#d1d5db] dark:hover:border-[#3a4050] rounded-xl overflow-hidden`}
    >
      <button
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[#fafbfc] dark:hover:bg-white/[0.03] transition-colors text-left"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-mono ${textPrimary}`}>{job.commitSha.slice(0, 7)}</span>
            <span className="text-[12px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] dark:text-[#8b93a5] px-1.5 py-0.5 rounded">
              {job.branch ?? "—"}
            </span>
            <span className={badgeOutline(job.status)}>{job.status}</span>
          </div>
          {job.commitMessage && (
            <div className={`text-[12px] ${textSecondary} truncate mt-0.5`}>{job.commitMessage}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[12px] ${textSecondary}`}>{job.pusher ? `by ${job.pusher}` : ""}</div>
          <div className={`text-[11px] ${textSecondary}`}>{new Date(job.createdAt).toLocaleString()}</div>
        </div>
        <ChevronDown
          className={`w-4 h-4 ${textSecondary} shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className={`border-t ${borderDefault} bg-[#fafbfc] dark:bg-[#161920] px-4 py-3`}>
          {job.error && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="text-[11px] font-medium text-red-700 uppercase tracking-wide mb-1">Error</div>
              <pre className="text-[12px] text-red-600 whitespace-pre-wrap break-all font-mono">{job.error}</pre>
            </div>
          )}

          {job.status === "COMPLETED" && (
            <div className="mb-3 flex items-center gap-3">
              {job.screenshotUrls.length > 0 && (
                <div className="text-[12px] text-emerald-700">{job.screenshotUrls.length} screenshot(s) generated</div>
              )}
            </div>
          )}

          {framedUrls.length > 0 && (
            <div className="mb-4">
              <div className={`text-[11px] font-medium ${textSecondary} uppercase tracking-wide mb-2`}>
                Framed ({framedUrls.length})
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {framedUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img
                      src={url}
                      alt="Framed screenshot"
                      className={`h-48 rounded-lg border ${borderDefault} object-cover hover:opacity-90 transition-opacity`}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {isActive ? (
            <div>
              <div
                className={`flex items-center gap-2 text-[11px] font-medium ${textSecondary} uppercase tracking-wide mb-1`}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live logs ({streamLines.length} lines)
              </div>
              {streamLines.length === 0 ? (
                <div className={`flex items-center gap-2 text-[12px] ${textSecondary} py-2`}>
                  <div className="spinner !w-3 !h-3" /> Waiting for logs…
                </div>
              ) : (
                <pre
                  ref={logsRef}
                  className="text-[11px] bg-[#111827] rounded-lg p-3 overflow-x-auto max-h-[400px] overflow-y-auto font-mono leading-relaxed"
                >
                  {streamLines.map(renderLogLine)}
                </pre>
              )}
            </div>
          ) : (
            <LogsBlock logs={displayLogs} loading={logsLoading} error={logsError} />
          )}
        </div>
      )}
    </div>
  );
}

export function BuildJobsTable({
  appId,
  addToast,
}: {
  appId: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const { data: jobs, loading, refetch } = useApi<BuildJob[]>(`/github/builds/${appId}`, [appId], true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await apiPost(`/github/builds/trigger/${appId}`);
      addToast("Build job started", "success");
      setTimeout(refetch, 800);
    } catch {
      addToast("Failed to trigger build job", "error");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className={`${cardCls} mb-5`}>
      <div className="flex items-center justify-between mb-1">
        <h2 className={`text-[16px] font-semibold ${textPrimary}`}>Build Jobs</h2>
        <button onClick={handleTrigger} disabled={triggering} className={btnSecSm}>
          {triggering ? "Starting…" : "Run Now"}
        </button>
      </div>
      <p className={`text-xs ${textSecondary} mb-4`}>Binary build runs triggered by GitHub pushes.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-8 justify-center">
          <div className="spinner !w-4 !h-4" /> Loading…
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-[#5c6478]">
          No build jobs yet. Link a repo and push a commit to trigger one.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((j) => (
            <BuildJobRow
              key={j.id}
              job={j}
              expanded={expandedJob === j.id}
              onToggle={() => setExpandedJob(expandedJob === j.id ? null : j.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BuildJobRow({ job, expanded, onToggle }: { job: BuildJob; expanded: boolean; onToggle: () => void }) {
  const {
    logs,
    loading: logsLoading,
    error: logsError,
  } = useLazyLogs(expanded ? `/github/builds/${job.appId}/${job.id}/logs` : null);

  return (
    <div
      className={`bg-[#fafbfc] dark:bg-[#252b38] border ${borderDefault} ${textPrimary} hover:border-[#d1d5db] dark:hover:border-[#3a4050] rounded-xl overflow-hidden`}
    >
      <button
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[#fafbfc] dark:hover:bg-white/[0.03] transition-colors text-left"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {job.commitSha && (
              <span className={`text-[13px] font-mono ${textPrimary}`}>{job.commitSha.slice(0, 7)}</span>
            )}
            {job.branch && (
              <span className="text-[12px] font-mono bg-[#f3f4f6] dark:bg-[#252b38] dark:text-[#8b93a5] px-1.5 py-0.5 rounded">
                {job.branch}
              </span>
            )}
            <span className={badgeOutline(job.status)}>{job.status}</span>
            {job.ipaPath && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">IPA ready</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-[11px] ${textSecondary}`}>{new Date(job.createdAt).toLocaleString()}</div>
        </div>
        <ChevronDown
          className={`w-4 h-4 ${textSecondary} shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className={`border-t ${borderDefault} bg-[#fafbfc] dark:bg-[#161920] px-4 py-3`}>
          {job.errors.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="text-[11px] font-medium text-red-700 uppercase tracking-wide mb-1">Errors</div>
              <pre className="text-[12px] text-red-600 whitespace-pre-wrap break-all font-mono">
                {job.errors.join("\n")}
              </pre>
            </div>
          )}
          <LogsBlock logs={logs} loading={logsLoading} error={logsError} />
        </div>
      )}
    </div>
  );
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Actions({ addToast }: Props) {
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const bundleId = getActiveBundleId();
  const activeApp = apps?.find((a) => a.bundleId === bundleId && a.isOwnApp);

  return (
    <div>
      <h1 className={`${pageTitle} mb-5`}>Logs</h1>

      {activeApp && (
        <>
          <BuildJobsTable appId={activeApp.id} addToast={addToast} />
          <ScreenshotJobsTable appId={activeApp.id} addToast={addToast} />
        </>
      )}
    </div>
  );
}
