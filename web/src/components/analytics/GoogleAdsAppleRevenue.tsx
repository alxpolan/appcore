import { useState } from "react";
import { apiDelete, apiPatch, useApi } from "../../hooks/useApi";
import type { AppItem, GoogleAdsAppleRevenueCountriesResponse, GoogleAdsAppleRevenueResponse } from "../../types";
import { borderDefault, btnSecSm, inputCls, textMuted, textPrimary } from "../../styles";
import { countryName, fmtNumber } from "../../utils/formatters";

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function GoogleAdsAppleRevenue({
  campaignId,
  query,
  rangeDeps,
  canManageTeam,
}: {
  campaignId: string;
  query: string;
  rangeDeps: unknown[];
  canManageTeam: boolean;
}) {
  const { data, loading, error, refetch } = useApi<GoogleAdsAppleRevenueResponse>(
    `/google-ads/campaigns/${campaignId}/apple-revenue${query}`,
    [campaignId, ...rangeDeps],
    true,
  );
  const { data: countriesData } = useApi<GoogleAdsAppleRevenueCountriesResponse>(
    `/google-ads/campaigns/${campaignId}/apple-revenue/countries${query}`,
    [campaignId, ...rangeDeps],
    true,
  );
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

  const totals = data?.totals;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mb-5`}
    >
      <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
        <div>
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Apple Revenue</div>
          <div className={`text-[12px] ${textMuted} mt-0.5`}>
            Downloads, trials and proceeds measured by Apple for the linked campaign token
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
        {loading ? (
          <div className={`text-[13px] ${textMuted}`}>Loading…</div>
        ) : error || !data ? (
          <div className={`text-[13px] ${textMuted}`}>{error ?? "Failed to load Apple revenue"}</div>
        ) : editing || !data.mapped ? (
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
                  {data.mapped && (
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
          <div>
            <div className={`text-[12px] ${textMuted} mb-3`}>
              {data.app?.displayName ?? data.app?.name} · token <span className="font-mono">{data.ctToken}</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Downloads", value: fmtNumber(totals?.downloads ?? 0) },
                { label: "Trials", value: fmtNumber(totals?.trials ?? 0) },
                { label: "Purchases", value: fmtNumber(totals?.purchases ?? 0) },
                { label: "Proceeds", value: fmtMoney(totals?.proceedsUsd ?? 0) },
              ].map((s) => (
                <div
                  key={s.label}
                  className={`bg-[#fafbfc] dark:bg-[#14171e] border ${borderDefault} rounded-xl p-4`}
                >
                  <div className={`text-[11px] ${textMuted} mb-1.5`}>{s.label}</div>
                  <div className={`text-[20px] font-bold leading-none truncate ${textPrimary}`} title={s.value}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
            <div className={`text-[11px] ${textMuted} mt-3`}>
              Apple reports campaign data with a delay of a few days; metrics below 5 are withheld for privacy.
            </div>
            {countriesData?.mapped && countriesData.countries.length > 0 && (
              <div className="mt-4">
                <div className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted} mb-2`}>By country</div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr>
                      <th className={`text-left pb-1.5 font-medium ${textMuted}`}>Country</th>
                      <th className={`text-right pb-1.5 font-medium ${textMuted}`}>Downloads</th>
                      <th className={`text-right pb-1.5 font-medium ${textMuted}`}>Trials</th>
                      <th className={`text-right pb-1.5 font-medium ${textMuted}`}>Purchases</th>
                      <th className={`text-right pb-1.5 font-medium ${textMuted}`}>Proceeds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countriesData.countries.map((c) => (
                      <tr key={c.territory} className="border-t border-[#f3f4f6] dark:border-[#2a2f3d]">
                        <td className={`py-1.5 ${textPrimary}`}>
                          {c.territory === "ZZ" ? "Unknown (pre-tracking)" : countryName(c.territory)}{" "}
                          <span className={textMuted}>{c.territory !== "ZZ" && c.territory}</span>
                        </td>
                        <td className={`py-1.5 text-right ${textPrimary}`}>{fmtNumber(c.downloads)}</td>
                        <td className={`py-1.5 text-right ${textPrimary}`}>{fmtNumber(c.trials)}</td>
                        <td className={`py-1.5 text-right ${textPrimary}`}>{fmtNumber(c.purchases)}</td>
                        <td className={`py-1.5 text-right ${textPrimary}`}>{fmtMoney(c.proceedsUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {saveError && <div className="mt-2 text-[12px] font-medium text-red-500">{saveError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
