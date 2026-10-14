import { useEffect, useMemo, useState } from "react";
import { Calculator, RotateCcw } from "lucide-react";
import { borderDefault, btnSecSm, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber } from "../../utils/formatters";
import { applyBump, economics, parseNum, type ProfitDrivers } from "../../utils/profitModel";
import type { GoogleAdsCampaign } from "../../types";

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function toInputs(d: ProfitDrivers): Record<keyof ProfitDrivers, string> {
  return {
    taps: String(Math.round(d.taps)),
    cpt: d.cpt.toFixed(2),
    convRate: (d.convRate * 100).toFixed(2),
    trialRate: (d.trialRate * 100).toFixed(2),
    trialConvRate: (d.trialConvRate * 100).toFixed(2),
    proceedsPerConverted: d.proceedsPerConverted.toFixed(2),
    directBase: d.directBase.toFixed(2),
  };
}

const DECIMALS: Record<keyof ProfitDrivers, number> = {
  taps: 0,
  cpt: 2,
  convRate: 2,
  trialRate: 2,
  trialConvRate: 2,
  proceedsPerConverted: 2,
  directBase: 2,
};

const UNTOUCHED: Record<keyof ProfitDrivers, boolean> = {
  taps: false,
  cpt: false,
  convRate: false,
  trialRate: false,
  trialConvRate: false,
  proceedsPerConverted: false,
  directBase: false,
};

