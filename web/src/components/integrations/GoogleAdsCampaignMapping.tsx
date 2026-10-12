import { useEffect, useState } from "react";
import { apiDelete, apiPatch, clearApiCache, useApi } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type { AppItem, GoogleAdsCampaignMappingsResponse } from "../../types";
import { TD, TH, badge, borderDefault, btnSecSm, cardCls, inputCls, textMuted, textPrimary, textSecondary } from "../../styles";

type ToastFn = (msg: string, type: "success" | "error" | "info") => void;

interface Draft {
  appId: string;
  ctToken: string;
}

function statusBadgeVariant(status: string): string {
  if (status === "ENABLED") return "active";
  if (status === "PAUSED") return "pending";
  return "created";
}

export default function GoogleAdsCampaignMapping({ addToast }: { addToast: ToastFn }) {
  const { data, loading, error, refetch } = useApi<GoogleAdsCampaignMappingsResponse>(
    "/google-ads/campaign-mappings",
    [],
    true,
  );
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const { canManageTeam } = usePermissions();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const campaigns = data?.campaigns ?? [];

  useEffect(() => {
    if (!data) return;
    setDrafts((prev) => {
      const next: Record<string, Draft> = { ...prev };
      for (const c of data.campaigns) {
        if (!next[c.id]) {
          next[c.id] = { appId: c.mapping?.appId ?? "", ctToken: c.mapping?.ctToken ?? "" };
        }
      }
      return next;
    });
  }, [data]);

  const draftFor = (campaignId: string, fallback?: { appId: string; ctToken: string } | null): Draft =>
    drafts[campaignId] ?? { appId: fallback?.appId ?? "", ctToken: fallback?.ctToken ?? "" };

  const save = async (campaignId: string, campaignName: string) => {
    const draft = draftFor(campaignId);
    if (!draft.appId || !draft.ctToken.trim() || savingId) return;
    setSavingId(campaignId);
    try {
      await apiPatch(`/google-ads/campaigns/${campaignId}/apple-mapping`, {
        appId: draft.appId,
        ctToken: draft.ctToken.trim(),
      });
      addToast(`Campaign "${campaignName}" assigned`, "success");
      clearApiCache();
      refetch();
    } catch (err: any) {
      addToast(err.message ?? "Failed to save the mapping", "error");
    } finally {
      setSavingId(null);
    }
  };

  const unlink = async (campaignId: string, campaignName: string) => {
    if (!confirm(`Remove the app and token assignment for "${campaignName}"?`) || savingId) return;
    setSavingId(campaignId);
    try {
      await apiDelete(`/google-ads/campaigns/${campaignId}/apple-mapping`);
      addToast(`Campaign "${campaignName}" unassigned`, "success");
      setDrafts((prev) => ({ ...prev, [campaignId]: { appId: "", ctToken: "" } }));
      clearApiCache();
      refetch();
    } catch (err: any) {
      addToast(err.message ?? "Failed to remove the mapping", "error");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className={`${cardCls} mt-4 !p-0 overflow-hidden`}>
      <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
        <div className={`text-[15px] font-semibold ${textPrimary}`}>Google Ads campaigns</div>
        <div className={`text-[12px] ${textMuted} mt-0.5 max-w-3xl`}>
          Assign each campaign to the app it advertises and link the App Store campaign token (ct).
          Create the campaign link in App Store Connect (Analytics → Campaigns) and use it as the
          campaign's final URL — Apple then attributes downloads and purchases to the token.
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-5 py-8">
          <div className="spinner" />
          <span className={`text-[13px] ${textSecondary}`}>Loading campaigns…</span>
        </div>
      ) : error || !data ? (
        <div className={`px-5 py-8 text-[13px] ${textMuted}`}>{error ?? "Failed to load campaigns"}</div>
      ) : campaigns.length === 0 ? (
        <div className={`px-5 py-8 text-[13px] ${textMuted}`}>
          No Google Ads campaigns found in this customer account.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={TH}>Campaign</th>
                <th className={TH}>Status</th>
                <th className={TH}>App</th>
                <th className={TH}>Campaign token (ct)</th>
                <th className={`${TH} text-right`}>{canManageTeam ? "Actions" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const draft = draftFor(c.id, c.mapping);
                const dirty =
                  draft.appId !== (c.mapping?.appId ?? "") || draft.ctToken !== (c.mapping?.ctToken ?? "");
                const valid = draft.appId !== "" && draft.ctToken.trim() !== "";
                const busy = savingId === c.id;
                return (
                  <tr key={c.id} className="align-middle">
                    <td className={`${TD} max-w-[260px]`}>
                      <div className={`text-[13px] font-medium truncate ${textPrimary}`} title={c.name}>
                        {c.name}
                      </div>
                      <div className={`text-[11px] font-mono ${textMuted}`}>{c.id}</div>
                    </td>
                    <td className={TD}>
                      <span className={badge(statusBadgeVariant(c.status))}>{c.status}</span>
                    </td>
                    <td className={`${TD} min-w-[190px]`}>
                      {canManageTeam ? (
                        <select
                          className={`${inputCls} !py-[7px] !text-[12px]`}
                          value={draft.appId}
                          disabled={busy}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draftFor(c.id, c.mapping), appId: e.target.value },
                            }))
                          }
                        >
                          <option value="">Select app…</option>
                          {(apps ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.displayName ?? a.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-[13px] ${textSecondary}`}>
                          {c.mapping ? c.mapping.appName : <span className={textMuted}>—</span>}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} min-w-[190px]`}>
                      {canManageTeam ? (
                        <input
                          className={`${inputCls} !py-[7px] !text-[12px] font-mono`}
                          value={draft.ctToken}
                          disabled={busy}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draftFor(c.id, c.mapping), ctToken: e.target.value },
                            }))
                          }
                          placeholder="ct token…"
                        />
                      ) : c.mapping ? (
                        <span className={`text-[12px] font-mono ${textSecondary}`}>{c.mapping.ctToken}</span>
                      ) : (
                        <span className={`text-[13px] ${textMuted}`}>—</span>
                      )}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {canManageTeam && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => save(c.id, c.name)}
                            disabled={busy || !dirty || !valid}
                            className={btnSecSm}
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                          {c.mapping && (
                            <button onClick={() => unlink(c.id, c.name)} disabled={busy} className={btnSecSm}>
                              Unlink
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className={`px-5 py-3 border-t ${borderDefault} text-[11px] ${textMuted}`}>
        Apple reports campaign data with a delay of a few days; metrics below 5 are withheld for privacy.
      </div>
    </div>
  );
}
