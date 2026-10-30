import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Pencil, X } from "lucide-react";
import { apiGet, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { cardCls, inputCls, pageTitle, textMuted, textSecondary } from "../../styles";
import { getLocaleName } from "../../utils/localeUtils";
import { DEVICES } from "../../utils/screenshotUtils";
import StudioLayers from "./StudioLayers";
import StudioCanvas from "./StudioCanvas";
import StudioInspector from "./StudioInspector";
import StudioRevisions from "./StudioRevisions";
import { ensureStudioFont } from "./studioPreview";
import {
  DEFAULT_STUDIO_GEOMETRY,
  STUDIO_APPLY_GEOMETRY_KEYS,
  STUDIO_GEOMETRY_KEYS,
  revisionLabel,
  studioApi,
  type StudioBezels,
  type StudioData,
  type StudioLayer,
  type StudioOverlay,
  type StudioPresetInfo,
  type StudioProgressEvent,
  type StudioSaveLocale,
  type StudioStyle,
} from "./studioApi";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

type TitleDrafts = Record<string, Record<string, string>>;

interface StudioSnapshot {
  style: StudioStyle;
  shotOverrides: Record<string, Partial<StudioStyle>>;
  titles: TitleDrafts;
}

export default function Studio({ addToast }: Props) {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const requestedLocale = searchParams.get("locale");
  const { canWrite } = usePermissions();
  const { data, loading, refetch } = useApi<StudioData>(`/github/screenshots/studio/${jobId}`, [jobId], true);

  const [activeLocale, setActiveLocale] = useState<string | null>(null);
  const [selectedBasename, setSelectedBasename] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<StudioLayer | null>("caption");
  const [style, setStyle] = useState<StudioStyle | null>(null);
  const [shotOverrides, setShotOverrides] = useState<Record<string, Partial<StudioStyle>>>({});
  const [titles, setTitles] = useState<TitleDrafts>({});
  const [scope, setScope] = useState<"one" | "all">("all");
  const [revName, setRevName] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<StudioProgressEvent | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [renamingSet, setRenamingSet] = useState(false);
  const [setName, setSetName] = useState("");
  const [savingSetName, setSavingSetName] = useState(false);
  const draftAppliedRef = useRef<string | null>(null);
  const draftSavedRef = useRef(false);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [bezels, setBezels] = useState<StudioBezels | null>(null);
  const pastRef = useRef<StudioSnapshot[]>([]);
  const futureRef = useRef<StudioSnapshot[]>([]);
  const lastPushRef = useRef(0);
  const [, setHistoryTick] = useState(0);

  const baselineKey = data
    ? `${data.job.id}:${data.activeRevisionId ?? "orig"}:${data.revisions.length}:${data.presets.length}`
    : null;

  useEffect(() => {
    if (!data) return;

    setStyle(data.style);
    setShotOverrides(data.styles ?? {});

    const draftTitles: TitleDrafts = {};

    for (const locale of data.locales) {
      draftTitles[locale.locale] = Object.fromEntries(locale.items.map((item) => [item.basename, item.title]));
    }

    if (data.draft && draftAppliedRef.current !== data.job.id) {
      draftAppliedRef.current = data.job.id;
      draftSavedRef.current = true;
      setStyle(data.draft.style);
      setShotOverrides(data.draft.styles);

      const merged: TitleDrafts = { ...draftTitles };

      for (const [locale, localeTitles] of Object.entries(data.draft.titles)) {
        merged[locale] = { ...(draftTitles[locale] ?? {}), ...localeTitles };
      }

      setTitles(merged);
      addToast("Restored unsaved changes", "info");
    } else {
      setTitles(draftTitles);
    }

    setRevName("");
    pastRef.current = [];
    futureRef.current = [];
    lastPushRef.current = 0;
    setHistoryTick((tick) => tick + 1);

    if (!activeLocale || !data.locales.some((l) => l.locale === activeLocale)) {
      const fromUrl = requestedLocale && data.locales.some((l) => l.locale === requestedLocale) ? requestedLocale : null;

      setActiveLocale(fromUrl ?? data.locales[0]?.locale ?? null);
    }
  }, [baselineKey]);

  const localeData = data?.locales.find((l) => l.locale === activeLocale) ?? data?.locales[0] ?? null;

  const orderedItems = useMemo(() => {
    const items = localeData?.items ?? [];

    const deviceOrder = (label: string) => {
      const idx = DEVICES.findIndex(([, l]) => l === label);
      return idx === -1 ? 99 : idx;
    };

    return [...items].sort((a, b) => deviceOrder(a.deviceLabel) - deviceOrder(b.deviceLabel));
  }, [localeData]);

  useEffect(() => {
    if (orderedItems.length === 0) return;

    if (!orderedItems.some((item) => item.basename === selectedBasename)) {
      setSelectedBasename(orderedItems[0].basename);
    }
  }, [orderedItems, selectedBasename]);

  const selectedIndex = orderedItems.findIndex((item) => item.basename === selectedBasename);
  const selectedItem = selectedIndex >= 0 ? orderedItems[selectedIndex] : null;
  const selectedTitle = selectedItem ? (titles[localeData!.locale]?.[selectedItem.basename] ?? selectedItem.title) : "";

  const effectiveShot: StudioStyle | null = useMemo(() => {
    if (!style) return null;

    return { ...style, ...(selectedBasename ? (shotOverrides[selectedBasename] ?? {}) : {}) };
  }, [style, shotOverrides, selectedBasename]);

  const selectedOverlay = useMemo(
    () => effectiveShot?.overlays.find((overlay) => overlay.id === selectedOverlayId) ?? null,
    [effectiveShot, selectedOverlayId],
  );

  const frameLabel = useMemo(() => {
    const file = effectiveShot?.deviceFrame || bezels?.current || "";
    const options = bezels?.options ?? [];

    if (!file || options.length === 0) return null;

    return options.find((option) => option.file === file)?.color ?? null;
  }, [effectiveShot, bezels]);

  const allBasenames = useMemo(() => {
    const bases = new Set<string>();

    for (const locale of data?.locales ?? []) {
      for (const item of locale.items) bases.add(item.basename);
    }

    return [...bases];
  }, [data]);

  const dirty = useMemo(() => {
    if (!data || !style) return false;

    if (JSON.stringify(style) !== JSON.stringify(data.style)) return true;
    if (JSON.stringify(shotOverrides) !== JSON.stringify(data.styles ?? {})) return true;

    for (const locale of data.locales) {
      for (const item of locale.items) {
        if ((titles[locale.locale]?.[item.basename] ?? item.title) !== item.title) return true;
      }
    }

    return false;
  }, [data, style, titles, shotOverrides]);

  const pushHistory = () => {
    if (!style) return;

    const now = Date.now();

    if (now - lastPushRef.current < 800) return;

    lastPushRef.current = now;
    pastRef.current.push({ style, shotOverrides, titles });

    if (pastRef.current.length > 80) pastRef.current.shift();

    futureRef.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  const handleUndo = () => {
    const prev = pastRef.current.pop();

    if (!prev || !style) return;

    futureRef.current.push({ style, shotOverrides, titles });
    setStyle(prev.style);
    setShotOverrides(prev.shotOverrides);
    setTitles(prev.titles);
    setHistoryTick((tick) => tick + 1);
  };

  const handleRedo = () => {
    const next = futureRef.current.pop();

    if (!next || !style) return;

    pastRef.current.push({ style, shotOverrides, titles });
    setStyle(next.style);
    setShotOverrides(next.shotOverrides);
    setTitles(next.titles);
    setHistoryTick((tick) => tick + 1);
  };

  useEffect(() => {
    if (!jobId || !selectedBasename) {
      setBezels(null);

      return;
    }

    let live = true;

    apiGet<StudioBezels>(`/github/screenshots/studio/${jobId}/bezels/${selectedBasename}`).then(
      (result) => {
        if (live) setBezels(result);
      },
      () => {
        if (live) setBezels({ current: null, options: [], device: null });
      },
    );

    return () => {
      live = false;
    };
  }, [jobId, selectedBasename]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const key = e.key.toLowerCase();
      const redo = key === "y" || (key === "z" && e.shiftKey);

      if (key !== "z" && key !== "y") return;

      const target = e.target as HTMLElement | null;

      if (target && target.closest("input, textarea, select, [contenteditable]")) return;

      e.preventDefault();

      if (redo) handleRedo();
      else handleUndo();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!jobId || !data || !style || saving || !dirty) return;

    const timer = setTimeout(() => {
      studioApi
        .saveDraft(jobId, { style, styles: shotOverrides, titles })
        .then(
          () => {
            draftSavedRef.current = true;
          },
          () => {},
        );
    }, 1500);

    return () => clearTimeout(timer);
  }, [jobId, data, style, shotOverrides, titles, saving, dirty]);

  useEffect(() => {
    if (!jobId || dirty || saving || !draftSavedRef.current) return;

    studioApi
      .deleteDraft(jobId)
      .then(
        () => {
          draftSavedRef.current = false;
        },
        () => {},
      );
  }, [jobId, dirty, saving]);

  const showPrev = () => {
    if (orderedItems.length < 2) return;

    const prev = (selectedIndex - 1 + orderedItems.length) % orderedItems.length;
    setSelectedBasename(orderedItems[prev].basename);
  };

  const showNext = () => {
    if (orderedItems.length < 2) return;

    const next = (selectedIndex + 1) % orderedItems.length;
    setSelectedBasename(orderedItems[next].basename);
  };

  const handleTitleChange = (title: string) => {
    if (!localeData || !selectedBasename) return;

    pushHistory();

    const localeTitles = titles[localeData.locale] ?? {};

    setTitles({ ...titles, [localeData.locale]: { ...localeTitles, [selectedBasename]: title } });
  };

  const handleGeometryChange = (patch: Partial<StudioStyle>) => {
    if (!style || !selectedBasename) return;

    pushHistory();

    const geoPatch: Partial<StudioStyle> = {};
    const sink = geoPatch as Record<string, unknown>;

    for (const key of STUDIO_APPLY_GEOMETRY_KEYS) {
      if (patch[key] !== undefined) sink[key] = patch[key];
    }

    const merged = { ...(shotOverrides[selectedBasename] ?? {}), ...geoPatch };
    const effective = { ...DEFAULT_STUDIO_GEOMETRY, ...merged };
    const next = { ...shotOverrides };

    if (JSON.stringify(effective) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
      delete next[selectedBasename];
    } else {
      next[selectedBasename] = merged;
    }

    setShotOverrides(next);
  };

  const handleDesignChange = (patch: Partial<StudioStyle>) => {
    if (!style) return;

    pushHistory();

    const designPatch: Partial<StudioStyle> = {};
    const sink = designPatch as Record<string, unknown>;
    const geo = new Set<string>(STUDIO_GEOMETRY_KEYS);

    for (const key of Object.keys(patch) as Array<keyof StudioStyle>) {
      if (!geo.has(key) && patch[key] !== undefined) sink[key] = patch[key];
    }

    setStyle({ ...style, ...designPatch });
  };

  const handleApplyToAll = () => {
    if (!style || !selectedBasename || !effectiveShot) return;

    pushHistory();

    const source: Partial<StudioStyle> = {};
    const sink = source as Record<string, unknown>;

    for (const key of STUDIO_APPLY_GEOMETRY_KEYS) sink[key] = effectiveShot[key];

    if (JSON.stringify({ ...DEFAULT_STUDIO_GEOMETRY, ...source }) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
      setShotOverrides({});
      addToast("Cleared custom positions for all screenshots", "success");

      return;
    }

    const next: Record<string, Partial<StudioStyle>> = {};

    for (const base of allBasenames) next[base] = { ...source };

    setShotOverrides(next);
    addToast(`Applied to all ${allBasenames.length} screenshots`, "success");
  };

  const handleSelectLayer = (layer: StudioLayer | null) => {
    setSelectedLayer(layer);

    if (layer) setSelectedOverlayId(null);
  };

  const handleSelectOverlay = (id: string | null) => {
    setSelectedOverlayId(id);

    if (id) setSelectedLayer(null);
  };

  const handleSelectScreenshot = (basename: string) => {
    setSelectedBasename(basename);
    setSelectedOverlayId(null);
  };

  const replaceShotOverlays = (basename: string, list: StudioOverlay[]) => {
    const next = { ...shotOverrides };
    const merged = { ...(next[basename] ?? {}) };

    if (list.length > 0) merged.overlays = list;
    else delete merged.overlays;

    if (Object.keys(merged).length === 0) delete next[basename];
    else next[basename] = merged;

    setShotOverrides(next);
  };

  const handleShotPatch = (patch: Partial<StudioStyle>) => {
    if (!selectedBasename) return;

    pushHistory();

    const next = { ...shotOverrides };
    const merged = { ...(next[selectedBasename] ?? {}), ...patch };

    if (!merged.deviceFrame) delete merged.deviceFrame;

    if (Object.keys(merged).length === 0) delete next[selectedBasename];
    else next[selectedBasename] = merged;

    setShotOverrides(next);
  };

  const handleOverlayPatch = (id: string, patch: Partial<StudioOverlay>) => {
    if (!selectedBasename || !effectiveShot) return;

    pushHistory();
    replaceShotOverlays(
      selectedBasename,
      effectiveShot.overlays.map((overlay) => (overlay.id === id ? { ...overlay, ...patch } : overlay)),
    );
  };

  const handleOverlayDelete = (id: string) => {
    if (!selectedBasename || !effectiveShot) return;

    pushHistory();
    replaceShotOverlays(
      selectedBasename,
      effectiveShot.overlays.filter((overlay) => overlay.id !== id),
    );

    if (selectedOverlayId === id) setSelectedOverlayId(null);

    if (jobId) {
      studioApi.deleteOverlay(jobId, id).catch(() => {});
    }
  };

  const handleOverlaysAdd = (list: StudioOverlay[]) => {
    if (!selectedBasename || !effectiveShot || list.length === 0) return;

    pushHistory();

    const known = new Set(effectiveShot.overlays.map((overlay) => overlay.id));

    replaceShotOverlays(selectedBasename, [
      ...effectiveShot.overlays,
      ...list.filter((overlay) => !known.has(overlay.id)),
    ]);

    const last = list[list.length - 1];

    if (last) {
      setSelectedOverlayId(last.id);
      setSelectedLayer(null);
    }
  };

  const uploadOverlayFile = useCallback(
    async (file: File) => {
      if (!jobId) return null;

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });
        const { overlay } = await studioApi.uploadOverlay(jobId, dataUrl);

        return overlay;
      } catch (err: any) {
        addToast(`Overlay upload failed: ${err.message}`, "error");

        return null;
      }
    },
    [jobId, addToast],
  );

  const duplicateOverlayFile = useCallback(
    async (overlayId: string) => {
      if (!jobId) return null;

      try {
        const { overlay } = await studioApi.duplicateOverlay(jobId, overlayId);

        return overlay;
      } catch (err: any) {
        addToast(`Overlay duplicate failed: ${err.message}`, "error");

        return null;
      }
    },
    [jobId, addToast],
  );

  const handleSave = async () => {
    if (!jobId || !data || !style || saving) return;

    setSaving(true);
    setProgress(null);

    try {
      const targetLocales =
        scope === "all" ? data.locales : data.locales.filter((l) => l.locale === localeData?.locale);

      const commonStyles: Record<string, Partial<StudioStyle>> = {};

      for (const [base, patch] of Object.entries(shotOverrides)) {
        const rest = { ...patch };
        delete rest.titleLines;

        if (JSON.stringify({ ...DEFAULT_STUDIO_GEOMETRY, ...rest }) !== JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
          commonStyles[base] = rest;
        }
      }

      await ensureStudioFont(style.font);

      const payload: Record<string, StudioSaveLocale> = {};

      for (const l of targetLocales) {
        const titlesForLocale = titles[l.locale] ?? {};

        payload[l.locale] = { titles: titlesForLocale, styles: commonStyles, titleLines: {} };
      }

      const result = await studioApi.saveRevisionStream(
        jobId,
        {
          name: revName.trim() || undefined,
          style,
          locales: payload,
        },
        setProgress,
      );

      const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : "";
      addToast(`Saved ${revisionLabel(result.revision)} (${result.modes.worker} rendered${skipped})`, "success");
      refetch();
    } catch (err: any) {
      addToast(`Save failed: ${err.message}`, "error");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const handleActivate = async (revisionId: string) => {
    if (!jobId) return;

    setActivatingId(revisionId);

    try {
      await studioApi.activateRevision(jobId, revisionId);
      addToast("Revision activated", "success");
      refetch();
    } catch (err: any) {
      addToast(`Activate failed: ${err.message}`, "error");
    } finally {
      setActivatingId(null);
    }
  };

  const handleSetDefault = async (revisionId: string) => {
    if (!data) return;

    setSettingDefaultId(revisionId);

    try {
      await studioApi.setDefaultRevision(revisionId, data.job.appId);
      addToast("Set as default for future renders", "success");
      refetch();
    } catch (err: any) {
      addToast(`Set default failed: ${err.message}`, "error");
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDeleteRevision = async (rev: { id: string; rev: number; name: string | null }) => {
    if (!confirm(`Delete ${revisionLabel(rev)}?`)) return;

    setDeletingId(rev.id);

    try {
      await studioApi.deleteRevision(rev.id);
      addToast("Revision deleted", "success");
      refetch();
    } catch (err: any) {
      addToast(`Delete failed: ${err.message}`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRenameSet = async () => {
    if (!jobId || savingSetName) return;

    setSavingSetName(true);

    try {
      await studioApi.renameJob(jobId, setName);
      addToast("Set renamed", "success");
      setRenamingSet(false);
      refetch();
    } catch (err: any) {
      addToast(`Rename failed: ${err.message}`, "error");
    } finally {
      setSavingSetName(false);
    }
  };

  const handleApplyPreset = (preset: StudioPresetInfo) => {
    if (!style) return;

    pushHistory();

    setStyle({
      ...style,
      bgColor1: preset.bgColor1,
      bgColor2: preset.bgColor2,
      textColor: preset.textColor,
      font: preset.font,
      textPosition: preset.textPosition,
    });

    if (selectedBasename) {
      const geo: Partial<StudioStyle> = {};
      const sink = geo as Record<string, unknown>;

      for (const key of STUDIO_APPLY_GEOMETRY_KEYS) sink[key] = preset[key];

      const effective = { ...DEFAULT_STUDIO_GEOMETRY, ...geo };
      const next = { ...shotOverrides };

      if (JSON.stringify(effective) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
        delete next[selectedBasename];
      } else {
        next[selectedBasename] = geo;
      }

      setShotOverrides(next);
    }

    addToast(`Applied preset ${preset.name}`, "success");
  };

  const handleSavePreset = async (name: string) => {
    if (!data || !style || !effectiveShot) return;

    setSavingPreset(true);

    try {
      const { titleLines: _titles, overlays: _overlays, deviceFrame: _frame, ...presetStyle } = effectiveShot;

      await studioApi.createPreset(data.job.appId, {
        name,
        style: { ...presetStyle, titleLines: [], deviceFrame: "", overlays: [] },
      });
      addToast(`Preset ${name} saved`, "success");
      refetch();
    } catch (err: any) {
      addToast(`Save failed: ${err.message}`, "error");
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (preset: StudioPresetInfo) => {
    if (!confirm(`Delete preset ${preset.name}?`)) return;

    try {
      await studioApi.deletePreset(preset.id);
      addToast(`Preset ${preset.name} deleted`, "success");
      refetch();
    } catch (err: any) {
      addToast(`Delete failed: ${err.message}`, "error");
    }
  };

  if (!jobId) {
    return (
      <div>
        <h1 className={`${pageTitle} mb-5`}>Screenshot Studio</h1>
        <div className={`${cardCls} text-sm ${textMuted}`}>Missing screenshot run.</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div>
        <h1 className={`${pageTitle} mb-5`}>Screenshot Studio</h1>
        <div className={`${cardCls} flex items-center gap-2 text-sm ${textMuted} py-8 justify-center`}>
          <div className="spinner !w-4 !h-4" /> Loading studio…
        </div>
      </div>
    );
  }

  if (!data || !localeData || !style || !effectiveShot) {
    return (
      <div>
        <h1 className={`${pageTitle} mb-5`}>Screenshot Studio</h1>
        <div className={`${cardCls} text-sm ${textMuted}`}>
          Screenshot run not found.{" "}
          <Link to="/screenshots" className="underline underline-offset-2 hover:text-[#595DD2]">
            Back to screenshots
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <Link
            to="/screenshots"
            className={`inline-flex items-center gap-1 text-[12px] ${textSecondary} hover:text-[#595DD2] mb-1`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Screenshots
          </Link>
          <h1 className={pageTitle}>Screenshot Studio</h1>
          <div className="flex items-center gap-1.5 mt-1">
            {renamingSet ? (
              <>
                <input
                  type="text"
                  value={setName}
                  maxLength={80}
                  autoFocus
                  placeholder={data.job.commitSha.slice(0, 7)}
                  onChange={(e) => setSetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSet();
                    if (e.key === "Escape") setRenamingSet(false);
                  }}
                  className={`${inputCls} !w-64 !py-[5px] !text-[13px]`}
                />
                <button
                  type="button"
                  onClick={handleRenameSet}
                  disabled={savingSetName}
                  title="Save name"
                  className={`w-7 h-7 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50`}
                >
                  {savingSetName ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingSet(false)}
                  disabled={savingSetName}
                  title="Cancel"
                  className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50`}
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <p className={`text-[13px] ${textSecondary}`}>
                  {data.job.commitMessage || data.job.commitSha.slice(0, 7)}
                  <span className="font-mono text-[11px]">
                    {" "}
                    · {data.job.commitSha.slice(0, 7)}
                    {data.job.branch ? ` · ${data.job.branch}` : ""}
                  </span>
                </p>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => {
                      setSetName(data.job.commitMessage ?? "");
                      setRenamingSet(true);
                    }}
                    title="Rename set"
                    className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-[#595DD2] hover:bg-[#595DD2]/10 transition-colors`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[264px_minmax(0,1fr)_300px] gap-5 items-start">
        <StudioLayers
          item={selectedItem}
          title={selectedTitle}
          style={effectiveShot}
          selectedLayer={selectedLayer}
          onSelectLayer={handleSelectLayer}
          items={orderedItems}
          titles={titles[localeData.locale] ?? {}}
          selectedBasename={selectedBasename}
          onSelectScreenshot={handleSelectScreenshot}
          shotOverrides={shotOverrides}
          overlays={effectiveShot.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={handleSelectOverlay}
          onDeleteOverlay={handleOverlayDelete}
          frameLabel={frameLabel}
        />
        <StudioCanvas
          item={selectedItem}
          title={selectedTitle}
          style={effectiveShot}
          layer={selectedLayer}
          disabled={!canWrite}
          onGeometryChange={handleGeometryChange}
          onApplyToAll={handleApplyToAll}
          onSelectLayer={handleSelectLayer}
          index={Math.max(0, selectedIndex)}
          total={orderedItems.length}
          onPrev={showPrev}
          onNext={showNext}
          locales={data.locales.map((l) => l.locale)}
          activeLocale={localeData.locale}
          onLocaleChange={setActiveLocale}
          overlays={effectiveShot.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={handleSelectOverlay}
          onOverlayPatch={handleOverlayPatch}
          onOverlaysAdd={handleOverlaysAdd}
          uploadOverlayFile={uploadOverlayFile}
          duplicateOverlayFile={duplicateOverlayFile}
          canUndo={pastRef.current.length > 0}
          canRedo={futureRef.current.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          bezels={bezels}
        />
        <div className="flex flex-col gap-5 min-w-0">
          <StudioRevisions
            disabled={!canWrite}
            revisions={data.revisions}
            activeRevisionId={data.activeRevisionId}
            activatingId={activatingId}
            onActivate={handleActivate}
            deletingId={deletingId}
            onDelete={handleDeleteRevision}
            defaultRevisionId={data.defaultRevisionId}
            settingDefaultId={settingDefaultId}
            onSetDefault={handleSetDefault}
            dirty={dirty}
            scope={scope}
            onScopeChange={setScope}
            activeLocaleName={getLocaleName(localeData.locale)}
            localeCount={data.locales.length}
            revName={revName}
            onRevNameChange={setRevName}
            onSave={handleSave}
            saving={saving}
            progress={progress}
          />
          <StudioInspector
            disabled={!canWrite}
            layer={selectedLayer}
            item={selectedItem}
            title={selectedTitle}
            onTitleChange={handleTitleChange}
            style={effectiveShot}
            onGeometryChange={handleGeometryChange}
            onDesignChange={handleDesignChange}
            presets={data.presets}
            onApplyPreset={handleApplyPreset}
            onSavePreset={handleSavePreset}
            onDeletePreset={handleDeletePreset}
            savingPreset={savingPreset}
            bezels={bezels}
            onShotPatch={handleShotPatch}
            overlay={selectedOverlay}
            onOverlayPatch={handleOverlayPatch}
            onDeleteOverlay={handleOverlayDelete}
          />
        </div>
      </div>
    </div>
  );
}
