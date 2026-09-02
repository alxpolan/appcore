import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Frame,
  GitBranch,
  Languages,
  MonitorSmartphone,
  Play,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useApi, apiPost, apiPatch, apiDelete, getActiveBundleId } from "../hooks/useApi";
import { usePermissions } from "../hooks/usePermissions";
import { RepoLinker, ScreenshotJobsTable } from "./Logs";
import {
  borderDefault,
  btnPrimary,
  btnSecondary,
  cardCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../styles";
import type { AppItem, AppRepoLink, GitHubStatus } from "../types";
import { getLocaleFlag, getLocaleName } from "../utils/localeUtils";
import { getDeviceLabel, thumbUrl, DEVICES, type FramedJob } from "../utils/screenshotUtils";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Screenshots({ addToast }: Props) {
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const bundleId = getActiveBundleId();
  const activeApp = apps?.find((a) => a.bundleId === bundleId && a.isOwnApp);

  if (!activeApp) {
    return (
      <div>
        <h1 className={`${pageTitle} mb-5`}>Screenshots</h1>
        <div className={`${cardCls} text-sm ${textMuted}`}>
          Select one of your own apps in the sidebar to use the screenshot pipeline.
        </div>
      </div>
    );
  }

  return <Studio key={activeApp.id} app={activeApp} addToast={addToast} />;
}

function Studio({ app, addToast }: { app: AppItem; addToast: Props["addToast"] }) {
  const { data: link, refetch: refetchLink } = useApi<AppRepoLink>(`/github/app-repo/${app.id}`, [app.id], true);
  const [reloadToken, setReloadToken] = useState(0);
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await apiPost(`/github/screenshots/trigger/${app.id}`);
      addToast("Screenshot run started", "success");
      setTimeout(() => setReloadToken((t) => t + 1), 800);
    } catch {
      addToast("Failed to start screenshot run", "error");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className={pageTitle}>Screenshots</h1>
          <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>
            Captured on iOS simulators, framed and captioned for every device size and locale, ready for the App Store.
          </p>
        </div>
        {link?.linked && (
          <button className={btnPrimary} onClick={handleTrigger} disabled={triggering}>
            {triggering ? <div className="spinner !w-3.5 !h-3.5" /> : <Camera className="w-4 h-4" />}
            {triggering ? "Starting…" : "Generate Screenshots"}
          </button>
        )}
      </div>

      {!link ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-10 justify-center">
          <div className="spinner !w-4 !h-4" /> Loading…
        </div>
      ) : !link.linked ? (
        <StudioIntro app={app} addToast={addToast} onLinked={refetchLink} />
      ) : (
        <>
          <StudioGallery appId={app.id} reloadToken={reloadToken} addToast={addToast} />
          <ScreenshotJobsTable
            appId={app.id}
            addToast={addToast}
            reloadToken={reloadToken}
            onJobFinished={() => setReloadToken((t) => t + 1)}
          />
          <p className={`text-[12px] ${textMuted}`}>
            Runs also start automatically on every push to{" "}
            <span className="font-mono">{link.branch ?? "the linked branch"}</span>. Repo, signing and pipeline settings
            live in{" "}
            <Link to="/app-settings" className="underline underline-offset-2 hover:text-[#C4001E]">
              App Settings
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

const INTRO_STEPS = [
  {
    icon: GitBranch,
    title: "1 · Link your repository",
    desc: "Connect the GitHub repo of your app. Marteso auto-detects the framework and sets up the pipeline.",
  },
  {
    icon: Play,
    title: "2 · Run the pipeline",
    desc: "Start a run with one click, or let every push to your branch generate fresh screenshots automatically.",
  },
  {
    icon: Upload,
    title: "3 · Review and publish",
    desc: "Curate and reorder the results, then push them to App Store Connect together with your metadata.",
  },
];

const INTRO_FEATURES = [
  { icon: MonitorSmartphone, label: "iPhone and iPad sizes" },
  { icon: Languages, label: "Every locale of your app" },
  { icon: Frame, label: "Device frames" },
  { icon: Wand2, label: "AI-written captions" },
];

function StudioIntro({ app, addToast, onLinked }: { app: AppItem; addToast: Props["addToast"]; onLinked: () => void }) {
  const { data: ghStatus } = useApi<GitHubStatus>("/github/status", [], true);

  return (
    <>
      <div className={`${cardCls} mb-5`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D94412] to-[#C4001E] flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className={`text-[18px] font-semibold ${textPrimary}`}>Your App Store screenshots, on autopilot</h2>
            <p className={`text-[13px] ${textSecondary}`}>
              Marteso clones your repo, drives your app through real iOS simulators and returns polished, framed
              screenshots. No design tool, no manual capturing.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          {INTRO_STEPS.map((step) => (
            <div key={step.title} className={`border ${borderDefault} rounded-xl p-4 bg-[#fafbfc] dark:bg-[#252b38]`}>
              <step.icon className="w-5 h-5 text-[#C4001E] mb-2" />
              <div className={`text-[13px] font-semibold ${textPrimary} mb-1`}>{step.title}</div>
              <div className={`text-[12px] ${textSecondary} leading-relaxed`}>{step.desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {INTRO_FEATURES.map((f) => (
            <span
              key={f.label}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${borderDefault} text-[12px] ${textSecondary}`}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <StudioRepoLinker app={app} connected={!!ghStatus?.connected} addToast={addToast} onLinked={onLinked} />
    </>
  );
}

function StudioRepoLinker({
  app,
  connected,
  addToast,
  onLinked,
}: {
  app: AppItem;
  connected: boolean;
  addToast: Props["addToast"];
  onLinked: () => void;
}) {
  return (
    <RepoLinker
      appId={app.id}
      appName={app.displayName ?? app.name}
      connected={connected}
      addToast={addToast}
      onChanged={onLinked}
    />
  );
}

function StudioGallery({
  appId,
  reloadToken,
  addToast,
}: {
  appId: string;
  reloadToken: number;
  addToast: Props["addToast"];
}) {
  const { canWrite } = usePermissions();
  const { data, loading, refetch } = useApi<{ job: FramedJob | null }>(`/github/screenshots/latest-framed/${appId}`, [
    appId,
    reloadToken,
  ]);
  const [activeLocale, setActiveLocale] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [orderOverride, setOrderOverride] = useState<Record<string, string[]>>({});
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null);
  const [dragOverUrl, setDragOverUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingReorder, setPendingReorder] = useState<{ locale: string; urls: string[] } | null>(null);
  const [savingReorder, setSavingReorder] = useState<"one" | "all" | null>(null);

  useEffect(() => {
    setOrderOverride({});
  }, [data?.job?.id]);

  useEffect(() => {
    if (!previewUrl) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewUrl(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewUrl]);

  const job = data?.job;
  const framedByLocale = job?.framedByLocale ?? {};
  const locales = Object.keys(framedByLocale).filter((l) => (framedByLocale[l]?.length ?? 0) > 0);
  const effectiveLocale = activeLocale && locales.includes(activeLocale) ? activeLocale : (locales[0] ?? null);

  if (loading && !data) {
    return (
      <div
        className={`${cardCls} mb-5 flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-8 justify-center`}
      >
        <div className="spinner !w-4 !h-4" /> Loading screenshots…
      </div>
    );
  }

  if (!job || locales.length === 0) {
    return (
      <div className={`${cardCls} mb-5 text-center py-10`}>
        <Camera className="w-6 h-6 mx-auto mb-2 text-gray-300 dark:text-[#3a4050]" />
        <div className={`text-sm font-medium ${textPrimary} mb-1`}>No screenshots yet</div>
        <p className={`text-[13px] ${textSecondary}`}>
          Hit Generate Screenshots to start your first run. Results show up here once it completes.
        </p>
      </div>
    );
  }

  const deleteScreenshot = async (jobId: string, url: string) => {
    if (!canWrite) return;
    if (!confirm("Remove this screenshot?")) return;

    setDeleting(url);
    try {
      await apiDelete(`/github/screenshots/framed/${jobId}`, { url });
      addToast("Screenshot removed", "success");
      refetch();
    } catch (err: any) {
      addToast(`Failed to remove: ${err.message}`, "error");
    } finally {
      setDeleting(null);
    }
  };

  const persistOrder = async (jobId: string, locale: string, urls: string[]) => {
    if (!canWrite) return;
    try {
      await apiPatch(`/github/screenshots/framed/${jobId}/reorder`, { locale, urls });
    } catch (err: any) {
      addToast(`Failed to reorder: ${err.message}`, "error");
      setOrderOverride((prev) => {
        const next = { ...prev };
        delete next[locale];
        return next;
      });
    }
  };

  const screenshots = effectiveLocale ? (orderOverride[effectiveLocale] ?? framedByLocale[effectiveLocale] ?? []) : [];
  const grouped = new Map<string, string[]>();

  for (const url of screenshots) {
    const label = getDeviceLabel(url);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(url);
  }

  const deviceOrder = (label: string) => {
    const idx = DEVICES.findIndex(([, l]) => l === label);
    return idx === -1 ? 99 : idx;
  };

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => deviceOrder(a) - deviceOrder(b));

  const handleDrop = (targetUrl: string) => {
    const sourceUrl = draggingUrl;
    setDraggingUrl(null);
    setDragOverUrl(null);
    if (!sourceUrl || !effectiveLocale || sourceUrl === targetUrl) return;
    if (getDeviceLabel(sourceUrl) !== getDeviceLabel(targetUrl)) return;

    const next = [...screenshots];
    const from = next.indexOf(sourceUrl);
    const to = next.indexOf(targetUrl);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, sourceUrl);

    setOrderOverride((prev) => ({ ...prev, [effectiveLocale]: next }));
    if (locales.length > 1) {
      setPendingReorder({ locale: effectiveLocale, urls: next });
    } else {
      persistOrder(job.id, effectiveLocale, next);
    }
  };

  const confirmReorder = async (applyToAll: boolean) => {
    if (!pendingReorder) return;
    setSavingReorder(applyToAll ? "all" : "one");
    try {
      await apiPatch(`/github/screenshots/framed/${job.id}/reorder`, {
        locale: pendingReorder.locale,
        urls: pendingReorder.urls,
        allLocales: applyToAll,
      });
      if (applyToAll) {
        setOrderOverride({});
        refetch();
      }
      addToast(applyToAll ? "Order applied to all languages" : `Order saved for ${pendingReorder.locale}`, "success");
    } catch (err: any) {
      addToast(`Failed to reorder: ${err.message}`, "error");
      setOrderOverride((prev) => {
        const next = { ...prev };
        delete next[pendingReorder.locale];
        return next;
      });
    } finally {
      setSavingReorder(null);
      setPendingReorder(null);
    }
  };

  const cancelReorder = () => {
    if (pendingReorder) {
      setOrderOverride((prev) => {
        const next = { ...prev };
        delete next[pendingReorder.locale];
        return next;
      });
      refetch();
    }
    setPendingReorder(null);
  };

  const previewIndex = previewUrl ? screenshots.indexOf(previewUrl) : -1;
  const previewLabel = previewUrl ? getDeviceLabel(previewUrl) : "";
  const showPreviousPreview = () => {
    if (previewIndex <= -1 || screenshots.length === 0) return;
    setPreviewUrl(screenshots[(previewIndex - 1 + screenshots.length) % screenshots.length]);
  };
  const showNextPreview = () => {
    if (previewIndex <= -1 || screenshots.length === 0) return;
    setPreviewUrl(screenshots[(previewIndex + 1) % screenshots.length]);
  };

  return (
    <>
      <div className={`${cardCls} mb-5`}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className={`text-[16px] font-semibold ${textPrimary}`}>Latest Screenshots</h2>
          <span className={`text-[11px] ${textSecondary} font-mono`}>
            {job.commitSha.slice(0, 7)}
            {job.branch ? ` · ${job.branch}` : ""}
            {` · ${new Date(job.createdAt).toLocaleDateString()}`}
          </span>
        </div>

        {locales.length > 1 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {locales.map((locale) => (
              <button
                key={locale}
                onClick={() => setActiveLocale(locale)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border transition-all ${
                  locale === effectiveLocale
                    ? "border-[#C4001E] text-[#C4001E] bg-[#C4001E]/5"
                    : `${borderDefault} ${textSecondary} hover:border-[#C4001E] hover:text-[#C4001E]`
                }`}
              >
                <span>{getLocaleFlag(locale)}</span>
                {getLocaleName(locale)}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-5">
          {sortedGroups.map(([label, urls]) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`text-[11px] font-bold ${textMuted}`}>{label}</div>
                <span className="text-[10px] text-[#c8cdd3] dark:text-[#3a4050]">- max 10</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {urls.map((url) => {
                  const isDragging = draggingUrl === url;
                  const isDropTarget =
                    dragOverUrl === url && draggingUrl && draggingUrl !== url && getDeviceLabel(draggingUrl) === label;
                  return (
                    <div
                      key={url}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        setDraggingUrl(url);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggingUrl(null);
                        setDragOverUrl(null);
                      }}
                      onDragOver={(e) => {
                        if (!draggingUrl || draggingUrl === url) return;
                        if (getDeviceLabel(draggingUrl) !== label) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragOverUrl !== url) setDragOverUrl(url);
                      }}
                      onDragLeave={() => {
                        if (dragOverUrl === url) setDragOverUrl(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDrop(url);
                      }}
                      className={`relative shrink-0 group/img cursor-grab active:cursor-grabbing transition-all ${
                        isDragging ? "opacity-40" : ""
                      } ${isDropTarget ? "ring-2 ring-[#D94412] ring-offset-2 rounded-xl" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewUrl(url)}
                        className="block text-left"
                        aria-label={`Open ${label} screenshot preview`}
                      >
                        <img
                          src={thumbUrl(url, 300)}
                          srcSet={`${thumbUrl(url, 300)} 1x, ${thumbUrl(url, 600)} 2x`}
                          alt={`${label} screenshot`}
                          draggable={false}
                          loading="lazy"
                          decoding="async"
                          className="h-[220px] w-auto rounded-xl border border-[#eef0f3] object-cover shadow-sm group-hover/img:shadow-md group-hover/img:opacity-90 transition-all"
                        />
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteScreenshot(job.id, url);
                          }}
                          disabled={deleting === url}
                          title="Remove screenshot"
                          className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover/img:opacity-100 hover:bg-red-600 transition-all disabled:opacity-50"
                        >
                          {deleting === url ? <div className="spinner !w-3.5 !h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{previewLabel}</div>
              {effectiveLocale && (
                <div className="text-[11px] text-white/60 font-mono">
                  {effectiveLocale}
                  {previewIndex > -1 ? ` · ${previewIndex + 1}/${screenshots.length}` : ""}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewUrl(null);
              }}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Close screenshot preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {screenshots.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  showPreviousPreview();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                aria-label="Previous screenshot"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  showNextPreview();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                aria-label="Next screenshot"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <img
            src={previewUrl}
            alt={`${previewLabel} screenshot preview`}
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {pendingReorder && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4"
          onClick={cancelReorder}
        >
          <div className={`${cardCls} w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
            <p className={`text-[15px] font-semibold ${textPrimary} mb-4`}>Apply to all locales?</p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button className={btnSecondary} onClick={() => confirmReorder(false)} disabled={!!savingReorder}>
                {savingReorder === "one" ? "Saving…" : `Only ${getLocaleName(pendingReorder.locale)}`}
              </button>
              <button className={btnPrimary} onClick={() => confirmReorder(true)} disabled={!!savingReorder}>
                {savingReorder === "all" ? "Applying…" : "All locales"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
