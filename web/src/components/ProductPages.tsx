import { useState, useEffect, useCallback, useRef } from "react";
import { useApi, apiGet, apiPost, apiPatch, apiDelete, getActiveBundleId } from "../hooks/useApi";
import { usePermissions } from "../hooks/usePermissions";
import {
  badgeOutline,
  borderDefault,
  btnPrimary,
  btnPrimSm,
  btnSecSm,
  btnSecondary,
  cardCls,
  inputCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../styles";
import type {
  AppItem,
  ProductPage,
  ProductPageLocalization,
  ProductPageVersion,
} from "../types";
import { getLocaleFlag, getLocaleName } from "../utils/localeUtils";
import { useClickOutside } from "../hooks/useClickOutside";
import { ConnectedScreenshotsPanel } from "./screenshots/ConnectedScreenshotsPanel";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";

type ToastFn = (msg: string, type: "success" | "error" | "info") => void;


function stateLabel(state: string | null): string {
  if (!state) return "No version";
  return state
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function LocaleFlag({ locale, className }: { locale: string; className?: string }) {
  return (
    <img
      src={`/country-flags/${getLocaleFlag(locale)}.svg`}
      alt={locale}
      className={className ?? "w-5 h-4 rounded-xs"}
      loading="lazy"
    />
  );
}

function currentVersion(page: ProductPage): ProductPageVersion | null {
  return page.versions.find((v) => v.isEditable) ?? page.versions[0] ?? null;
}

async function copyText(text: string, addToast: ToastFn) {
  try {
    await navigator.clipboard.writeText(text);
    addToast("Copied to clipboard", "success");
  } catch {
    addToast("Copy failed", "error");
  }
}

export default function ProductPages({ addToast }: { addToast: ToastFn }) {
  const { data, loading, error, refetch } = useApi<{ pages: ProductPage[] }>("/product-pages");
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { canWrite } = usePermissions();

  const activeApp = apps?.find((a) => a.bundleId === getActiveBundleId() && a.isOwnApp);

  const pages = data?.pages ?? [];
  const selected = pages.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !pages.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [pages, selectedId]);

  if (loading && pages.length === 0) {
    return (
      <div className="flex items-center gap-2 py-16 justify-center">
        <div className="spinner" />
        <span className={`text-[13px] ${textSecondary}`}>Loading product pages…</span>
      </div>
    );
  }

  if (error && pages.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className={`text-sm font-medium ${textPrimary}`}>Could not load product pages</div>
        <div className={`text-[13px] mt-1 ${textSecondary}`}>{error}</div>
        <button onClick={() => refetch()} className={`${btnSecondary} mt-4`}>
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  if (selected) {
    return (
      <PageDetail
        page={selected}
        appId={activeApp?.id ?? null}
        addToast={addToast}
        canWrite={canWrite}
        onBack={() => setSelectedId(null)}
        onChanged={refetch}
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className={pageTitle}>Product Pages</h1>
          <p className={`text-[13px] mt-1 ${textSecondary}`}>
            Custom product pages for this app, synced live with App Store Connect. Each page can have
            its own screenshots, promotional text and URL.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => refetch()} className={btnSecondary} title="Reload from App Store Connect">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {canWrite && (
            <button onClick={() => setShowCreate(true)} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              New Page
            </button>
          )}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className={`${cardCls} py-14 text-center`}>
          <ImageIcon className={`w-8 h-8 mx-auto ${textMuted}`} />
          <div className={`text-sm font-medium mt-3 ${textPrimary}`}>No custom product pages yet</div>
          <div className={`text-[13px] mt-1 max-w-md mx-auto ${textSecondary}`}>
            Create your first custom product page to target a specific audience with tailored
            screenshots and promotional text.
          </div>
          {canWrite && (
            <button onClick={() => setShowCreate(true)} className={`${btnPrimary} mt-4`}>
              <Plus className="w-4 h-4" />
              Create Product Page
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              addToast={addToast}
              canWrite={canWrite}
              onOpen={() => setSelectedId(page.id)}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePageModal addToast={addToast} onClose={() => setShowCreate(false)} onCreated={refetch} />
      )}
    </div>
  );
}

function PageCard({
  page,
  addToast,
  canWrite,
  onOpen,
  onChanged,
}: {
  page: ProductPage;
  addToast: ToastFn;
  canWrite: boolean;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingVisible, setTogglingVisible] = useState(false);
  const current = currentVersion(page);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiDelete(`/product-pages/${page.id}?bundleId=${encodeURIComponent(getActiveBundleId() ?? "")}`);
      addToast("Product page deleted", "success");
      onChanged();
    } catch (e: any) {
      addToast(e.message ?? "Delete failed", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const toggleVisible = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (page.visible === null) return;
    setTogglingVisible(true);
    try {
      await apiPatch(`/product-pages/${page.id}`, {
        bundleId: getActiveBundleId(),
        visible: !page.visible,
      });
      addToast(page.visible ? "Page hidden" : "Page is visible", "success");
      onChanged();
    } catch (err: any) {
      addToast(err.message ?? "Update failed", "error");
    } finally {
      setTogglingVisible(false);
    }
  };

  return (
    <>
      <div
        onClick={onOpen}
        className={`${cardCls} !p-4 cursor-pointer hover:border-[#595DD2]/50 transition-colors group`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={`text-[14px] font-semibold truncate ${textPrimary}`}>{page.name}</div>
          {canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              title="Delete page"
              className={`p-1.5 rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-[#9ca3af] hover:text-red-600 transition-all`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className={badgeOutline(current?.state ?? "created")}>{stateLabel(current?.state ?? null)}</span>
          {page.visible !== null && (
            <button
              onClick={toggleVisible}
              disabled={!canWrite || togglingVisible}
              title={canWrite ? "Toggle visibility" : undefined}
              className={`${badgeOutline(page.visible ? "approved" : "created")} gap-1 ${canWrite ? "cursor-pointer hover:opacity-75" : "cursor-default"}`}
            >
              {page.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {page.visible ? "Visible" : "Hidden"}
            </button>
          )}
          {page.versions.length > 1 && (
            <span className={`text-[11px] ${textMuted}`}>v{current?.version ?? "?"} · {page.versions.length} versions</span>
          )}
        </div>
        {page.url && (
          <div className="flex items-center gap-1 mt-2.5" onClick={(e) => e.stopPropagation()}>
            <span className={`text-[11px] font-mono truncate flex-1 ${textMuted}`}>{page.url}</span>
            <button
              onClick={() => copyText(page.url!, addToast)}
              title="Copy URL"
              className={`p-1 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted} hover:text-[#595DD2]`}
            >
              <Copy className="w-3 h-3" />
            </button>
            <a
              href={page.url}
              target="_blank"
              rel="noreferrer"
              title="Open in App Store"
              className={`p-1 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted} hover:text-[#595DD2]`}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete product page?"
          body={
            <>
              This deletes <strong>“{page.name}”</strong> with all its versions, localizations and
              screenshots in App Store Connect. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

function CreatePageModal({
  addToast,
  onClose,
  onCreated,
}: {
  addToast: ToastFn;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await apiPost("/product-pages", { bundleId: getActiveBundleId(), name: name.trim() });
      addToast("Product page created", "success");
      onCreated();
      onClose();
    } catch (e: any) {
      addToast(e.message ?? "Create failed", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className={`${cardCls} w-full max-w-md !p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className={`text-[15px] font-semibold ${textPrimary}`}>New Product Page</div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-[13px] mb-4 ${textSecondary}`}>
          Give the page an internal name, e.g. the campaign or audience it targets.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Summer Campaign"
          className={inputCls}
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={submit} disabled={!name.trim() || creating} className={btnPrimary}>
            {creating && <div className="spinner !w-3.5 !h-3.5" />}
            Create Page
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div className={`${cardCls} w-full max-w-md !p-5`} onClick={(e) => e.stopPropagation()}>
        <div className={`text-[15px] font-semibold ${textPrimary}`}>{title}</div>
        <div className={`text-[13px] mt-1.5 ${textSecondary}`}>{body}</div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                : btnPrimary
            }
          >
            {busy && <div className="spinner !w-3.5 !h-3.5" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageDetail({
  page,
  appId,
  addToast,
  canWrite,
  onBack,
  onChanged,
}: {
  page: ProductPage;
  appId: string | null;
  addToast: ToastFn;
  canWrite: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [versions, setVersions] = useState<ProductPageVersion[]>(page.versions);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    currentVersion(page)?.id ?? null,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(page.name);
  const [savingName, setSavingName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;

  const refreshVersions = useCallback(async () => {
    try {
      const res = await apiGet<{ versions: ProductPageVersion[] }>(`/product-pages/${page.id}/versions`);
      setVersions(res.versions);
      return res.versions;
    } catch (e: any) {
      addToast(e.message ?? "Could not load versions", "error");
      return null;
    }
  }, [page.id, addToast]);

  useEffect(() => {
    setVersions(page.versions);
    setSelectedVersionId((prev) => {
      if (prev && page.versions.some((v) => v.id === prev)) return prev;
      return currentVersion(page)?.id ?? null;
    });
    setNameDraft(page.name);
  }, [page]);

  const saveName = async () => {
    if (!nameDraft.trim() || nameDraft.trim() === page.name) {
      setEditingName(false);
      setNameDraft(page.name);
      return;
    }
    setSavingName(true);
    try {
      await apiPatch(`/product-pages/${page.id}`, { bundleId: getActiveBundleId(), name: nameDraft.trim() });
      addToast("Name updated", "success");
      setEditingName(false);
      onChanged();
    } catch (e: any) {
      addToast(e.message ?? "Update failed", "error");
    } finally {
      setSavingName(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiDelete(`/product-pages/${page.id}?bundleId=${encodeURIComponent(getActiveBundleId() ?? "")}`);
      addToast("Product page deleted", "success");
      onBack();
      onChanged();
    } catch (e: any) {
      addToast(e.message ?? "Delete failed", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const ensureVersion = async () => {
    setCreatingVersion(true);
    try {
      const res = await apiPost<{ version: ProductPageVersion; created: boolean }>(
        `/product-pages/${page.id}/versions`,
        { bundleId: getActiveBundleId() },
      );
      addToast(res.created ? "New draft version created" : "Draft version ready", "success");
      const list = await refreshVersions();
      if (list) setSelectedVersionId(res.version.id);
      onChanged();
    } catch (e: any) {
      addToast(e.message ?? "Could not create version", "error");
    } finally {
      setCreatingVersion(false);
    }
  };

  const submitForReview = async () => {
    if (!selectedVersion) return;
    setSubmitting(true);
    try {
      await apiPost(`/product-pages/versions/${selectedVersion.id}/submit`, {
        bundleId: getActiveBundleId(),
      });
      addToast("Submitted for review", "success");
      setConfirmSubmit(false);
      refreshVersions();
      onChanged();
    } catch (e: any) {
      addToast(e.message ?? "Submit failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button
        onClick={onBack}
        className={`flex items-center gap-1.5 text-[13px] font-medium mb-3 ${textSecondary} hover:text-[#595DD2] transition-colors`}
      >
        <ArrowLeft className="w-4 h-4" />
        All product pages
      </button>

      <div className={`${cardCls} mb-3`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2 max-w-md">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") {
                      setEditingName(false);
                      setNameDraft(page.name);
                    }
                  }}
                  className={inputCls}
                />
                <button onClick={saveName} disabled={savingName} className={btnPrimSm}>
                  {savingName ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className={`${pageTitle} !text-2xl truncate`}>{page.name}</h1>
                {canWrite && (
                  <button
                    onClick={() => setEditingName(true)}
                    title="Rename"
                    className={`p-1.5 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted} hover:text-[#595DD2]`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            {page.url ? (
              <div className="flex items-center gap-1 mt-1.5 max-w-xl">
                <span className={`text-[12px] font-mono truncate ${textMuted}`}>{page.url}</span>
                <button
                  onClick={() => copyText(page.url!, addToast)}
                  title="Copy URL"
                  className={`p-1 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted} hover:text-[#595DD2] shrink-0`}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in App Store"
                  className={`p-1 rounded-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${textMuted} hover:text-[#595DD2] shrink-0`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <div className={`text-[12px] mt-1.5 ${textMuted}`}>
                Apple assigns the page URL once the first version is approved.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {page.visible !== null && (
              <span className={badgeOutline(page.visible ? "approved" : "created")}>
                {page.visible ? "Visible" : "Hidden"}
              </span>
            )}
            {canWrite && (
              <button onClick={() => setConfirmDelete(true)} className={btnSecSm} title="Delete page">
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        </div>

        <div className={`flex items-center gap-2 mt-4 pt-4 border-t ${borderDefault} flex-wrap`}>
          <span className={`text-[12px] font-medium ${textMuted}`}>Version</span>
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelectedVersionId(v.id)}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-medium border transition-all ${
                v.id === selectedVersionId
                  ? "border-[#595DD2] text-[#595DD2] bg-[#595DD2]/5"
                  : `border-[#eef0f3] dark:border-[#2a2f3d] ${textSecondary} hover:border-[#595DD2]/50`
              }`}
            >
              v{v.version ?? "?"}
            </button>
          ))}
          {canWrite && !versions.some((v) => v.isEditable) && (
            <button onClick={ensureVersion} disabled={creatingVersion} className={btnSecSm}>
              {creatingVersion ? <div className="spinner !w-3 h-3" /> : <Plus className="w-3.5 h-3.5" />}
              New draft version
            </button>
          )}
          {selectedVersion && (
            <span className={`ml-1 ${badgeOutline(selectedVersion.state ?? "created")}`}>
              {stateLabel(selectedVersion.state)}
            </span>
          )}
          {canWrite && selectedVersion?.isEditable && (
            <button onClick={() => setConfirmSubmit(true)} className={`${btnSecSm} ml-auto`}>
              <Send className="w-3.5 h-3.5" />
              Submit for Review
            </button>
          )}
        </div>

        {selectedVersion && (
          <DeepLinkEditor
            key={selectedVersion.id}
            version={selectedVersion}
            addToast={addToast}
            canWrite={canWrite}
            onSaved={(v) => {
              setVersions((prev) => prev.map((x) => (x.id === v.id ? v : x)));
              onChanged();
            }}
          />
        )}
      </div>

      {selectedVersion ? (
        <VersionLocalizations
          key={selectedVersion.id}
          version={selectedVersion}
          appId={appId}
          addToast={addToast}
          canWrite={canWrite}
        />
      ) : (
        <div className={`${cardCls} py-10 text-center`}>
          <div className={`text-sm font-medium ${textPrimary}`}>No version yet</div>
          <div className={`text-[13px] mt-1 ${textSecondary}`}>
            Create a draft version to add localizations and screenshots.
          </div>
          {canWrite && (
            <button onClick={ensureVersion} disabled={creatingVersion} className={`${btnPrimary} mt-4`}>
              {creatingVersion ? <div className="spinner !w-3.5 !h-3.5" /> : <Plus className="w-4 h-4" />}
              Create Draft Version
            </button>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete product page?"
          body={
            <>
              This deletes <strong>“{page.name}”</strong> with all its versions, localizations and
              screenshots in App Store Connect. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      )}

      {confirmSubmit && selectedVersion && (
        <ConfirmModal
          title="Submit for review?"
          body={
            <>
              This submits version <strong>v{selectedVersion.version ?? "?"}</strong> of “{page.name}”
              to App Review. Make sure screenshots and promotional text are final.
            </>
          }
          confirmLabel="Submit for Review"
          busy={submitting}
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={submitForReview}
        />
      )}
    </div>
  );
}

function DeepLinkEditor({
  version,
  addToast,
  canWrite,
  onSaved,
}: {
  version: ProductPageVersion;
  addToast: ToastFn;
  canWrite: boolean;
  onSaved: (v: ProductPageVersion) => void;
}) {
  const [draft, setDraft] = useState(version.deepLink ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== (version.deepLink ?? "");

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await apiPatch<ProductPageVersion>(`/product-pages/versions/${version.id}`, {
        bundleId: getActiveBundleId(),
        deepLink: draft.trim(),
      });
      addToast("Deep link updated", "success");
      onSaved(updated.id ? updated : { ...version, deepLink: draft.trim() });
    } catch (e: any) {
      addToast(e.message ?? "Update failed", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-3 max-w-2xl">
      <Link2 className={`w-4 h-4 shrink-0 ${textMuted}`} />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        disabled={!canWrite || !version.isEditable}
        placeholder="Deep link URL, e.g. myapp://summer-sale"
        className={`${inputCls} !py-[7px] font-mono !text-[12px]`}
      />
      {canWrite && version.isEditable && dirty && (
        <button onClick={save} disabled={saving} className={btnPrimSm}>
          {saving ? <div className="spinner !w-3 h-3" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </button>
      )}
    </div>
  );
}

function VersionLocalizations({
  version,
  appId,
  addToast,
  canWrite,
}: {
  version: ProductPageVersion;
  appId: string | null;
  addToast: ToastFn;
  canWrite: boolean;
}) {
  const [localizations, setLocalizations] = useState<ProductPageLocalization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocale, setSelectedLocale] = useState<string | null>(null);
  const [showAddLocale, setShowAddLocale] = useState(false);
  const [addingLocale, setAddingLocale] = useState(false);
  const { data: supportedLocales } = useApi<string[]>("/asc/supported-locales", [], true);
  const addLocaleRef = useRef<HTMLDivElement>(null);
  useClickOutside(addLocaleRef, () => setShowAddLocale(false));

  const editable = version.isEditable && canWrite;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ localizations: ProductPageLocalization[] }>(
        `/product-pages/versions/${version.id}/localizations`,
      );
      setLocalizations(res.localizations);
      setSelectedLocale((prev) => {
        if (prev && res.localizations.some((l) => l.locale === prev)) return prev;
        return (
          res.localizations.find((l) => l.locale === "en-US")?.locale ??
          res.localizations[0]?.locale ??
          null
        );
      });
    } catch (e: any) {
      addToast(e.message ?? "Could not load localizations", "error");
    } finally {
      setLoading(false);
    }
  }, [version.id, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const createLocalization = async (locale: string) => {
    setAddingLocale(true);
    setShowAddLocale(false);
    try {
      const created = await apiPost<ProductPageLocalization>(
        `/product-pages/versions/${version.id}/localizations`,
        { bundleId: getActiveBundleId(), locale },
      );
      addToast(`Localization ${locale} added`, "success");
      if (created.id) {
        await load();
        setSelectedLocale(locale);
      } else {
        load();
      }
    } catch (e: any) {
      addToast(e.message ?? "Could not add localization", "error");
    } finally {
      setAddingLocale(false);
    }
  };

  const deleteLocalization = async (loc: ProductPageLocalization) => {
    try {
      await apiDelete(
        `/product-pages/localizations/${loc.id}?bundleId=${encodeURIComponent(getActiveBundleId() ?? "")}`,
      );
      addToast(`Localization ${loc.locale} deleted`, "success");
      load();
    } catch (e: any) {
      addToast(e.message ?? "Delete failed", "error");
    }
  };

  const selected = localizations.find((l) => l.locale === selectedLocale) ?? null;

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {localizations.map((l) => (
          <button
            key={l.locale}
            onClick={() => setSelectedLocale(l.locale)}
            className={`flex items-center gap-2 px-3 py-[7px] rounded-xl border text-[13px] font-medium transition-all ${
              l.locale === selectedLocale
                ? "border-[#595DD2] text-[#595DD2] bg-[#595DD2]/5"
                : `border-[#eef0f3] dark:border-[#2a2f3d] ${textSecondary} hover:border-[#595DD2]/50`
            }`}
          >
            <LocaleFlag locale={l.locale} />
            {getLocaleName(l.locale)}
          </button>
        ))}
        {editable && (
          <div ref={addLocaleRef} className="relative shrink-0">
            <button
              onClick={() => setShowAddLocale((v) => !v)}
              disabled={addingLocale}
              className={`flex items-center gap-1.5 px-3 py-[7px] rounded-xl border border-dashed border-[#d1d5db] dark:border-[#3a4050] ${textSecondary} hover:border-[#595DD2] hover:text-[#595DD2] transition-all text-[13px] font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {addingLocale ? <div className="spinner !w-3.5 !h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              Add Language
            </button>
            {showAddLocale && (
              <div
                className={`absolute left-0 top-full mt-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[235px] max-h-64 overflow-y-auto`}
              >
                {(supportedLocales ?? [])
                  .filter((l) => !localizations.some((loc) => loc.locale === l))
                  .sort((a, b) => getLocaleName(a).localeCompare(getLocaleName(b)))
                  .map((locale) => (
                    <button
                      key={locale}
                      onClick={() => createLocalization(locale)}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left`}
                    >
                      <span className="flex items-center gap-2">
                        <LocaleFlag locale={locale} className="w-5 h-4 rounded-xs" />
                        {getLocaleName(locale)}
                      </span>
                      <span className={`text-[11px] font-mono ${textMuted}`}>{locale}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="spinner" />
          <span className={`text-[13px] ${textSecondary}`}>Loading localizations…</span>
        </div>
      ) : !selected ? (
        <div className="py-8 text-center">
          <div className={`text-sm font-medium ${textPrimary}`}>No localizations yet</div>
          <div className={`text-[13px] mt-1 ${textSecondary}`}>
            {editable
              ? "Add a language to set promotional text and screenshots."
              : "This version has no localizations."}
          </div>
        </div>
      ) : (
        <LocalizationEditor
          key={selected.id}
          localization={selected}
          appId={appId}
          editable={editable}
          addToast={addToast}
          onDelete={() => deleteLocalization(selected)}
          onPromoSaved={(text) =>
            setLocalizations((prev) => prev.map((l) => (l.id === selected.id ? { ...l, promotionalText: text } : l)))
          }
        />
      )}
    </div>
  );
}

function LocalizationEditor({
  localization,
  appId,
  editable,
  addToast,
  onDelete,
  onPromoSaved,
}: {
  localization: ProductPageLocalization;
  appId: string | null;
  editable: boolean;
  addToast: ToastFn;
  onDelete: () => void;
  onPromoSaved: (text: string) => void;
}) {
  const [promoDraft, setPromoDraft] = useState(localization.promotionalText);
  const [savingPromo, setSavingPromo] = useState(false);
  const [confirmDeleteLocale, setConfirmDeleteLocale] = useState(false);

  const promoDirty = promoDraft !== localization.promotionalText;

  const savePromo = async () => {
    if (!promoDirty) return;
    setSavingPromo(true);
    try {
      await apiPatch(`/product-pages/localizations/${localization.id}`, {
        bundleId: getActiveBundleId(),
        promotionalText: promoDraft,
      });
      addToast("Promotional text saved", "success");
      onPromoSaved(promoDraft);
    } catch (e: any) {
      addToast(e.message ?? "Save failed", "error");
    } finally {
      setSavingPromo(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className={`text-[13px] font-semibold ${textPrimary}`}>Promotional Text</div>
        {editable && (
          <button
            onClick={() => setConfirmDeleteLocale(true)}
            className={`flex items-center gap-1 text-[12px] font-medium ${textMuted} hover:text-red-600 transition-colors`}
          >
            <Trash2 className="w-3 h-3" />
            Delete {localization.locale}
          </button>
        )}
      </div>
      <p className={`text-[12px] mb-2 ${textMuted}`}>
        Name, subtitle and description are inherited from the default product page — only promotional
        text and screenshots can differ per custom page.
      </p>
      <textarea
        value={promoDraft}
        onChange={(e) => setPromoDraft(e.target.value)}
        disabled={!editable}
        rows={3}
        maxLength={170}
        placeholder="Promotional text shown at the top of this product page…"
        className={`${inputCls} resize-y !text-[13px]`}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[11px] font-mono ${textMuted}`}>{promoDraft.length}/170</span>
        {editable && promoDirty && (
          <button onClick={savePromo} disabled={savingPromo} className={btnPrimSm}>
            {savingPromo ? <div className="spinner !w-3 h-3" /> : <Check className="w-3.5 h-3.5" />}
            Save Text
          </button>
        )}
      </div>

      <div className={`mt-5 pt-4 border-t ${borderDefault}`}>
        {appId && (
          <ConnectedScreenshotsPanel
            appId={appId}
            activeLocale={localization.locale}
            addToast={addToast}
            liveFallback={(locale) => ({
              url: `/product-pages/localizations/${localization.id}/screenshots`,
              sourceLabel: locale,
            })}
          />
        )}
      </div>

      {confirmDeleteLocale && (
        <ConfirmModal
          title={`Delete ${localization.locale}?`}
          body="This removes the promotional text and all screenshots of this language from the version. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={false}
          onCancel={() => setConfirmDeleteLocale(false)}
          onConfirm={() => {
            setConfirmDeleteLocale(false);
            onDelete();
          }}
        />
      )}
    </div>
  );
}
