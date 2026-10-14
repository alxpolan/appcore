import { useState } from "react";
import { apiDelete, apiPatch, useApi } from "../../hooks/useApi";
import type { AppItem, GoogleAdsAppleRevenueResponse } from "../../types";
import { borderDefault, btnSecSm, inputCls, textMuted, textPrimary } from "../../styles";

export default function GoogleAdsAppleMapping({
  campaignId,
  canManageTeam,
  data,
  refetch,
}: {
  campaignId: string;
  canManageTeam: boolean;
  data: GoogleAdsAppleRevenueResponse | null;
  refetch: () => void;
}) {
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const [editing, setEditing] = useState(false);
  const [appId, setAppId] = useState("");
  const [ctToken, setCtToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditing = () => {
    setAppId(data?.app?.id ?? apps?.[0]?.id ?? "");
    setCtToken(data?.ctToken ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!appId || !ctToken.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiPatch(`/google-ads/campaigns/${campaignId}/apple-mapping`, { appId, ctToken: ctToken.trim() });
      setEditing(false);
      refetch();
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to save the mapping.");
    } finally {
      setSaving(false);
    }
  };

  const unlink = async () => {
    if (!confirm("Remove the Apple campaign token link?") || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiDelete(`/google-ads/campaigns/${campaignId}/apple-mapping`);
      refetch();
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to remove the mapping.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
        <div>
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Apple Campaign Link</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Links this Google campaign to its App Store campaign token for installs, trials and proceeds
          </div>
        </div>
        {data?.mapped && canManageTeam && !editing && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={startEditing} className={btnSecSm}>
              Change
            </button>
            <button onClick={unlink} disabled={saving} className={btnSecSm}>
              Unlink
            </button>
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        {editing || !data?.mapped ? (
          <div>
            <p className={`text-[13px] ${textMuted} mb-3 max-w-2xl`}>
              Create a campaign link in App Store Connect (Analytics → Campaigns), use it as this Google
              campaign's final URL, then link its token here. Apple attributes downloads and purchases to the
              token.
            </p>
            {canManageTeam ? (
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center max-w-2xl">
                <select className={inputCls} value={appId} onChange={(e) => setAppId(e.target.value)}>
                  <option value="">Select app…</option>
                  {(apps ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName ?? a.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputCls}
                  value={ctToken}
                  onChange={(e) => setCtToken(e.target.value)}
                  placeholder="Campaign token (ct)…"
                />
                <div className="flex items-center gap-2">
                  <button onClick={save} disabled={saving || !appId || !ctToken.trim()} className={btnSecSm}>
                    Save
                  </button>
                  {data?.mapped && (
                    <button onClick={() => setEditing(false)} disabled={saving} className={btnSecSm}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={`text-[13px] ${textMuted}`}>No campaign token linked yet.</div>
            )}
            {saveError && <div className="mt-2 text-[12px] font-medium text-red-500">{saveError}</div>}
          </div>
        ) : (
          <div className={`text-[13px] ${textPrimary}`}>
            {data.app?.displayName ?? data.app?.name} · token <span className="font-mono">{data.ctToken}</span>
          </div>
        )}
      </div>
    </div>
  );
}
