import { TD, textMuted, textPrimary } from "../../styles";
import { fmtMoney, fmtNumber, fmtPct, rateTrafficColor } from "../../utils/formatters";
import type { AppleAdsStats } from "../../types";

export const STAT_HEADERS = ["Spend", "Impressions", "Taps", "TTR", "Installs", "Avg CPT", "Avg CPA", "Conv. Rate"];

export function StatCells({
  stats,
  currency,
  ttrTrafficLight,
}: {
  stats: AppleAdsStats;
  currency: string | null;
  ttrTrafficLight?: boolean;
}) {
  const ttrColor = ttrTrafficLight ? rateTrafficColor(stats.ttr) : undefined;

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
