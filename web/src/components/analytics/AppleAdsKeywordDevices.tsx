import { useEffect, useState } from "react";
import { Smartphone, Tablet } from "lucide-react";
import { apiGet } from "../../hooks/useApi";
import type { AppleAdsDeviceBreakdownResponse, AppleAdsDeviceStats } from "../../types";
import { TD, TH, textMuted, textPrimary } from "../../styles";
import { fmtNumber, fmtPct, rateTrafficColor } from "../../utils/formatters";

const DEVICE_STAT_HEADERS = ["Spend", "Impressions", "Taps", "TTR", "Installs", "Avg CPT", "Avg CPA", "Conv. Rate"];

function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function DeviceStatCells({ stats, currency }: { stats: AppleAdsDeviceStats; currency: string | null }) {
  const ttrColor = rateTrafficColor(stats.ttr);

  return (
    <>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(stats.spend, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.impressions)}</td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.taps)}</td>
      <td
        className={`${TD} text-right tabular-nums ${ttrColor ? "font-semibold" : textMuted}`}
        style={ttrColor ? { color: ttrColor } : undefined}
      >
        {stats.ttr != null ? fmtPct(stats.ttr * 100) : "—"}
      </td>
      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(stats.installs)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.avgCpt, currency)}</td>
      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtMoney(stats.avgCpa, currency)}</td>
      <td className={`${TD} text-right pr-5 tabular-nums ${textMuted}`}>
        {stats.conversionRate != null ? fmtPct(stats.conversionRate * 100) : "—"}
      </td>
    </>
  );
}

function DeviceStatsTable({ devices, currency }: { devices: AppleAdsDeviceStats[]; currency: string | null }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>
          <th className={TH}>Device</th>
          {DEVICE_STAT_HEADERS.map((h) => (
            <th key={h} className={`${TH} text-right ${h === "Conv. Rate" ? "pr-5" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <tr key={d.deviceClass}>
            <td className={TD}>
              <span className={`inline-flex items-center gap-1.5 font-medium ${textPrimary}`}>
                {d.deviceClass === "iPad" ? (
                  <Tablet className={`w-3.5 h-3.5 ${textMuted}`} />
                ) : (
                  <Smartphone className={`w-3.5 h-3.5 ${textMuted}`} />
                )}
                {d.deviceClass}
              </span>
            </td>
            <DeviceStatCells stats={d} currency={currency} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeywordDevices({
  campaignId,
  adGroupId,
  keywordId,
  currency,
  query,
}: {
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  currency: string | null;
  query: string;
}) {
  const [data, setData] = useState<AppleAdsDeviceBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    setLoading(true);
    setError(null);
    apiGet<AppleAdsDeviceBreakdownResponse>(
      `/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/keywords/${keywordId}/devices${query}`,
    )
      .then((d) => {
        if (!live) return;

        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;

        setError(e.message);
        setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [campaignId, adGroupId, keywordId, query]);

  if (loading) return <div className={`text-[12px] ${textMuted}`}>Loading…</div>;

  if (error || !data) return <div className={`text-[12px] ${textMuted}`}>{error ?? "Failed to load device data"}</div>;

  if (data.devices.length === 0) return <div className={`text-[12px] ${textMuted}`}>No device data for this period.</div>;

  return (
    <div className="overflow-x-auto">
      <DeviceStatsTable devices={data.devices} currency={currency} />
    </div>
  );
}
