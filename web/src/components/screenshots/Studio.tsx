import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { apiGet, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { borderDefault, cardCls, inputCls, textMuted, textPrimary } from "../../styles";
import { getLocaleName } from "../../utils/localeUtils";
import { DEVICES } from "../../utils/screenshotUtils";
import { applyStudioGeometry } from "./studioApply";
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
  type LocaleStylesMap,
  type StudioApplyMode,
  type StudioBezels,
  type StudioData,
  type StudioLayer,
  type StudioOverlay,
  type StudioPresetInfo,
  type StudioProgressEvent,
  type StudioRenderState,
  type StudioSaveLocale,
  type StudioStyle,
} from "./studioApi";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

type TitleDrafts = Record<string, Record<string, string>>;

interface StudioSnapshot {
  style: StudioStyle;
  shotOverrides: LocaleStylesMap;
  titles: TitleDrafts;
}

const STUDIO_SIMPLE_CLS = "h-screen overflow-y-auto bg-white dark:bg-[#0f1117] px-4 py-4 sm:px-7 sm:py-6";
const STUDIO_SHELL_CLS = "h-screen flex flex-col overflow-y-auto lg:overflow-hidden bg-white dark:bg-[#0f1117]";

function CloseButton() {
  return (
    <Link
      to="/screenshots"
      title="Close Studio"
      className={`w-8 h-8 flex items-center justify-center rounded-lg ${textMuted} hover:text-[#595DD2] hover:bg-[#595DD2]/10 transition-colors shrink-0`}
    >
      <X className="w-4 h-4" />
    </Link>
  );
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
  const [shotOverrides, setShotOverrides] = useState<LocaleStylesMap>({});
  const [titles, setTitles] = useState<TitleDrafts>({});
  const [revName, setRevName] = useState("");
  const [localSaving, setSaving] = useState(false);
  const [renderState, setRenderState] = useState<StudioRenderState | null>(null);
  const saving = localSaving || renderState?.status === "RUNNING";
  const localSavingRef = useRef(localSaving);
  localSavingRef.current = localSaving;
  const observedRenderRef = useRef<string | null>(null);
  const [progress, setProgress] = useState<StudioProgressEvent | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [deletingLocales, setDeletingLocales] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [renamingSet, setRenamingSet] = useState(false);
  const [setName, setSetName] = useState("");
  const [savingSetName, setSavingSetName] = useState(false);
  const loadedBaselineRef = useRef<string | null>(null);
  const draftVersionRef = useRef<string | null>(null);
  const draftPendingRef = useRef(false);
  const draftRequestRef = useRef(false);
  const localSnapshotRef = useRef("");
  const [draftConflict, setDraftConflict] = useState(false);
  const [draftReloadTick, setDraftReloadTick] = useState(0);
  const [draftOrder, setDraftOrder] = useState<Record<string, string[]>>({});
  const draftSavedRef = useRef(false);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [bezels, setBezels] = useState<StudioBezels | null>(null);
  const pastRef = useRef<StudioSnapshot[]>([]);
  const futureRef = useRef<StudioSnapshot[]>([]);
  const lastPushRef = useRef(0);
  const [, setHistoryTick] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let pending = false;
    observedRenderRef.current = null;
    setRenderState(null);
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const { render } = await studioApi.getRenderStatus(jobId);
        if (!live) return;
        setRenderState(render);
        if (render?.status === "RUNNING") {
          observedRenderRef.current = render.operationId;
        } else if (render && observedRenderRef.current === render.operationId) {
          observedRenderRef.current = null;
          refetch();
          if (!localSavingRef.current) {
            if (render.status === "FAILED") addToast(`Save failed: ${render.error ?? "Render failed"}`, "error");
            else if (render.result) addToast(`Saved ${revisionLabel(render.result.revision)} (${render.result.modes.worker} rendered)`, "success");
          }
        }
      } catch { /* Keep the last known progress while the connection recovers. */ }
      finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    const focus = () => { void poll(); };
    window.addEventListener("focus", focus);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [jobId, refetch, addToast]);

  const baselineKey = data
    ? `${data.job.id}:${data.activeRevisionId ?? "orig"}:${data.revisions.length}:${data.presets.length}`
    : null;

  const baselineStyles = useMemo<LocaleStylesMap>(
    () => Object.fromEntries((data?.locales ?? []).map((l) => [l.locale, l.styles ?? {}])),
    [data],
  );

  useEffect(() => {
    if (!data) return;

    const remoteVersion = data.draft?.updatedAt ?? null;
    const baselineChanged = loadedBaselineRef.current !== baselineKey;
    if (!baselineChanged && remoteVersion === draftVersionRef.current) return;
    if (loadedBaselineRef.current?.startsWith(`${data.job.id}:`) && (draftPendingRef.current || draftRequestRef.current)) return;
    loadedBaselineRef.current = baselineKey;
    draftPendingRef.current = false;
    setDraftConflict(false);
    draftVersionRef.current = remoteVersion;
    setDraftOrder(data.draft?.order ?? {});
    setStyle(data.style);
    setShotOverrides(baselineStyles);

    const draftTitles: TitleDrafts = {};

    for (const locale of data.locales) {
      draftTitles[locale.locale] = Object.fromEntries(locale.items.map((item) => [item.basename, item.title]));
    }

    if (data.draft) {
      draftSavedRef.current = true;
      setStyle(data.draft.style);
      const draftStyles = data.draft.styles;
      setShotOverrides(Object.fromEntries(data.locales.map((l) => [
        l.locale, draftStyles[l.locale] ?? draftStyles["*"] ?? baselineStyles[l.locale],
      ])));

      const merged: TitleDrafts = { ...draftTitles };

      for (const [locale, localeTitles] of Object.entries(data.draft.titles)) {
        merged[locale] = { ...(draftTitles[locale] ?? {}), ...localeTitles };
      }

      setTitles(merged);
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
  }, [baselineKey, data?.draft?.updatedAt, draftReloadTick]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !draftRequestRef.current && !saving) refetch(); };
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refetch, saving]);

  const localeData = data?.locales.find((l) => l.locale === activeLocale) ?? data?.locales[0] ?? null;

  const localeOverrides = shotOverrides[localeData?.locale ?? ""] ?? {};
  const setLocaleOverrides = (next: Record<string, Partial<StudioStyle>>) => {
    if (!localeData) return;
    setShotOverrides({ ...shotOverrides, [localeData.locale]: next });
  };

  const orderedItems = useMemo(() => {
    const items = localeData?.items ?? [];

    const deviceOrder = (label: string) => {
      const idx = DEVICES.findIndex(([, l]) => l === label);
      return idx === -1 ? 99 : idx;
    };

    const order = new Map((draftOrder[localeData?.locale ?? ""] ?? []).map((base, index) => [base, index]));
    return [...items].sort((a, b) => deviceOrder(a.deviceLabel) - deviceOrder(b.deviceLabel) ||
      (order.get(a.basename) ?? items.indexOf(a)) - (order.get(b.basename) ?? items.indexOf(b)));
  }, [localeData, draftOrder]);

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

    return { ...style, ...(selectedBasename ? (localeOverrides[selectedBasename] ?? {}) : {}) };
  }, [style, localeOverrides, selectedBasename]);

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

  const dirty = useMemo(() => {
    if (!data || !style) return false;

    for (const locale of data.locales) {
      if (draftOrder[locale.locale] && JSON.stringify(draftOrder[locale.locale]) !== JSON.stringify(locale.items.map((item) => item.basename))) return true;
      for (const item of locale.items) {
        if ((titles[locale.locale]?.[item.basename] ?? item.title) !== item.title) return true;
        const before = { ...data.style, ...baselineStyles[locale.locale]?.[item.basename] };
        const after = { ...style, ...shotOverrides[locale.locale]?.[item.basename] };
        if (JSON.stringify(before) !== JSON.stringify(after)) return true;
      }
    }

    return false;
  }, [data, style, titles, shotOverrides, baselineStyles, draftOrder]);

  const pushHistory = (force = false) => {
    if (!style) return;
    draftPendingRef.current = true;

    const now = Date.now();

    if (!force && now - lastPushRef.current < 800) return;

    lastPushRef.current = now;
    pastRef.current.push({ style, shotOverrides, titles });

    if (pastRef.current.length > 80) pastRef.current.shift();

    futureRef.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  const handleUndo = () => {
    const prev = pastRef.current.pop();

    if (!prev || !style) return;

    draftPendingRef.current = true;
    futureRef.current.push({ style, shotOverrides, titles });
    setStyle(prev.style);
    setShotOverrides(prev.shotOverrides);
    setTitles(prev.titles);
    setHistoryTick((tick) => tick + 1);
  };

  const handleRedo = () => {
    const next = futureRef.current.pop();

    if (!next || !style) return;

    draftPendingRef.current = true;
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

  const draftBody = { style, styles: shotOverrides, titles, order: draftOrder };
  localSnapshotRef.current = JSON.stringify(draftBody);

  useEffect(() => {
    if (!jobId || !data || !style || saving || !dirty || draftConflict || !draftPendingRef.current) return;
    const snapshot = JSON.stringify({ style, styles: shotOverrides, titles, order: draftOrder });
    const timer = setTimeout(async () => {
      if (draftRequestRef.current) return;
      draftRequestRef.current = true;
      try {
        const { draft } = await studioApi.saveDraft(jobId, {
          style, styles: shotOverrides, titles, order: draftOrder, expectedUpdatedAt: draftVersionRef.current,
        });
        draftVersionRef.current = draft.updatedAt;
        draftSavedRef.current = true;
        if (snapshot === localSnapshotRef.current) draftPendingRef.current = false;
      } catch (err) {
        if ((err as Error).message.includes("Draft changed")) setDraftConflict(true);
        addToast(`Draft save failed: ${(err as Error).message}`, "error");
      } finally { draftRequestRef.current = false; }
    }, 400);
    return () => clearTimeout(timer);
  }, [jobId, data, style, shotOverrides, titles, draftOrder, saving, dirty, draftConflict, addToast]);

  useEffect(() => {
    if (!jobId || !dirty || !draftPendingRef.current || draftConflict) return;
    const flush = () => {
      fetch(`/api/github/screenshots/studio/${jobId}/draft`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style, styles: shotOverrides, titles, order: draftOrder, expectedUpdatedAt: draftVersionRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [jobId, dirty, style, shotOverrides, titles, draftOrder, draftConflict]);

  useEffect(() => {
    if (!jobId || dirty || saving || draftConflict || !draftSavedRef.current || !draftPendingRef.current) return;
    studioApi.deleteDraft(jobId, draftVersionRef.current ?? undefined).then(() => {
      draftSavedRef.current = false;
      draftVersionRef.current = null;
      draftPendingRef.current = false;
      refetch();
    }, () => {});
  }, [jobId, dirty, saving, draftConflict, refetch]);

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

    const merged = { ...(localeOverrides[selectedBasename] ?? {}), ...geoPatch };
    const effective = { ...DEFAULT_STUDIO_GEOMETRY, ...merged };
    const next = { ...localeOverrides };

    if (JSON.stringify(effective) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
      delete next[selectedBasename];
    } else {
      next[selectedBasename] = merged;
    }

    setLocaleOverrides(next);
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

  const handleApply = (mode: StudioApplyMode) => {
    if (!data || !localeData || !selectedItem || !effectiveShot) return;

    pushHistory(true);
    const next = applyStudioGeometry(shotOverrides, data.locales, localeData.locale, selectedItem, effectiveShot, mode);
    setShotOverrides(next);
    addToast("Applied positions and sizes to the selected screenshots", "success");
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
    const next = { ...localeOverrides };
    const merged = { ...(next[basename] ?? {}) };

    if (list.length > 0) merged.overlays = list;
    else delete merged.overlays;

    if (Object.keys(merged).length === 0) delete next[basename];
    else next[basename] = merged;

    setLocaleOverrides(next);
  };

  const handleShotPatch = (patch: Partial<StudioStyle>) => {
    if (!selectedBasename) return;

    pushHistory();

    const next = { ...localeOverrides };
    const merged = { ...(next[selectedBasename] ?? {}), ...patch };

    if (!merged.deviceFrame) delete merged.deviceFrame;

    if (Object.keys(merged).length === 0) delete next[selectedBasename];
    else next[selectedBasename] = merged;

    setLocaleOverrides(next);
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
    if (!jobId || !data || !style || saving || draftConflict) return;

    if (draftRequestRef.current) { addToast("Draft is being saved; please try again in a moment.", "info"); return; }
    setSaving(true);
    setProgress(null);
    let savedDraftAt: string | null = null;

    try {
      const { draft } = await studioApi.saveDraft(jobId, {
        style, styles: shotOverrides, titles, order: draftOrder, expectedUpdatedAt: draftVersionRef.current,
      });
      draftVersionRef.current = draft.updatedAt;
      savedDraftAt = draft.updatedAt;
      const savedSnapshot = JSON.stringify({ style, styles: shotOverrides, titles, order: draftOrder });
      if (savedSnapshot === localSnapshotRef.current) draftPendingRef.current = false;
      await ensureStudioFont(style.font);

      const payload: Record<string, StudioSaveLocale> = {};

      for (const l of data.locales) {
        const titlesForLocale = titles[l.locale] ?? {};

        payload[l.locale] = { titles: titlesForLocale, styles: shotOverrides[l.locale] ?? {}, titleLines: {} };
      }

      const result = await studioApi.saveRevisionStream(
        jobId,
        {
          name: revName.trim() || undefined,
          style,
          locales: payload,
          order: draftOrder,
          draftUpdatedAt: draftVersionRef.current ?? undefined,
        },
        setProgress,
      );

      if (draftVersionRef.current === draft.updatedAt) draftVersionRef.current = null;
      draftSavedRef.current = false;
      observedRenderRef.current = null;
      setRenderState(null);
      const skipped = result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : "";
      addToast(`Saved ${revisionLabel(result.revision)} (${result.modes.worker} rendered${skipped})`, "success");
      refetch();
    } catch (err: any) {
      if (err.message.includes("Draft changed")) setDraftConflict(true);
      try {
        const { render } = await studioApi.getRenderStatus(jobId);
        if (render?.status === "RUNNING") {
          setRenderState(render);
          observedRenderRef.current = render.operationId;
          addToast("Rendering continues in the background. Progress will reconnect automatically.", "info");
        } else if (render?.status === "SUCCEEDED" && render.result && savedDraftAt && render.startedAt >= savedDraftAt) {
          observedRenderRef.current = null;
          refetch();
          addToast(`Saved ${revisionLabel(render.result.revision)}`, "success");
        } else addToast(`Save failed: ${err.message}`, "error");
      } catch { addToast(`Save failed: ${err.message}`, "error"); }
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

  const handleDeleteLocales = async (locales: string[]) => {
    if (!jobId || locales.length === 0) return;

    const label = locales.length === 1 ? getLocaleName(locales[0]) : `${locales.length} locales`;

    if (!confirm(`Delete ${label}? This removes their screenshots and can't be undone.`)) return;

    setDeletingLocales(true);

    try {
      await studioApi.deleteLocales(jobId, locales);
      addToast(`Deleted ${label}`, "success");

      if (locales.includes(activeLocale ?? "")) setActiveLocale(null);

      refetch();
    } catch (err: any) {
      addToast(`Delete failed: ${err.message}`, "error");
    } finally {
      setDeletingLocales(false);
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

      setLocaleOverrides({ ...localeOverrides, [selectedBasename]: { ...localeOverrides[selectedBasename], ...geo } });
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
      <div className={STUDIO_SIMPLE_CLS}>
        <div className="mb-5">
          <CloseButton />
        </div>
        <div className={`${cardCls} text-sm ${textMuted}`}>Missing screenshot run.</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className={STUDIO_SIMPLE_CLS}>
        <div className="mb-5">
          <CloseButton />
        </div>
        <div className={`${cardCls} flex items-center gap-2 text-sm ${textMuted} py-8 justify-center`}>
          <div className="spinner !w-4 !h-4" /> Loading studio…
        </div>
      </div>
    );
  }

  if (!data || !localeData || !style || !effectiveShot) {
    return (
      <div className={STUDIO_SIMPLE_CLS}>
        <div className="mb-5">
          <CloseButton />
        </div>
        <div className={`${cardCls} text-sm ${textMuted}`}>Screenshot run not found.</div>
      </div>
    );
  }

  return (
    <div className={STUDIO_SHELL_CLS}>
      <div className={`flex items-center justify-between gap-4 flex-wrap px-4 sm:px-6 py-3 border-b ${borderDefault} shrink-0`}>
        <div className="flex items-center gap-3 min-w-0">
          <CloseButton />

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
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className={`text-[15px] font-semibold ${textPrimary} truncate`}>
                {data.job.commitMessage || data.job.commitSha.slice(0, 7)}
              </h1>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setSetName(data.job.commitMessage ?? "");
                    setRenamingSet(true);
                  }}
                  title="Rename set"
                  className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-[#595DD2] hover:bg-[#595DD2]/10 transition-colors shrink-0`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <span className={`text-[12px] font-mono ${textMuted} shrink-0`}>
                {data.job.commitSha.slice(0, 7)}
                {data.job.branch ? ` · ${data.job.branch}` : ""}
              </span>
            </div>
          )}
        </div>

        <StudioRevisions
          disabled={!canWrite || draftConflict}
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
          revName={revName}
          onRevNameChange={setRevName}
          onSave={handleSave}
          saving={saving}
          progress={progress ?? (renderState?.status === "RUNNING" ? renderState.progress : null)}
        />
      </div>

      {draftConflict && (
        <div role="alert" className="px-6 py-2 text-sm bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          The shared draft changed in another session. Your local changes are still visible; saving is paused.
          <button type="button" className="ml-3 underline font-medium" onClick={() => {
            draftPendingRef.current = false; loadedBaselineRef.current = null; setDraftConflict(false); setDraftReloadTick((tick) => tick + 1); refetch();
          }}>Load shared draft</button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside className={`flex flex-col lg:w-[264px] lg:shrink-0 lg:h-full lg:overflow-hidden px-4 pt-4 pb-3 lg:border-r ${borderDefault}`}>
        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto pb-4">
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
          shotOverrides={localeOverrides}
          overlays={effectiveShot.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={handleSelectOverlay}
          onDeleteOverlay={handleOverlayDelete}
          frameLabel={frameLabel}
        />
        </div>
        <nav aria-label="Screenshot navigation" className={`flex items-center justify-between gap-3 shrink-0 pt-3 border-t ${borderDefault}`}>
          <button
            type="button"
            onClick={showPrev}
            disabled={orderedItems.length < 2}
            aria-label="Previous screenshot"
            title="Previous screenshot"
            className={`w-9 h-9 flex items-center justify-center rounded-xl border ${borderDefault} ${textMuted} hover:text-[#595DD2] hover:bg-[#595DD2]/5 transition-colors disabled:opacity-40`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span aria-live="polite" aria-atomic="true" className={`text-[12px] font-mono ${textMuted}`}>
            {orderedItems.length === 0 ? "0 / 0" : `${Math.max(0, selectedIndex) + 1} / ${orderedItems.length}`}
          </span>
          <button
            type="button"
            onClick={showNext}
            disabled={orderedItems.length < 2}
            aria-label="Next screenshot"
            title="Next screenshot"
            className={`w-9 h-9 flex items-center justify-center rounded-xl border ${borderDefault} ${textMuted} hover:text-[#595DD2] hover:bg-[#595DD2]/5 transition-colors disabled:opacity-40`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </nav>
        </aside>
        <main className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto">
        <StudioCanvas
          item={selectedItem}
          title={selectedTitle}
          style={effectiveShot}
          layer={selectedLayer}
          disabled={!canWrite}
          onGeometryChange={handleGeometryChange}
          onApply={handleApply}
          onSelectLayer={handleSelectLayer}
          locales={data.locales.map((l) => l.locale)}
          activeLocale={localeData.locale}
          onLocaleChange={setActiveLocale}
          deletingLocales={deletingLocales}
          onDeleteLocales={handleDeleteLocales}
          overlays={effectiveShot.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={handleSelectOverlay}
          onOverlayPatch={handleOverlayPatch}
          onOverlaysAdd={handleOverlaysAdd}
          onDeleteOverlay={handleOverlayDelete}
          onTitleChange={handleTitleChange}
          uploadOverlayFile={uploadOverlayFile}
          duplicateOverlayFile={duplicateOverlayFile}
          canUndo={pastRef.current.length > 0}
          canRedo={futureRef.current.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          bezels={bezels}
        />
        </main>
        <aside className={`lg:w-[300px] lg:shrink-0 lg:h-full lg:overflow-y-auto px-4 py-4 lg:border-l ${borderDefault}`}>
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
        </aside>
      </div>
    </div>
  );
}
