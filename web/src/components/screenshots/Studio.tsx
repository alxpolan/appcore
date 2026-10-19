import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import { cardCls, pageTitle, textMuted, textSecondary } from "../../styles";
import { getLocaleName } from "../../utils/localeUtils";
import { DEVICES } from "../../utils/screenshotUtils";
import StudioLayers from "./StudioLayers";
import StudioCanvas from "./StudioCanvas";
import StudioInspector from "./StudioInspector";
import StudioRevisions from "./StudioRevisions";
import { computeTitleLines, ensureStudioFont } from "./studioPreview";
import {
  DEFAULT_STUDIO_GEOMETRY,
  STUDIO_APPLY_GEOMETRY_KEYS,
  STUDIO_GEOMETRY_KEYS,
  revisionLabel,
  studioApi,
  type StudioData,
  type StudioLayer,
  type StudioPresetInfo,
  type StudioProgressEvent,
  type StudioSaveLocale,
  type StudioStyle,
} from "./studioApi";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

type TitleDrafts = Record<string, Record<string, string>>;

export default function Studio({ addToast }: Props) {
  const { jobId } = useParams<{ jobId: string }>();
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
  const [savingPreset, setSavingPreset] = useState(false);

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

    setTitles(draftTitles);
    setRevName("");

    if (!activeLocale || !data.locales.some((l) => l.locale === activeLocale)) {
      setActiveLocale(data.locales[0]?.locale ?? null);
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

    const localeTitles = titles[localeData.locale] ?? {};

    setTitles({ ...titles, [localeData.locale]: { ...localeTitles, [selectedBasename]: title } });
  };

  const handleGeometryChange = (patch: Partial<StudioStyle>) => {
    if (!style || !selectedBasename) return;

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
        const linesForLocale: Record<string, string[]> = {};

        for (const item of l.items) {
          const shot = { ...style, ...(shotOverrides[item.basename] ?? {}) };
          const caption = titlesForLocale[item.basename] ?? item.title;

          if (shot.titleBoxW > 0 && caption.trim().length > 0) {
            const lines = computeTitleLines(caption, style.font, shot.titleScale, shot.titleBoxW);

            if (lines.length > 0) linesForLocale[item.basename] = lines;
          }
        }

        payload[l.locale] = { titles: titlesForLocale, styles: commonStyles, titleLines: linesForLocale };
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

  const handleApplyPreset = (preset: StudioPresetInfo) => {
    if (!style) return;

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
      await studioApi.createPreset(data.job.appId, { name, style: { ...effectiveShot, titleLines: [] } });
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
          <p className={`text-[13px] ${textSecondary} mt-1`}>
            {data.job.commitMessage || data.job.commitSha.slice(0, 7)}
            <span className="font-mono text-[11px]">
              {" "}
              · {data.job.commitSha.slice(0, 7)}
              {data.job.branch ? ` · ${data.job.branch}` : ""}
            </span>
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[264px_minmax(0,1fr)_300px] gap-5 items-start">
        <StudioLayers
          item={selectedItem}
          title={selectedTitle}
          style={effectiveShot}
          selectedLayer={selectedLayer}
          onSelectLayer={setSelectedLayer}
          items={orderedItems}
          titles={titles[localeData.locale] ?? {}}
          selectedBasename={selectedBasename}
          onSelectScreenshot={setSelectedBasename}
          shotOverrides={shotOverrides}
        />
        <StudioCanvas
          item={selectedItem}
          title={selectedTitle}
          style={effectiveShot}
          layer={selectedLayer}
          disabled={!canWrite}
          onGeometryChange={handleGeometryChange}
          onApplyToAll={handleApplyToAll}
          onSelectLayer={setSelectedLayer}
          index={Math.max(0, selectedIndex)}
          total={orderedItems.length}
          onPrev={showPrev}
          onNext={showNext}
          locales={data.locales.map((l) => l.locale)}
          activeLocale={localeData.locale}
          onLocaleChange={setActiveLocale}
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
          />
        </div>
      </div>
    </div>
  );
}
