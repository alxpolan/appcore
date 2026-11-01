import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useApi, apiPatch } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { inputCls, textMuted, textPrimary, textSecondary } from "../../styles";
import { getDeviceLabel, thumbUrl, DEVICES, type FramedJob } from "../../utils/screenshotUtils";
import { Camera, ChevronLeft, ChevronRight, X } from "lucide-react";

type ToastFn = (msg: string, type: "success" | "error" | "info") => void;

export const LIVE_DISPLAY_TYPE_LABELS: Record<string, string> = {
  APP_IPHONE_69: 'iPhone 6.9"',
  APP_IPHONE_67: 'iPhone 6.7"',
  APP_IPHONE_65: 'iPhone 6.5"',
  APP_IPHONE_63: 'iPhone 6.3"',
  APP_IPHONE_61: 'iPhone 6.1"',
  APP_IPHONE_58: 'iPhone 5.8"',
  APP_IPHONE_55: 'iPhone 5.5"',
  APP_IPHONE_47: 'iPhone 4.7"',
  APP_IPHONE_40: 'iPhone 4.0"',
  APP_IPHONE_35: 'iPhone 3.5"',
  APP_IPAD_PRO_3GEN_129: 'iPad 12.9"',
  APP_IPAD_PRO_129: 'iPad 12.9"',
  APP_IPAD_PRO_3GEN_11: 'iPad 11"',
  APP_IPAD_13: 'iPad 13"',
  APP_IPAD_PRO_11: 'iPad 11"',
  APP_IPAD_105: 'iPad 10.5"',
  APP_IPAD_97: 'iPad 9.7"',
};

const LIVE_DEVICE_ORDER = [
  'iPhone 6.9"',
  'iPhone 6.7"',
  'iPhone 6.5"',
  'iPhone 6.3"',
  'iPhone 6.1"',
  'iPhone 5.8"',
  'iPhone 5.5"',
  'iPhone 4.7"',
  'iPhone 4.0"',
  'iPhone 3.5"',
  'iPad 13"',
  'iPad 12.9"',
  'iPad 11"',
  'iPad 10.5"',
  'iPad 9.7"',
];

export type LiveScreenshot = {
  id: string;
  displayType: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
};

interface SelectableScreenshotJob {
  id: string;
  commitSha: string | null;
  commitMessage: string | null;
  branch: string | null;
  createdAt: string;
}

