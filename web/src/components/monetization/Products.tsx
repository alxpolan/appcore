import { useState, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  Check,
  Globe,
  DollarSign,
  ArrowLeft,
  MoreHorizontal,
  Paperclip,
  FileText,
  Sparkles,
} from "lucide-react";
import { authHeaders, getActiveBundleId } from "../../hooks/useApi";
import {
  TD,
  TH,
  badgeOutline,
  borderDefault,
  btnPrimary,
  btnSecSm,
  btnSecondary,
  cardCls,
  inputCls,
  pageTitle,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import type { ProductItem, ProductLocalization, ProductPrice, ProductPricePoint } from "../../types";
import { territoryFlagSrc } from "../../utils/territoryFlags";
import SmartPricingModal from "./SmartPricingModal";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

const TYPE_LABELS: Record<string, string> = {
  CONSUMABLE: "Consumable",
  NON_CONSUMABLE: "Non-Consumable",
  NON_RENEWING_SUBSCRIPTION: "Non-Renewing Subscription",
};

const TYPES = Object.keys(TYPE_LABELS);

const STATE_SHORT: Record<string, string> = {
  APPROVED: "Approved",
  READY_TO_SUBMIT: "Ready",
  MISSING_METADATA: "Missing Metadata",
  WAITING_FOR_REVIEW: "In Review Queue",
  IN_REVIEW: "In Review",
  REJECTED: "Rejected",
  DEVELOPER_ACTION_NEEDED: "Action Needed",
  DEVELOPER_REMOVED_FROM_SALE: "Removed",
  REMOVED_FROM_SALE: "Removed",
  PENDING_BINARY_APPROVAL: "Pending",
};

function StatusBadge({ state }: { state: string }) {
  const label = STATE_SHORT[state] ?? state;
  const isApproved = state === "APPROVED" || state === "READY_TO_SUBMIT";
  const isError = state === "REJECTED" || state === "DEVELOPER_ACTION_NEEDED";
  const isWarning = state === "MISSING_METADATA";
  const variant = isApproved ? "success_tonal" : isError ? "danger_tonal" : isWarning ? "warning_tonal" : "info_tonal";
  return <span className={badgeOutline(variant)}>{label}</span>;
}

interface ProductFormState {
  name: string;
  productId: string;
  inAppPurchaseType: string;
  reviewNote: string;
}

const emptyProductForm = (): ProductFormState => ({
  name: "",
  productId: "",
  inAppPurchaseType: "CONSUMABLE",
  reviewNote: "",
});

interface ProductFormProps {
  initial?: Partial<ProductFormState>;
  onSave: (v: ProductFormState) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  title: string;
  lockProductId?: boolean;
}

function ProductForm({ initial, onSave, onCancel, saving, title, lockProductId }: ProductFormProps) {
  const [form, setForm] = useState<ProductFormState>({ ...emptyProductForm(), ...initial });
  const set = (k: keyof ProductFormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className={`rounded-xl border ${borderDefault} bg-[#fafbfc] dark:bg-[#1c2028] p-4 flex flex-col gap-3`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>{title}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Gold Pack"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Product ID</label>
          <input
            className={inputCls}
            value={form.productId}
            onChange={(e) => set("productId", e.target.value)}
            placeholder="e.g. com.app.gold.pack"
            disabled={lockProductId}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Type</label>
          <select
            className={inputCls}
            value={form.inAppPurchaseType}
            onChange={(e) => set("inAppPurchaseType", e.target.value)}
            disabled={lockProductId}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[11px] ${textSecondary} font-medium`}>Review Note (optional)</label>
          <input
            className={inputCls}
            value={form.reviewNote}
            onChange={(e) => set("reviewNote", e.target.value)}
            placeholder="Notes for App Review"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onCancel} disabled={saving} className={btnSecondary}>
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.productId.trim()}
          className={btnPrimary}
        >
          {saving ? (
            <>
              <div className="spinner !w-3.5 !h-3.5" /> Saving…
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" /> Save
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LocalizationsPanel({ productId, addToast }: { productId: string; addToast: Props["addToast"] }) {
  const [locs, setLocs] = useState<ProductLocalization[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLocale, setNewLocale] = useState("en-US");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/products/${productId}/localizations`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setLocs([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const addLoc = async () => {
    if (!newLocale.trim() || !newName.trim()) return;
    setSaving(true);

    try {
      const res = await fetch("/api/asc/products/localizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          productId,
          locale: newLocale.trim(),
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      setLocs((l) => [...(l ?? []), json]);
      setShowAdd(false);
      setNewLocale("en-US");
      setNewName("");
      setNewDesc("");
      addToast("Localization added", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/asc/products/localizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: editName, description: editDesc }),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs(
        (l) => l?.map((loc) => (loc.id === id ? { ...loc, name: editName, description: editDesc } : loc)) ?? null,
      );
      setEditingId(null);
      addToast("Localization updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteLoc = async (id: string) => {
    if (!confirm("Delete this localization?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/asc/products/localizations/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setLocs((l) => l?.filter((loc) => loc.id !== id) ?? null);
      addToast("Localization deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && !locs) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
      >
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Localizations</span>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
        >
          <Paperclip className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {(!locs || locs.length === 0) && !showAdd ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>No localizations yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Locale</th>
              <th className={TH}>Name</th>
              <th className={TH}>Description</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {locs?.map((loc) =>
              editingId === loc.id ? (
                <tr key={loc.id} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Display name"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      className={inputCls}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                    />
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditingId(null)} className={btnSecSm}>
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => saveEdit(loc.id)}
                        disabled={savingEdit || !editName.trim()}
                        className={btnSecSm}
                      >
                        {savingEdit ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={loc.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={TD}>
                    <span className={`text-[11px] font-mono font-semibold ${textSecondary} uppercase`}>
                      {loc.locale}
                    </span>
                  </td>
                  <td className={`${TD} font-medium ${textPrimary}`}>{loc.name}</td>
                  <td className={`${TD} ${textSecondary}`}>{loc.description || "—"}</td>
                  <td className={`${TD} text-right`}>
                    <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingId(loc.id);
                          setEditName(loc.name);
                          setEditDesc(loc.description ?? "");
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteLoc(loc.id)}
                        disabled={deletingId === loc.id}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-50"
                      >
                        {deletingId === loc.id ? <div className="spinner !w-3 !h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Locale</label>
              <input
                className={inputCls}
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
                placeholder="en-US"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Display Name</label>
              <input
                className={inputCls}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Gold Pack"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Description (optional)</label>
              <input
                className={inputCls}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Unlock extra coins"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={addLoc} disabled={saving || !newLocale.trim() || !newName.trim()} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Plus className="w-3 h-3" />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingPanel({ productId, addToast }: { productId: string; addToast: Props["addToast"] }) {
  const [prices, setPrices] = useState<ProductPrice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [territory, setTerritory] = useState("USA");
  const [pricePoints, setPricePoints] = useState<ProductPricePoint[] | null>(null);
  const [loadingPP, setLoadingPP] = useState(false);
  const [selectedPP, setSelectedPP] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPricePoints, setEditPricePoints] = useState<ProductPricePoint[] | null>(null);
  const [editLoadingPP, setEditLoadingPP] = useState(false);
  const [editSelectedPP, setEditSelectedPP] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showSmart, setShowSmart] = useState(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asc/products/${productId}/prices`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setPrices(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setPrices([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  const loadPricePoints = useCallback(
    async (terr: string) => {
      if (!terr.trim()) return;
      setLoadingPP(true);
      setPricePoints(null);
      setSelectedPP("");

      try {
        const res = await fetch(
          `/api/asc/products/${productId}/price-points?territory=${encodeURIComponent(terr.trim())}`,
          { headers: authHeaders() },
        );

        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const data: ProductPricePoint[] = await res.json();
        setPricePoints(data);

        if (data.length > 0) setSelectedPP(data[0].id);
      } catch (err: any) {
        addToast(err.message, "error");
        setPricePoints([]);
      } finally {
        setLoadingPP(false);
      }
    },
    [productId],
  );

  const handleTerritoryChange = (val: string) => {
    setTerritory(val);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => loadPricePoints(val), 600);
  };

  const openAdd = () => {
    setShowAdd(true);
    loadPricePoints(territory);
  };

  const setPrice = async () => {
    if (!selectedPP) return;
    setSaving(true);

    try {
      const res = await fetch("/api/asc/products/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ productId, pricePointId: selectedPP, territory }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setShowAdd(false);

      await loadPrices();
      addToast("Price set", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const startEditPrice = async (p: ProductPrice) => {
    if (!p.territory) return;
    setEditingId(p.id);
    setEditPricePoints(null);
    setEditSelectedPP(p.pricePointId ?? "");
    setEditLoadingPP(true);

    try {
      const res = await fetch(
        `/api/asc/products/${productId}/price-points?territory=${encodeURIComponent(p.territory)}`,
        { headers: authHeaders() },
      );

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const data: ProductPricePoint[] = await res.json();
      setEditPricePoints(data);

      if (!data.some((pp) => pp.id === p.pricePointId)) {
        setEditSelectedPP(data[0]?.id ?? "");
      }
    } catch (err: any) {
      addToast(err.message, "error");
      setEditPricePoints([]);
    } finally {
      setEditLoadingPP(false);
    }
  };

  const cancelEditPrice = () => setEditingId(null);

  const saveEditPrice = async (p: ProductPrice) => {
    if (!editSelectedPP || !p.territory) return;
    setSavingEdit(true);

    try {
      const res = await fetch("/api/asc/products/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ productId, pricePointId: editSelectedPP, territory: p.territory }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setEditingId(null);

      await loadPrices();
      addToast("Price updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading && !prices) {
    return (
      <div className={`flex items-center gap-1.5 py-4 text-[12px] ${textMuted}`}>
        <div className="spinner !w-3 !h-3" /> Loading…
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${borderDefault} overflow-hidden`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38]`}
      >
        <span className={`text-[13px] font-semibold ${textPrimary}`}>Pricing</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSmart(true)}
            className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
          >
            <Sparkles className="w-3.5 h-3.5" /> Smart Pricing
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 text-[12px] text-[#595DD2] hover:opacity-80 transition-opacity font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Set Price
          </button>
        </div>
      </div>

      <SmartPricingModal
        open={showSmart}
        onClose={() => setShowSmart(false)}
        kind="product"
        entityId={productId}
        currentUsaPricePointId={prices?.find((p) => p.territory === "USA")?.pricePointId ?? null}
        onApplied={loadPrices}
        addToast={addToast}
      />

      {(!prices || prices.length === 0) && !showAdd ? (
        <p className={`text-[12px] ${textMuted} px-4 py-4`}>No prices set yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Territory</th>
              <th className={TH}>Currency</th>
              <th className={TH}>Customer Price</th>
              <th className={TH}>Proceeds</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {prices?.map((p) => {
              const territoryCell = (
                <span className="flex items-center gap-1.5">
                  {territoryFlagSrc(p.territory) != null && (
                    <img
                      src={territoryFlagSrc(p.territory)!}
                      alt=""
                      width={20}
                      height={15}
                      className="h-[14px] w-[19px] object-contain shrink-0 rounded-xs"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  {p.territory}
                </span>
              );

              if (editingId === p.id) {
                const selectedEditPP = editPricePoints?.find((pp) => pp.id === editSelectedPP);
                return (
                  <tr key={p.id} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                    <td className={`${TD} font-mono font-medium ${textPrimary}`}>
                      {p.territory ? territoryCell : "—"}
                    </td>
                    <td className={`${TD} ${textSecondary}`}>{p.currency ?? "—"}</td>
                    <td className={TD}>
                      {editLoadingPP ? (
                        <div className={`${inputCls} ${textMuted}`}>Loading tiers…</div>
                      ) : editPricePoints && editPricePoints.length > 0 ? (
                        <select
                          className={inputCls}
                          value={editSelectedPP}
                          onChange={(e) => setEditSelectedPP(e.target.value)}
                        >
                          {editPricePoints.map((pp) => (
                            <option key={pp.id} value={pp.id}>
                              {pp.customerPrice} (proceeds: {pp.proceeds})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className={`${inputCls} ${textMuted}`}>No tiers found</div>
                      )}
                    </td>
                    <td className={`${TD} ${textSecondary}`}>
                      {selectedEditPP ? `${p.currency ?? ""} ${selectedEditPP.proceeds}` : "—"}
                    </td>
                    <td className={`${TD} text-right`}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={cancelEditPrice} className={btnSecSm}>
                          <X className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => saveEditPrice(p)}
                          disabled={savingEdit || !editSelectedPP}
                          className={btnSecSm}
                        >
                          {savingEdit ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={p.id}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors"
                >
                  <td className={`${TD} font-mono font-medium ${textPrimary}`}>{p.territory ? territoryCell : "—"}</td>
                  <td className={`${TD} ${textSecondary}`}>{p.currency ?? "—"}</td>
                  <td className={`${TD} font-semibold ${textPrimary}`}>
                    {p.customerPrice != null ? `${p.currency ?? ""} ${p.customerPrice}` : "—"}
                  </td>
                  <td className={`${TD} ${textSecondary}`}>
                    {p.proceeds != null ? `${p.currency ?? ""} ${p.proceeds}` : "—"}
                  </td>
                  <td className={`${TD} text-right`}>
                    <button
                      onClick={() => startEditPrice(p)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 rounded-lg text-gray-400 hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className={`border-t ${borderDefault} p-3 flex flex-col gap-2 bg-[#fafbfc] dark:bg-[#1c2028]`}>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>Territory (3-letter code)</label>
              <input
                className={inputCls}
                value={territory}
                onChange={(e) => handleTerritoryChange(e.target.value.toUpperCase())}
                placeholder="USA"
                maxLength={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={`text-[11px] ${textSecondary} font-medium`}>
                Price Tier
                {loadingPP && <span className="ml-1 text-[10px] text-[#9ca3af]">loading…</span>}
              </label>
              {pricePoints && pricePoints.length > 0 ? (
                <select className={inputCls} value={selectedPP} onChange={(e) => setSelectedPP(e.target.value)}>
                  {pricePoints.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.customerPrice} (proceeds: {pp.proceeds})
                    </option>
                  ))}
                </select>
              ) : (
                <div className={`${inputCls} ${textMuted}`}>
                  {loadingPP ? "Loading tiers…" : pricePoints !== null ? "No tiers found" : "Enter territory first"}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={setPrice} disabled={saving || !selectedPP} className={btnSecSm}>
              {saving ? <div className="spinner !w-3 !h-3" /> : <Check className="w-3 h-3" />}
              Set Price
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReviewPanelProps {
  product: ProductItem;
  onReviewNoteUpdated: (note: string | null) => void;
  addToast: Props["addToast"];
}

function ReviewPanel({ product, onReviewNoteUpdated, addToast }: ReviewPanelProps) {
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState(product.reviewNote ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reviewNote: noteText || null }),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);

      onReviewNoteUpdated(noteText || null);
      setEditing(false);
      addToast("Review note saved", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[12px] font-semibold ${textSecondary} uppercase tracking-wide`}>Review Note</span>
        {!editing && (
          <button
            onClick={() => {
              setNoteText(product.reviewNote ?? "");
              setEditing(true);
            }}
            className="text-[12px] text-[#595DD2] hover:underline"
          >
            {product.reviewNote ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Notes for the App Review team…"
            className={`${inputCls} resize-none`}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#9ca3af]">{noteText.length}/4000</span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className={btnSecondary}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className={btnPrimary}>
                {saving ? <div className="spinner !w-3.5 !h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : product.reviewNote ? (
        <p
          className={`text-[13px] text-[#374151] dark:text-[#c4c9d6] whitespace-pre-wrap leading-relaxed rounded-xl bg-[#f9fafb] dark:bg-[#1a1f2b] border ${borderDefault} px-3.5 py-3`}
        >
          {product.reviewNote}
        </p>
      ) : (
        <p className={`text-[13px] ${textMuted} italic`}>No review note added.</p>
      )}
    </div>
  );
}

interface DetailViewProps {
  product: ProductItem;
  bundleId: string | null;
  onBack: () => void;
  onUpdated: (updated: ProductItem) => void;
  onDeleted: () => void;
  addToast: Props["addToast"];
}

function DetailView({ product, bundleId, onBack, onUpdated, onDeleted, addToast }: DetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"localizations" | "pricing" | "review">("localizations");

  const handleUpdate = async (form: ProductFormState) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/asc/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: form.name,
          reviewNote: form.reviewNote || null,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);

      onUpdated({ ...product, name: form.name, reviewNote: form.reviewNote || null });
      setEditing(false);
      addToast("Product updated", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/asc/products/${product.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);

      onDeleted();
      addToast("Product deleted", "success");
    } catch (err: any) {
      addToast(err.message, "error");
      setDeleting(false);
    }
  };

  const AppleLogo = () => (
    <svg className="w-3.5 h-3.5 text-[#555] dark:text-[#aaa] shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: "Identifier",
      value: <span className={`font-mono text-[13px] ${textPrimary}`}>{product.productId}</span>,
    },
    {
      label: "App",
      value: (
        <span className={`flex items-center gap-1.5 text-[13px] ${textPrimary}`}>
          <AppleLogo />
          {bundleId ?? "App Store"}
        </span>
      ),
    },
    {
      label: "Store",
      value: <span className={`text-[13px] ${textPrimary}`}>App Store</span>,
    },
    {
      label: "Store Status",
      value: <StatusBadge state={product.state} />,
    },
    {
      label: "Display Name",
      value: <span className={`text-[13px] ${textPrimary}`}>{product.name}</span>,
    },
    {
      label: "Product Type",
      value: (
        <span className={`text-[13px] ${textPrimary}`}>
          {TYPE_LABELS[product.inAppPurchaseType] ?? product.inAppPurchaseType}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className={`p-2 rounded-xl border ${borderDefault} ${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0] hover:border-[#595DD2] transition-all shrink-0`}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className={`text-2xl font-semibold tracking-tight ${textPrimary} truncate`}>{product.name}</h1>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className={`p-1.5 rounded-lg ${textMuted} hover:text-[#595DD2] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all`}
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setEditing(true)} className={btnPrimary}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-xl border ${borderDefault} text-[13px] font-medium text-red-500 hover:border-red-300 dark:hover:border-red-800 transition-all disabled:opacity-50`}
            >
              {deleting ? <div className="spinner !w-3.5 !h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className={cardCls}>
          <ProductForm
            title="Edit Product"
            initial={{
              name: product.name,
              productId: product.productId,
              inAppPurchaseType: product.inAppPurchaseType,
              reviewNote: product.reviewNote ?? "",
            }}
            onSave={handleUpdate}
            onCancel={() => setEditing(false)}
            saving={saving}
            lockProductId
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={cardCls}>
            <dl className="divide-y divide-[#f3f4f6] dark:divide-[#2a2f3d]">
              {fields.map(({ label, value }) => (
                <div key={label} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <dt className={`w-44 shrink-0 text-[12px] font-medium ${textSecondary}`}>{label}</dt>
                  <dd className="flex-1 min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={cardCls}>
            <div className={`flex gap-1 mb-4 pb-3 border-b ${borderDefault}`}>
              <button
                onClick={() => setActiveTab("localizations")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "localizations"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <Globe className="w-3.5 h-3.5" /> Localizations
              </button>
              <button
                onClick={() => setActiveTab("pricing")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "pricing"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" /> Pricing
              </button>
              <button
                onClick={() => setActiveTab("review")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                  activeTab === "review"
                    ? `bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`
                    : `${textSecondary} hover:text-[#111827] dark:hover:text-[#e8eaf0]`
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> Review
              </button>
            </div>
            {activeTab === "localizations" ? (
              <LocalizationsPanel productId={product.id} addToast={addToast} />
            ) : activeTab === "pricing" ? (
              <PricingPanel productId={product.id} addToast={addToast} />
            ) : (
              <ReviewPanel
                product={product}
                onReviewNoteUpdated={(note) => onUpdated({ ...product, reviewNote: note })}
                addToast={addToast}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MonetizationProducts({ addToast }: Props) {
  const [products, setProducts] = useState<ProductItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const bundleId = getActiveBundleId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // bundleId
      const url = bundleId ? `/api/asc/products?bundleId=${encodeURIComponent(bundleId)}` : "/api/asc/products";
      const res = await fetch(url, { headers: authHeaders() });

      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setProducts(await res.json());
    } catch (err: any) {
      addToast(err.message, "error");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      setProducts(null);
      setSelectedProduct(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const createProduct = async (form: ProductFormState) => {
    setSaving(true);
    try {
      const res = await fetch("/api/asc/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId,
          name: form.name,
          productId: form.productId,
          inAppPurchaseType: form.inAppPurchaseType,
          reviewNote: form.reviewNote || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setProducts((p) => [...(p ?? []), json as ProductItem]);
      setShowNewForm(false);
      addToast("Product created", "success");
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdated = (updated: ProductItem) => {
    setProducts((p) => p?.map((prod) => (prod.id === updated.id ? updated : prod)) ?? null);
    setSelectedProduct((prev) => (prev?.id === updated.id ? updated : prev));
  };

  const handleDeleted = () => {
    if (!selectedProduct) return;
    setProducts((p) => p?.filter((prod) => prod.id !== selectedProduct.id) ?? null);
    setSelectedProduct(null);
  };

  if (selectedProduct) {
    return (
      <DetailView
        product={selectedProduct}
        bundleId={bundleId}
        onBack={() => setSelectedProduct(null)}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
        addToast={addToast}
      />
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className={pageTitle}>In-App Products</h1>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={btnSecondary}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => setShowNewForm(true)} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" /> New Product
          </button>
        </div>
      </div>

      {showNewForm && (
        <div className={`${cardCls} mb-4`}>
          <ProductForm
            title="New In-App Product"
            onSave={createProduct}
            onCancel={() => setShowNewForm(false)}
            saving={saving}
          />
        </div>
      )}

      {loading && !products && (
        <div className={`flex items-center justify-center py-16 gap-2 ${textMuted} text-sm`}>
          <div className="spinner" /> Loading products…
        </div>
      )}

      {products && products.length === 0 && !showNewForm && (
        <div className={`${cardCls} flex flex-col items-center justify-center py-16 gap-4 text-center`}>
          <div className="w-12 h-12 rounded-2xl bg-[#eef0fd] dark:bg-[#23253f] flex items-center justify-center">
            <svg
              className="w-6 h-6 text-[#595DD2]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <div>
            <p className={`text-[15px] font-semibold ${textPrimary}`}>No in-app products</p>
            <p className={`text-sm ${textSecondary} mt-1`}>
              Create your first product to start selling in-app purchases.
            </p>
          </div>
          <button onClick={() => setShowNewForm(true)} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" /> New Product
          </button>
        </div>
      )}

      {products && products.length > 0 && (
        <div className={`${cardCls} overflow-hidden !p-0`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Product</th>
                <th className={TH}>Type</th>
                <th className={TH}>Status</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {products.map((prod) => (
                <tr
                  key={prod.id}
                  onClick={() => setSelectedProduct(prod)}
                  className="group border-t border-[#f3f4f6] dark:border-[#2a2f3d] hover:bg-[#fafbfc] dark:hover:bg-[#252b38] cursor-pointer transition-colors"
                >
                  <td className={TD}>
                    <div>
                      <p className={`text-[13px] font-medium ${textPrimary}`}>{prod.name}</p>
                      <p className={`text-[11px] font-mono ${textMuted} mt-0.5`}>{prod.productId}</p>
                    </div>
                  </td>
                  <td className={`${TD} ${textSecondary}`}>
                    {TYPE_LABELS[prod.inAppPurchaseType] ?? prod.inAppPurchaseType}
                  </td>
                  <td className={TD}>
                    <StatusBadge state={prod.state} />
                  </td>
                  <td className={`${TD} text-right`}>
                    <MoreHorizontal
                      className={`w-4 h-4 ${textMuted} opacity-0 group-hover:opacity-100 transition-opacity`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
