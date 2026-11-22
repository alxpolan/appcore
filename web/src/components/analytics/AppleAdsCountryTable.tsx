import { TD, TH, textMuted, textPrimary } from "../../styles";
import { useCountryBreakdown } from "../../hooks/useCountryBreakdown";
import { countryName, fmtMoney, fmtNumber, fmtPct } from "../../utils/formatters";
import type { AppleAdsCountryBreakdownResponse, AppleAdsCountryStats } from "../../types";
import { STAT_HEADERS, StatCells } from "./AppleAdsStatCells";

export function CountryStatsTable({
  countries,
  currency,
  revenueAvailable,
}: {
  countries: AppleAdsCountryStats[];
  currency: string | null;
  revenueAvailable: boolean;
}) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr>
          <th className={TH}>Country</th>
          {STAT_HEADERS.map((h) => (
            <th key={h} className={`${TH} text-right ${h === "Conv. Rate" && !revenueAvailable ? "pr-5" : ""}`}>
              {h}
            </th>
          ))}
          {revenueAvailable && (
            <>
              <th className={`${TH} text-right`}>Trials</th>
              <th className={`${TH} text-right pr-5`}>Proceeds</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => (
          <tr key={c.countryOrRegion}>
            <td className={TD}>
              {c.countryOrRegion === "unknown" ? (
                <span className={textMuted}>Unknown</span>
              ) : (
                <>
                  <span className={`font-medium ${textPrimary}`}>{countryName(c.countryOrRegion)}</span>{" "}
                  <span className={textMuted}>{c.countryOrRegion}</span>
                </>
              )}
            </td>
            <StatCells stats={c} currency={currency} ttrTrafficLight />
            {revenueAvailable && (
              <>
                <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.trials)}</td>
                <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                  {fmtMoney(c.proceedsUsd, "USD")}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeywordCountries({
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
  const { data, loading, error } = useCountryBreakdown<AppleAdsCountryBreakdownResponse>(
    `/apple-ads/campaigns/${campaignId}/adgroups/${adGroupId}/keywords/${keywordId}/countries${query}`,
  );
  if (loading) return <div className={`text-[12px] ${textMuted}`}>Loading…</div>;
  if (error || !data) return <div className={`text-[12px] ${textMuted}`}>{error ?? "Failed to load country data"}</div>;
  if (data.countries.length === 0) return <div className={`text-[12px] ${textMuted}`}>No country data for this period.</div>;
  return (
    <div className="overflow-x-auto">
      <CountryStatsTable countries={data.countries} currency={currency} revenueAvailable={data.revenueAvailable} />
    </div>
  );
}