export default function GoogleAdsProfitCalculator({
  campaign,
  mapped,
  downloads,
  trialStarts,
  convertedTrials,
  proceedsPerConverted,
  loading,
}: {
  campaign: GoogleAdsCampaign | null;
  mapped: boolean;
  downloads: number;
  trialStarts: number;
  convertedTrials: number;
  proceedsPerConverted: number;
  loading: boolean;
}) {
  const currency = campaign?.currency ?? "USD";

  const current = useMemo<ProfitDrivers>(() => {
    const taps = campaign?.clicks ?? 0;
    const midUnit = mapped ? downloads : (campaign?.conversions ?? 0);
    return {
      taps,
      cpt: campaign?.avgCpc ?? (taps > 0 ? (campaign?.spend ?? 0) / taps : 0),
      convRate: taps > 0 ? midUnit / taps : 0,
      trialRate: midUnit > 0 ? trialStarts / midUnit : 0,
      trialConvRate: trialStarts > 0 ? convertedTrials / trialStarts : 0,
      proceedsPerConverted,
      directBase: 0,
    };
  }, [campaign, mapped, downloads, trialStarts, convertedTrials, proceedsPerConverted]);

  const [scenario, setScenario] = useState<Record<keyof ProfitDrivers, string>>(() => toInputs(current));
  const [touched, setTouched] = useState<Record<keyof ProfitDrivers, boolean>>(UNTOUCHED);
  const signature = JSON.stringify(current);
  useEffect(() => {
    setScenario(toInputs(current));
    setTouched(UNTOUCHED);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (loading) {
    return (
      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      >
        <div className={`flex items-center justify-center h-24 text-[13px] ${textMuted}`}>Loading calculator…</div>
      </div>
    );
  }
  if (!campaign) return null;

  // Untouched fields compute with the exact current value (inputs show rounded
  // values, which would otherwise cause phantom deltas on load).
  const s: ProfitDrivers = {
    taps: touched.taps ? Math.max(0, parseNum(scenario.taps)) : current.taps,
    cpt: touched.cpt ? Math.max(0, parseNum(scenario.cpt)) : current.cpt,
    convRate: touched.convRate ? Math.max(0, parseNum(scenario.convRate) / 100) : current.convRate,
    trialRate: touched.trialRate ? Math.max(0, parseNum(scenario.trialRate) / 100) : current.trialRate,
    trialConvRate: touched.trialConvRate ? Math.max(0, parseNum(scenario.trialConvRate) / 100) : current.trialConvRate,
    proceedsPerConverted: touched.proceedsPerConverted
      ? Math.max(0, parseNum(scenario.proceedsPerConverted))
      : current.proceedsPerConverted,
    directBase: current.directBase,
  };
  const cur = economics(current);
  const scn = economics(s);
  const mixedCurrency = currency !== "USD";
  const midLabel = mapped ? "Downloads" : "Conversions";
  const midUnit = mapped ? downloads : campaign.conversions;

  const exactInputs: Record<keyof ProfitDrivers, string> = {
    taps: String(current.taps),
    cpt: String(current.cpt),
    convRate: String(current.convRate * 100),
    trialRate: String(current.trialRate * 100),
    trialConvRate: String(current.trialConvRate * 100),
    proceedsPerConverted: String(current.proceedsPerConverted),
    directBase: String(current.directBase),
  };
  const bump = (key: keyof ProfitDrivers, factor: number) => {
    const base = touched[key] ? scenario[key] : exactInputs[key];
    setTouched((prev) => ({ ...prev, [key]: true }));
    setScenario((prev) => ({
      ...prev,
      [key]: applyBump(base, toInputs(current)[key], factor, DECIMALS[key]),
    }));
  };

  const resetScenario = () => {
    setScenario(toInputs(current));
    setTouched(UNTOUCHED);
  };

  const inputs: { key: keyof ProfitDrivers; label: string; currentLabel: string; hint?: string }[] = [
    { key: "taps", label: "Clicks", currentLabel: fmtNumber(current.taps) },
    { key: "cpt", label: `Avg CPC (${currency})`, currentLabel: money(current.cpt, currency) },
    {
      key: "convRate",
      label: "Conv. rate",
      currentLabel: pct(current.convRate),
      hint: `${fmtNumber(midUnit)} ${midLabel.toLowerCase()}`,
    },
    {
      key: "trialRate",
      label: "Trial rate",
      currentLabel: pct(current.trialRate),
      hint: `${fmtNumber(trialStarts)} trials`,
    },
    {
      key: "trialConvRate",
      label: "Trial conversion",
      currentLabel: pct(current.trialConvRate),
      hint: `${fmtNumber(convertedTrials)} converted`,
    },
    {
      key: "proceedsPerConverted",
      label: "Ø proceeds / conv. trial (USD)",
      currentLabel: money(current.proceedsPerConverted, "USD"),
    },
  ];

  const outputs: {
    label: string;
    cur: number | null;
    scn: number | null;
    format: (v: number) => string;
    goodDown?: boolean;
  }[] = [
    { label: `Spend (${currency})`, cur: cur.spend, scn: scn.spend, format: (v) => money(v, currency), goodDown: true },
    { label: midLabel, cur: cur.installs, scn: scn.installs, format: (v) => fmtNumber(Math.round(v)) },
    { label: "Trial starts", cur: cur.trials, scn: scn.trials, format: (v) => fmtNumber(Math.round(v)) },
    { label: "Conv. trials", cur: cur.converted, scn: scn.converted, format: (v) => fmtNumber(Math.round(v)) },
    { label: "Proceeds (USD)", cur: cur.proceeds, scn: scn.proceeds, format: (v) => money(v, "USD") },
    {
      label: mixedCurrency ? "Profit (~USD)" : "Profit (USD)",
      cur: cur.profit,
      scn: scn.profit,
      format: (v) => (mixedCurrency ? `~${money(v, "USD")}` : money(v, "USD")),
    },
    { label: "ROAS", cur: cur.roas, scn: scn.roas, format: (v) => `${v.toFixed(2)}×` },
    {
      label: `CPA (${currency})`,
      cur: cur.cpa,
      scn: scn.cpa,
      format: (v) => money(v, currency),
      goodDown: true,
    },
  ];

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className={`flex items-center gap-2 text-[16px] font-semibold ${textPrimary}`}>
          <Calculator className={`w-4 h-4 ${textMuted}`} />
          Profitability calculator
        </div>
        <button onClick={resetScenario} className={btnSecSm} title="Reset scenario">
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>
      <div className={`text-[12px] ${textMuted} mb-4`}>Adjust the drivers to simulate scenarios — current values included for reference.</div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-6">
        <div>
          <div className={`text-[12px] font-semibold uppercase tracking-wide ${textMuted} mb-2`}>Drivers</div>
          <div className="space-y-2">
            {inputs.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <div className="w-36 shrink-0 min-w-0">
                  <div className={`text-[13px] font-medium ${textPrimary} truncate`}>{row.label}</div>
                  <div className={`text-[11px] ${textMuted} tabular-nums`}>
                    now {row.currentLabel}
                    {row.hint ? ` · ${row.hint}` : ""}
                  </div>
                </div>
                <input
                  value={scenario[row.key]}
                  onChange={(e) => {
                    setTouched((prev) => ({ ...prev, [row.key]: true }));
                    setScenario((prev) => ({ ...prev, [row.key]: e.target.value }));
                  }}
                  inputMode="decimal"
                  className={`h-8 w-full min-w-0 px-2.5 text-[13px] border ${borderDefault} rounded-lg ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2] tabular-nums`}
                />
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => bump(row.key, 0.9)}
                    title="-10%"
                    className={`h-8 px-2 text-[11px] font-semibold border ${borderDefault} rounded-lg ${textSecondary} hover:bg-[#f3f4f6] dark:hover:bg-white/10 transition-colors tabular-nums`}
                  >
                    −10%
                  </button>
                  <button
                    onClick={() => bump(row.key, 1.1)}
                    title="+10%"
                    className={`h-8 px-2 text-[11px] font-semibold border ${borderDefault} rounded-lg ${textSecondary} hover:bg-[#f3f4f6] dark:hover:bg-white/10 transition-colors tabular-nums`}
                  >
                    +10%
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!mapped && (
            <div className={`text-[11px] ${textMuted} mt-3 tabular-nums`}>
              Link a campaign token below for downloads, trials &amp; proceeds.
            </div>
          )}
        </div>

        <div>
          <div className={`text-[12px] font-semibold uppercase tracking-wide ${textMuted} mb-2`}>Outcome</div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className={`text-[11px] ${textMuted}`}>
                <th className="text-left font-medium pb-1.5 pr-2"></th>
                <th className="text-right font-medium pb-1.5 pr-2 tabular-nums">Current</th>
                <th className="text-right font-medium pb-1.5 pr-2 tabular-nums">Scenario</th>
                <th className="text-right font-medium pb-1.5 tabular-nums">Δ</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((row) => {
                const cur = row.cur;
                const scn = row.scn;
                const delta = cur != null && scn != null ? scn - cur : null;
                const rawPct = cur != null && scn != null && cur !== 0 ? ((scn - cur) / Math.abs(cur)) * 100 : null;
                const deltaPct = rawPct != null && Math.abs(rawPct) < 0.05 ? 0 : rawPct;
                const good = deltaPct == null || deltaPct === 0 ? null : row.goodDown ? deltaPct < 0 : deltaPct > 0;
                return (
                  <tr key={row.label} className={`border-t border-[#f3f4f6] dark:border-[#2a2f3d]`}>
                    <td className={`py-1.5 pr-2 font-medium ${textPrimary}`}>{row.label}</td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${textSecondary}`}>
                      {row.cur == null ? "—" : row.format(row.cur)}
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums font-semibold ${textPrimary}`}>
                      {row.scn == null ? "—" : row.format(row.scn)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        good == null
                          ? textMuted
                          : good
                            ? "text-[#10b981] dark:text-[#32e4a5]"
                            : "text-[#ef4444] dark:text-[#ff6b7a]"
                      }`}
                      title={delta == null ? undefined : `Absolute: ${row.format(Math.abs(delta))}`}
                    >
                      {deltaPct == null ? "—" : `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {mixedCurrency && (
            <div className={`text-[11px] ${textMuted} mt-2`}>
              Spend is in {currency}, proceeds in USD — profit assumes 1:1.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
