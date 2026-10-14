/** Pure model behind the Apple Ads profitability calculator. Dependency-free so it can be unit-tested. */

export interface ProfitDrivers {
  taps: number;
  cpt: number;
  convRate: number;
  trialRate: number;
  trialConvRate: number;
  /** Fixed calibration (not an editable driver): realized proceeds per converted trial. */
  proceedsPerConverted: number;
  /** Fixed calibration (not an editable driver): proceeds not attributed to trials. */
  directBase: number;
}

export interface ProfitOutcome {
  spend: number;
  installs: number;
  trials: number;
  converted: number;
  proceeds: number;
  profit: number;
  roas: number | null;
  cpa: number | null;
}

export function economics(d: ProfitDrivers): ProfitOutcome {
  const spend = d.taps * d.cpt;
  const installs = d.taps * d.convRate;
  const trials = installs * d.trialRate;
  const converted = trials * d.trialConvRate;
  const proceeds = d.directBase + converted * d.proceedsPerConverted;
  return {
    spend,
    installs,
    trials,
    converted,
    proceeds,
    profit: proceeds - spend,
    roas: spend > 0 ? proceeds / spend : null,
    cpa: installs > 0 ? spend / installs : null,
  };
}

export function parseNum(raw: string): number {
  const v = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

/** Multiplies a scenario input by a factor (e.g. ±10% steppers), keeping `decimals` places. Empty or
 * invalid input falls back to `fallback` (the current value) instead of zeroing out. */
export function applyBump(raw: string, fallback: string, factor: number, decimals: number): string {
  const parsed = Number.parseFloat(raw.replace(",", "."));
  const base = raw.trim() !== "" && Number.isFinite(parsed) ? parsed : parseNum(fallback);
  return (base * factor).toFixed(decimals);
}
