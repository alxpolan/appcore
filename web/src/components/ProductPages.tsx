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
  ProductPage,
  ProductPageLocalization,
  ProductPageScreenshot,
  ProductPageVersion,
} from "../types";
import { getLocaleFlag, getLocaleName } from "../utils/localeUtils";
import { useClickOutside } from "../hooks/useClickOutside";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type ToastFn = (msg: string, type: "success" | "error" | "info") => void;

const DISPLAY_TYPE_LABELS: Record<string, string> = {
  APP_IPHONE_67: 'iPhone 6.7"',
  APP_IPHONE_65: 'iPhone 6.5"',
  APP_IPHONE_61: 'iPhone 6.1"',
  APP_IPHONE_58: 'iPhone 5.8"',
  APP_IPHONE_55: 'iPhone 5.5"',
  APP_IPHONE_47: 'iPhone 4.7"',
  APP_IPAD_PRO_3GEN_129: 'iPad Pro 12.9"',
  APP_IPAD_PRO_3GEN_11: 'iPad Pro 11"',
  APP_IPAD_105: 'iPad 10.5"',
  APP_IPAD_97: 'iPad 9.7"',
  APP_DESKTOP: "Desktop",
  APP_APPLE_TV: "Apple TV",
  APP_APPLE_VISION_PRO: "Vision Pro",
  APP_WATCH_ULTRA: "Watch Ultra",
  APP_WATCH_SERIES_7: "Watch Series 7",
  APP_WATCH_SERIES_4: "Watch Series 4",
  APP_WATCH_SERIES_3: "Watch Series 3",
};

