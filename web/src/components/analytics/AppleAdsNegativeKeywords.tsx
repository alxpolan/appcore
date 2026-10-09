import { useState } from "react";
import { Plus, X } from "lucide-react";
import { apiDelete, apiPost } from "../../hooks/useApi";
import type { AppleAdsNegativeKeyword } from "../../types";
import { btnSecSm, inputCls, textMuted, textPrimary } from "../../styles";

export interface NegativeDraft {
  key: number;
  text: string;
  matchType: "EXACT" | "BROAD";
}

let nextKey = 1;
export const newNegativeDraft = (): NegativeDraft => ({ key: nextKey++, text: "", matchType: "EXACT" });

const matchLabel = (m: string) => (m === "BROAD" ? "Broad" : "Exact");

/** Draft editor for the campaign-creation form: rows without IDs. */
export function NegativeKeywordDraftEditor({
  items,
  onChange,
}: {
  items: NegativeDraft[];
  onChange: (items: NegativeDraft[]) => void;
}) {
  return (
    <div>
      {items.length > 0 && (
        <div className="space-y-2 mb-2">
          {items.map((k) => (
            <div key={k.key} className="grid grid-cols-[1fr_110px_28px] gap-2 items-center">
              <input
                className={inputCls}
                value={k.text}
                onChange={(e) =>
                  onChange(items.map((x) => (x.key === k.key ? { ...x, text: e.target.value } : x)))
                }
                placeholder="free"
              />
              <select
                className={inputCls}
                value={k.matchType}
                onChange={(e) =>
                  onChange(
                    items.map((x) =>
                      x.key === k.key ? { ...x, matchType: e.target.value as "EXACT" | "BROAD" } : x,
                    ),
                  )
                }
              >
                <option value="EXACT">Exact</option>
                <option value="BROAD">Broad</option>
              </select>
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x.key !== k.key))}
                aria-label="Remove negative keyword"
                className={`w-7 h-7 flex items-center justify-center rounded-lg ${textMuted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...items, newNegativeDraft()])} className={btnSecSm}>
        <Plus className="w-3.5 h-3.5" /> Negative keyword
      </button>
    </div>
  );
}

/** Manager for an existing campaign or ad group: lists stored negatives with
 * delete buttons plus an add row. Writes go straight to the API. */
export function NegativeKeywordManager({
  campaignId,
  adGroupId,
  negatives,
  canEdit,
  onChanged,
}: {
  campaignId: string;
  adGroupId: string | null;
  negatives: AppleAdsNegativeKeyword[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [matchType, setMatchType] = useState<"EXACT" | "BROAD">("EXACT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = `/apple-ads/campaigns/${campaignId}/negatives`;

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(path, { adGroupId, keywords: [{ text: text.trim(), matchType }] });
      setText("");
      onChanged();
    } catch (err: any) {
      setError(err.message ?? "Failed to add the negative keyword.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(path, { adGroupId, ids: [id] });
      onChanged();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete the negative keyword.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {negatives.length === 0 ? (
        <div className={`text-[12px] ${textMuted} mb-2`}>No negative keywords yet.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {negatives.map((n) => (
            <span
              key={n.id}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg text-[12px] font-medium bg-[#f3f4f6] dark:bg-[#252b38] ${textPrimary}`}
            >
              {n.text}
              <span className={`font-normal ${textMuted}`}>{matchLabel(n.matchType)}</span>
              {canEdit && (
                <button
                  onClick={() => remove(n.id)}
                  disabled={busy}
                  aria-label={`Remove ${n.text}`}
                  className={`w-5 h-5 flex items-center justify-center rounded-md ${textMuted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="grid grid-cols-[1fr_110px_auto] gap-2 items-center max-w-xl">
          <input
            className={inputCls}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add negative keyword…"
          />
          <select
            className={inputCls}
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as "EXACT" | "BROAD")}
          >
            <option value="EXACT">Exact</option>
            <option value="BROAD">Broad</option>
          </select>
          <button onClick={add} disabled={busy || !text.trim()} className={btnSecSm}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-[12px] font-medium text-red-500">{error}</div>}
    </div>
  );
}
