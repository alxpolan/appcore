export type FunnelMetricKey = "impressions" | "taps" | "installs" | "ttr" | "cpt" | "cpa" | "convRate";

export type FunnelMetricFormat = "count" | "percent" | "money";

export interface FunnelMetricDef {
  key: FunnelMetricKey;
  label: string;
  hint: string;
  format: FunnelMetricFormat;
  color: string;
}

export const FUNNEL_METRICS: FunnelMetricDef[] = [
  { key: "impressions", label: "Impressions", hint: "Ad views per day", format: "count", color: "#0ea5e9" },
  { key: "taps", label: "Taps", hint: "Ad taps per day", format: "count", color: "#6366f1" },
  { key: "installs", label: "Installs", hint: "Attributed installs per day", format: "count", color: "#10b981" },
  { key: "ttr", label: "TTR", hint: "Taps / Impressions", format: "percent", color: "#8b5cf6" },
  { key: "cpt", label: "CPT", hint: "Spend / Taps", format: "money", color: "#14b8a6" },
  { key: "cpa", label: "CPA", hint: "Spend / Installs", format: "money", color: "#f43f5e" },
  { key: "convRate", label: "Conv. rate", hint: "Installs / Taps", format: "percent", color: "#D94412" },
];

export interface FunnelMetricInput {
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
}

export function funnelMetricsForDay(day: FunnelMetricInput): Record<FunnelMetricKey, number> {
  const ttr = day.impressions > 0 ? (day.taps / day.impressions) * 100 : 0;
  const cpt = day.taps > 0 ? day.spend / day.taps : 0;
  const cpa = day.installs > 0 ? day.spend / day.installs : 0;
  const convRate = day.taps > 0 ? (day.installs / day.taps) * 100 : 0;

  return {
    impressions: day.impressions,
    taps: day.taps,
    installs: day.installs,
    ttr,
    cpt,
    cpa,
    convRate,
  };
}