function displayTypeLabel(t: string): string {
  return DISPLAY_TYPE_LABELS[t] ?? t;
}

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

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function ProductPages({ addToast }: { addToast: ToastFn }) {
  const { data, loading, error, refetch } = useApi<{ pages: ProductPage[] }>("/product-pages");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { canWrite } = usePermissions();

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
        addToast={addToast}
        canWrite={canWrite}
        onBack={() => setSelectedId(null)}
        onChanged={refetch}
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
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
              className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 text-[#9ca3af] hover:text-red-600 transition-all`}
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
  addToast,
  canWrite,
  onBack,
  onChanged,
}: {
  page: ProductPage;
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
  addToast,
  canWrite,
}: {
  version: ProductPageVersion;
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
  editable,
  addToast,
  onDelete,
  onPromoSaved,
}: {
  localization: ProductPageLocalization;
  editable: boolean;
  addToast: ToastFn;
  onDelete: () => void;
  onPromoSaved: (text: string) => void;
}) {
  const [promoDraft, setPromoDraft] = useState(localization.promotionalText);
  const [savingPromo, setSavingPromo] = useState(false);
  const [screenshots, setScreenshots] = useState<ProductPageScreenshot[]>([]);
  const [loadingShots, setLoadingShots] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [displayTypeOverride, setDisplayTypeOverride] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [deletingShot, setDeletingShot] = useState<string | null>(null);
  const [confirmDeleteLocale, setConfirmDeleteLocale] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const promoDirty = promoDraft !== localization.promotionalText;

  const loadScreenshots = useCallback(async () => {
    setLoadingShots(true);
    try {
      const res = await apiGet<{ screenshots: ProductPageScreenshot[] }>(
        `/product-pages/localizations/${localization.id}/screenshots`,
      );
      setScreenshots(res.screenshots);
    } catch (e: any) {
      addToast(e.message ?? "Could not load screenshots", "error");
    } finally {
      setLoadingShots(false);
    }
  }, [localization.id, addToast]);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

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

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploading(list.length);
    let failed = 0;
    for (const file of list) {
      try {
        const fileData = await readFileAsBase64(file);
        await apiPost(`/product-pages/localizations/${localization.id}/screenshots`, {
          bundleId: getActiveBundleId(),
          fileName: file.name,
          fileData,
          displayType: displayTypeOverride || undefined,
        });
      } catch (e: any) {
        failed++;
        addToast(`${file.name}: ${e.message ?? "Upload failed"}`, "error");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    if (failed < list.length) {
      addToast(
        failed === 0 ? `${list.length} screenshot(s) uploaded` : `${list.length - failed} uploaded, ${failed} failed`,
        failed === 0 ? "success" : "info",
      );
    }
    loadScreenshots();
    if (fileRef.current) fileRef.current.value = "";
  };

  const deleteScreenshot = async (id: string) => {
    setDeletingShot(id);
    try {
      await apiDelete(`/product-pages/screenshots/${id}?bundleId=${encodeURIComponent(getActiveBundleId() ?? "")}`);
      setScreenshots((prev) => prev.filter((s) => s.id !== id));
      setPreviewIndex(null);
    } catch (e: any) {
      addToast(e.message ?? "Delete failed", "error");
    } finally {
      setDeletingShot(null);
    }
  };

  const shotsByType = new Map<string, ProductPageScreenshot[]>();
  for (const s of screenshots) {
    if (!shotsByType.has(s.displayType)) shotsByType.set(s.displayType, []);
    shotsByType.get(s.displayType)!.push(s);
  }

  const preview = previewIndex !== null ? screenshots[previewIndex] ?? null : null;

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

      <div className={`flex items-center justify-between gap-2 mt-5 mb-2.5 pt-4 border-t ${borderDefault}`}>
        <div className={`text-[13px] font-semibold ${textPrimary}`}>
          Screenshots
          {screenshots.length > 0 && (
            <span className={`font-normal ml-1.5 ${textMuted}`}>· {screenshots.length}</span>
          )}
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <select
              value={displayTypeOverride}
              onChange={(e) => setDisplayTypeOverride(e.target.value)}
              title="Display type (auto-detected from image size by default)"
              className={`${inputCls} !w-auto !py-[6px] !text-[12px]`}
            >
              <option value="">Auto-detect size</option>
              {Object.entries(DISPLAY_TYPE_LABELS)
                .filter(([k]) => k.startsWith("APP_IPHONE") || k.startsWith("APP_IPAD"))
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button onClick={() => fileRef.current?.click()} disabled={uploading > 0} className={btnPrimSm}>
              {uploading > 0 ? <div className="spinner !w-3 h-3" /> : <Plus className="w-3.5 h-3.5" />}
              {uploading > 0 ? `Uploading… (${uploading})` : "Upload"}
            </button>
          </div>
        )}
      </div>

      {loadingShots ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="spinner" />
          <span className={`text-[13px] ${textSecondary}`}>Loading screenshots…</span>
        </div>
      ) : screenshots.length === 0 ? (
        <div className={`py-8 text-center border border-dashed rounded-xl ${borderDefault}`}>
          <ImageIcon className={`w-6 h-6 mx-auto ${textMuted}`} />
          <div className={`text-[13px] mt-2 ${textSecondary}`}>
            {editable ? "No screenshots yet — upload PNG or JPEG files." : "No screenshots in this localization."}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {[...shotsByType.entries()].map(([displayType, shots]) => (
            <div key={displayType}>
              <div className={`text-[12px] font-medium mb-1.5 ${textMuted}`}>
                {displayTypeLabel(displayType)} · {shots.length}
              </div>
              <div className="flex gap-2 flex-wrap">
                {shots.map((s) => {
                  const index = screenshots.indexOf(s);
                  return (
                    <div key={s.id} className="relative group/shot">
                      <img
                        src={s.thumbUrl}
                        alt={`${displayTypeLabel(displayType)} screenshot`}
                        onClick={() => setPreviewIndex(index)}
                        className="h-32 w-auto rounded-lg border border-[#eef0f3] dark:border-[#2a2f3d] object-cover cursor-pointer hover:border-[#595DD2]/60 transition-colors"
                        loading="lazy"
                      />
                      {editable && (
                        <button
                          onClick={() => deleteScreenshot(s.id)}
                          disabled={deletingShot === s.id}
                          title="Delete screenshot"
                          className="absolute top-1 right-1 w-6 h-6 rounded-md bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover/shot:opacity-100 transition-all disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6"
          onClick={() => setPreviewIndex(null)}
        >
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 text-white">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{displayTypeLabel(preview.displayType)}</div>
              <div className="text-[11px] text-white/60 font-mono">
                {localization.locale}
                {previewIndex !== null && screenshots.length > 1 ? ` · ${previewIndex + 1}/${screenshots.length}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScreenshot(preview.id);
                  }}
                  disabled={deletingShot === preview.id}
                  className="h-9 px-3 rounded-full bg-white/10 hover:bg-red-600/80 flex items-center gap-1.5 transition-colors text-[12px] font-medium"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewIndex(null);
                }}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                aria-label="Close screenshot preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {screenshots.length > 1 && previewIndex !== null && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewIndex((previewIndex - 1 + screenshots.length) % screenshots.length);
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
                  setPreviewIndex((previewIndex + 1) % screenshots.length);
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                aria-label="Next screenshot"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <img
            src={preview.url}
            alt={`${displayTypeLabel(preview.displayType)} screenshot preview`}
            className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

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
