import { useCallback, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { authHeaders } from "../../hooks/useApi";
import {
  TD,
  TH,
  borderDefault,
  btnPrimary,
  btnSecSm,
  inputCls,
  textMuted,
  textPrimary,
  textSecondary,
} from "../../styles";
import type { SmartPriceRow } from "../../types";
import { territoryFlagSrc } from "../../utils/territoryFlags";

interface BasePricePoint {
  id: string;
  customerPrice: string | null;
  proceeds: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  kind: "subscription" | "product";
  entityId: string;
  currentUsaPricePointId: string | null;
  onApplied: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function SmartPricingModal({
  open,
  onClose,
  kind,
  entityId,
  currentUsaPricePointId,
  onApplied,
  addToast,
}: Props) {
  const basePath = kind === "subscription" ? "subscriptions" : "products";
  const [basePoints, setBasePoints] = useState<BasePricePoint[] | null>(null);
  const [baseId, setBaseId] = useState("");
  const [rows, setRows] = useState<SmartPriceRow[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preserve, setPreserve] = useState(true);
  const [applying, setApplying] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setSelected(new Set());
    setRowErrors({});
    setBaseId(currentUsaPricePointId ?? "");
    setBasePoints(null);
    (async () => {
      try {
        const res = await fetch(`/api/asc/${basePath}/${entityId}/price-points?territory=USA`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const data: BasePricePoint[] = await res.json();
        setBasePoints(data);
        if (!currentUsaPricePointId && data.length > 0) setBaseId(data[0].id);
      } catch (err: any) {
        addToast(err.message, "error");
        setBasePoints([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityId]);

  const loadPreview = useCallback(
    async (pointId: string) => {
      setLoadingRows(true);
      setRows(null);
      setRowErrors({});
      try {
        const res = await fetch(`/api/asc/${basePath}/${entityId}/smart-prices`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ basePricePointId: pointId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const newRows: SmartPriceRow[] = json.rows;
        setRows(newRows);
        setSelected(new Set(newRows.filter((r) => r.changed).map((r) => r.territory)));
      } catch (err: any) {
        addToast(err.message, "error");
        setRows([]);
      } finally {
        setLoadingRows(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basePath, entityId],
  );

  useEffect(() => {
    if (open && baseId) loadPreview(baseId);
  }, [open, baseId, loadPreview]);

  if (!open) return null;

  const changedRows = rows?.filter((r) => r.changed) ?? [];
  const allChangedSelected = changedRows.length > 0 && changedRows.every((r) => selected.has(r.territory));
  const selectedCount = selected.size;
  const increases =
    rows?.filter((r) => selected.has(r.territory) && deltaPct(r) != null && deltaPct(r)! > 0).length ?? 0;
  const decreases =
    rows?.filter((r) => selected.has(r.territory) && deltaPct(r) != null && deltaPct(r)! < 0).length ?? 0;
  const added = rows?.filter((r) => selected.has(r.territory) && r.currentPrice == null).length ?? 0;

  const toggleAll = () => {
    if (allChangedSelected) setSelected(new Set());
    else setSelected(new Set(changedRows.map((r) => r.territory)));
  };

  const toggleRow = (territory: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(territory)) next.delete(territory);
      else next.add(territory);
      return next;
    });
  };

  const apply = async () => {
    if (!rows || selectedCount === 0) return;
    const items = rows
      .filter((r) => selected.has(r.territory))
      .map((r) => ({ territory: r.territory, pricePointId: r.suggestedPricePointId }));
    setApplying(true);
    setRowErrors({});
    try {
      const url = kind === "subscription" ? "/api/asc/subscriptions/prices/bulk" : "/api/asc/products/prices/bulk";
      const body =
        kind === "subscription"
          ? { subscriptionId: entityId, items, preserveCurrentPrice: preserve }
          : { productId: entityId, items };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (json.failed > 0) {
        const errs: Record<string, string> = {};
        for (const r of json.results as Array<{ territory: string; ok: boolean; error?: string }>) {
          if (!r.ok) errs[r.territory] = r.error ?? "Failed";
        }
        setRowErrors(errs);
        addToast(`${json.applied} prices applied, ${json.failed} failed`, "error");
        onApplied();
      } else {
        addToast(`${json.applied} prices applied`, "success");
        onApplied();
        onClose();
      }
    } catch (err: any) {
      addToast(err.message, "error");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !applying && onClose()}
    >
      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]`}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className={`flex items-center gap-1.5 text-base font-semibold ${textPrimary}`}>
              <Sparkles className="w-4 h-4 text-[#595DD2]" /> Smart Pricing
            </h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              Suggests a price per territory from your US base price, adjusted by a purchasing-power multiplier. Nothing
              is applied until you confirm.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={applying}
            className={`p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#252b38] transition-colors ${textMuted}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-3 flex items-end gap-3">
          <div className="flex flex-col gap-1 w-56">
            <label className={`text-[11px] ${textSecondary} font-medium`}>Base price (USA)</label>
            {basePoints === null ? (
              <div className={`${inputCls} ${textMuted}`}>Loading tiers…</div>
            ) : basePoints.length === 0 ? (
              <div className={`${inputCls} ${textMuted}`}>No tiers found</div>
            ) : (
              <select
                className={inputCls}
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                disabled={applying}
              >
                {basePoints.map((pp) => (
                  <option key={pp.id} value={pp.id}>
                    USD {pp.customerPrice} (proceeds: {pp.proceeds})
                  </option>
                ))}
              </select>
            )}
          </div>
          {rows && rows.length > 0 && (
            <p className={`text-[11px] ${textMuted} pb-2`}>
              {selectedCount} selected: {increases} increases, {decreases} decreases, {added} new
            </p>
          )}
        </div>

        <div className="flex-1 overflow-auto border-t border-[#f3f4f6] dark:border-[#2a2f3d] min-h-[160px]">
          {loadingRows || rows === null ? (
            <div className={`flex items-center gap-1.5 px-5 py-6 text-[12px] ${textMuted}`}>
              <div className="spinner !w-3 !h-3" /> Calculating suggestions…
            </div>
          ) : rows.length === 0 ? (
            <p className={`text-[12px] ${textMuted} px-5 py-6`}>No suggestions available.</p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-white dark:bg-[#1c2028]">
                <tr>
                  <th className={`${TH} w-8`}>
                    <input type="checkbox" checked={allChangedSelected} onChange={toggleAll} disabled={applying} />
                  </th>
                  <th className={TH}>Territory</th>
                  <th className={TH}>Multiplier</th>
                  <th className={TH}>Current</th>
                  <th className={TH}>Suggested</th>
                  <th className={TH}>Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = deltaPct(r);
                  const err = rowErrors[r.territory];
                  return (
                    <tr
                      key={r.territory}
                      className={`border-t border-[#f3f4f6] dark:border-[#2a2f3d] ${
                        r.changed ? "" : "opacity-50"
                      } ${err ? "bg-red-50/60 dark:bg-red-900/10" : ""}`}
                    >
                      <td className={TD}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.territory)}
                          onChange={() => toggleRow(r.territory)}
                          disabled={!r.changed || applying}
                        />
                      </td>
                      <td className={`${TD} font-mono font-medium ${textPrimary}`}>
                        <span className="flex items-center gap-1.5">
                          {territoryFlagSrc(r.territory) != null && (
                            <img
                              src={territoryFlagSrc(r.territory)!}
                              alt=""
                              width={20}
                              height={15}
                              className="h-[14px] w-[19px] object-contain shrink-0 rounded-xs"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                          {r.territory}
                        </span>
                      </td>
                      <td className={`${TD} ${textSecondary} tabular-nums`}>×{r.multiplier.toFixed(2)}</td>
                      <td className={`${TD} ${textSecondary} tabular-nums`}>
                        {r.currentPrice != null ? `${r.currency ?? ""} ${fmtPrice(r.currentPrice)}` : "—"}
                      </td>
                      <td className={`${TD} font-semibold ${textPrimary} tabular-nums`}>
                        {r.suggestedPrice != null ? `${r.currency ?? ""} ${fmtPrice(r.suggestedPrice)}` : "—"}
                      </td>
                      <td className={`${TD} tabular-nums`}>
                        {err ? (
                          <span className="text-[11px] text-red-600 dark:text-red-400" title={err}>
                            Failed
                          </span>
                        ) : !r.changed ? (
                          <span className={textMuted}>unchanged</span>
                        ) : pct == null ? (
                          <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">new</span>
                        ) : (
                          <span
                            className={`text-[11px] font-semibold ${
                              pct > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {pct > 0 ? "+" : ""}
                            {pct.toFixed(0)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className={`border-t ${borderDefault} px-5 py-3 flex items-center justify-between gap-3`}>
          {kind === "subscription" ? (
            <label className={`flex items-center gap-2 text-[12px] ${textSecondary}`}>
              <input
                type="checkbox"
                checked={preserve}
                onChange={(e) => setPreserve(e.target.checked)}
                disabled={applying}
              />
              Preserve current price for existing subscribers
            </label>
          ) : (
            <span className={`text-[11px] ${textMuted}`}>Unselected territories keep their current price.</span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={applying} className={btnSecSm}>
              Cancel
            </button>
            <button onClick={apply} disabled={applying || selectedCount === 0 || loadingRows} className={btnPrimary}>
              {applying ? <div className="spinner !w-3 !h-3" /> : <Sparkles className="w-3.5 h-3.5" />}
              Apply {selectedCount} {selectedCount === 1 ? "price" : "prices"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtPrice(v: string): string {
  if (!v.includes(".")) return v;
  return v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function deltaPct(r: SmartPriceRow): number | null {
  const current = Number(r.currentPrice);
  const suggested = Number(r.suggestedPrice);
  if (!Number.isFinite(current) || !Number.isFinite(suggested) || current === 0) return null;
  return ((suggested - current) / current) * 100;
}