function ConnectedScreenshotsSelect({ appId, addToast }: { appId: string; addToast: ToastFn }) {
  const { canWrite } = usePermissions();
  const { data: screenshotData } = useApi<{ jobs: SelectableScreenshotJob[] }>(
    `/github/screenshots/framed-history/${appId}`,
    [appId],
    true,
  );
  const {
    data: selection,
    refetch: refetchSelection,
  } = useApi<{ selectedBuildJobId: string | null; selectedScreenshotJobId: string | null }>(
    `/apps/${appId}/build-screenshot-selection`,
    [appId],
    true,
  );
  const [savingScreenshots, setSavingScreenshots] = useState(false);

  const screenshotJobs = screenshotData?.jobs ?? [];

  if (screenshotJobs.length === 0) return null;

  const screenshotLabel = (j: SelectableScreenshotJob) =>
    `${j.commitMessage || (j.commitSha ? j.commitSha.slice(0, 7) : "Run")}${j.branch ? ` · ${j.branch}` : ""} · ${new Date(
      j.createdAt,
    ).toLocaleDateString()}`;

  const selectScreenshots = async (id: string) => {
    setSavingScreenshots(true);
    try {
      await apiPatch(`/apps/${appId}`, { selectedScreenshotJobId: id || null });
      addToast(id ? "Screenshot run connected" : "Reverted to latest screenshot run", "success");
      refetchSelection();
    } catch (err: any) {
      addToast(`Failed to update: ${err.message}`, "error");
    } finally {
      setSavingScreenshots(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Camera className={`w-3.5 h-3.5 ${textMuted}`} />
      <select
        className={`${inputCls} !w-auto !py-1 text-[11px]`}
        disabled={!canWrite || savingScreenshots}
        value={selection?.selectedScreenshotJobId ?? ""}
        onChange={(e) => selectScreenshots(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">Latest run (auto)</option>
        {screenshotJobs.map((j) => (
          <option key={j.id} value={j.id}>
            {screenshotLabel(j)}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface LiveScreenshotsSource {
  url: string;
  sourceLabel: string;
}

interface ConnectedScreenshotsPanelProps {
  appId: string;
  activeLocale: string | null;
  addToast: ToastFn;
  manageLink?: string;
  liveFallback: (locale: string) => LiveScreenshotsSource | null;
}

// Shows the latest CI-rendered screenshots for the active locale, with a selector to pick
// a specific past run. Falls back to a read-only live source (no CI run for this locale yet).
export function ConnectedScreenshotsPanel({
  appId,
  activeLocale,
  addToast,
  manageLink,
  liveFallback,
}: ConnectedScreenshotsPanelProps) {
  const { data, loading } = useApi<{ job: FramedJob | null }>(`/github/screenshots/latest-framed/${appId}`, [appId]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
  const hasLocalForActive = activeLocale ? locales.includes(activeLocale) : false;
  const effectiveLocale = activeLocale && hasLocalForActive ? activeLocale : (locales[0] ?? null);

  const fallback = !loading && !hasLocalForActive && activeLocale ? liveFallback(activeLocale) : null;

  if (fallback) {
    return <LiveScreenshotsPanel url={fallback.url} sourceLabel={fallback.sourceLabel} />;
  }

  if (loading || !job || locales.length === 0) return null;

  const screenshots = effectiveLocale ? (framedByLocale[effectiveLocale] ?? []) : [];
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
      <div className="pb-5 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`text-[14px] font-bold ${textPrimary}`}>Screenshots</div>
            {manageLink && (
              <Link to={manageLink} className="text-[11px] font-medium text-[#595DD2] hover:underline underline-offset-2">
                Manage in Screenshots
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[11px] ${textSecondary} font-mono`}>
              {job.commitSha.slice(0, 7)}
              {job.branch ? ` · ${job.branch}` : ""}
              {effectiveLocale ? ` · ${effectiveLocale}` : ""}
            </span>
            <ConnectedScreenshotsSelect appId={appId} addToast={addToast} />
          </div>
        </div>

        {screenshots.length === 0 ? (
          <p className="text-[12px] text-[#9ca3af] py-3 text-center">No screenshots for {effectiveLocale}.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {sortedGroups.map(([label, urls]) => (
              <div key={label}>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className={`text-[11px] font-bold ${textMuted}`}>{label}</div>
                  <span className="text-[10px] text-[#c8cdd3] dark:text-[#3a4050]">- max 10</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {urls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setPreviewUrl(url)}
                      className="block text-left shrink-0 group/img"
                      aria-label={`Open ${label} screenshot preview`}
                    >
                      <img
                        src={thumbUrl(url, 300)}
                        srcSet={`${thumbUrl(url, 300)} 1x, ${thumbUrl(url, 600)} 2x`}
                        alt={`${label} screenshot`}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        className="h-[200px] w-auto rounded-xl border border-[#eef0f3] object-cover shadow-sm group-hover/img:shadow-md group-hover/img:opacity-90 transition-all"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
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
    </>
  );
}

function LiveScreenshotsPanel({ url, sourceLabel }: { url: string; sourceLabel: string }) {
  const { data, loading } = useApi<{ screenshots: LiveScreenshot[] }>(url, [url]);
  const [preview, setPreview] = useState<LiveScreenshot | null>(null);

  useEffect(() => {
    if (!preview) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  if (loading || !data) return null;
  const screenshots = data.screenshots ?? [];
  if (screenshots.length === 0) return null;

  const grouped = new Map<string, LiveScreenshot[]>();
  for (const s of screenshots) {
    const label = LIVE_DISPLAY_TYPE_LABELS[s.displayType] ?? s.displayType;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(s);
  }

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const ia = LIVE_DEVICE_ORDER.indexOf(a);
    const ib = LIVE_DEVICE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <>
      <div className="pb-5 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
        <div className="flex items-center justify-between mb-4">
          <div className={`text-[14px] font-bold ${textPrimary}`}>Screenshots</div>
          <span className={`text-[10px] uppercase tracking-wide font-semibold text-[#9ca3af] dark:text-[#6b7280]`}>
            From App Store · {sourceLabel}
          </span>
        </div>

        <div className="flex flex-col gap-5">
          {sortedGroups.map(([label, items]) => (
            <div key={label}>
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`text-[11px] font-bold ${textMuted}`}>{label}</div>
                <span className="text-[10px] text-[#c8cdd3] dark:text-[#3a4050]">- {items.length}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPreview(s)}
                    className="block text-left shrink-0 group/img"
                    aria-label={`Open ${label} screenshot preview`}
                  >
                    <img
                      src={s.thumbUrl}
                      alt={`${label} screenshot`}
                      loading="lazy"
                      decoding="async"
                      className="h-[200px] w-auto rounded-xl border border-[#eef0f3] object-cover shadow-sm group-hover/img:shadow-md group-hover/img:opacity-90 transition-all"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6"
          onClick={() => setPreview(null)}
        >
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">
                {LIVE_DISPLAY_TYPE_LABELS[preview.displayType] ?? preview.displayType}
              </div>
              <div className="text-[11px] text-white/60 font-mono">{sourceLabel}</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
              }}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Close screenshot preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={preview.url}
            alt="Screenshot preview"
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
