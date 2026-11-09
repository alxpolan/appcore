import type { AppleAdsCampaignRevenue, AppleAdsDailySpendResponse } from "../../types";
import { textMuted } from "../../styles";
import { fmtNumber } from "../../utils/formatters";
import { FUNNEL_METRICS, funnelMetricsForDay } from "../../utils/appleAdsChartMetrics";
import { PerformanceCard, type AxisGroupDef, type MetricDef } from "./PerformanceCard";

type ChartDay = {
  date: string;
  spend: number;
  proceeds: number;
  trialPotential: number;
  trials: number;
  unpricedTrials: number;
  impressions: number;
  taps: number;
  installs: number;
  ttr: number;
  cpt: number;
  cpa: number;
  convRate: number;
};

function axisMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const AXIS_GROUPS: AxisGroupDef[] = [
  { id: "money", orientation: "left", width: 32, tickFormatter: axisMoney, alwaysVisible: true },
  { id: "count", orientation: "right", width: 40, tickFormatter: axisMoney },
  { id: "unit", orientation: "right", width: 40, tickFormatter: axisMoney },
  { id: "percent", orientation: "right", width: 0, alwaysVisible: true },
];

export default function AppleAdsCampaignChart({
  spendDays,
  startDate,
  endDate,
  revenue,
  currency,
  loading,
  error,
  revenueError,
  campaignId,
}: {
  spendDays?: AppleAdsDailySpendResponse["days"];
  startDate?: string;
  endDate?: string;
  revenue?: AppleAdsCampaignRevenue["byCampaign"][string];
  currency: string;
  loading: boolean;
  error: boolean;
  revenueError: boolean;
  campaignId?: string;
}) {
  const fallbackEnd = new Date();
  fallbackEnd.setUTCHours(0, 0, 0, 0);
  const fallbackStart = new Date(fallbackEnd);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 29);
  const rangeStart = startDate ?? fallbackStart.toISOString().slice(0, 10);
  const rangeEnd = endDate ?? fallbackEnd.toISOString().slice(0, 10);
  const byDay = new Map<string, ChartDay>();
  for (
    let cursor = new Date(`${rangeStart}T00:00:00Z`);
    cursor <= new Date(`${rangeEnd}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const key = cursor.toISOString().slice(0, 10);
    byDay.set(key, {
      date: key,
      spend: 0,
      proceeds: 0,
      trialPotential: 0,
      trials: 0,
      unpricedTrials: 0,
      impressions: 0,
      taps: 0,
      installs: 0,
      ttr: 0,
      cpt: 0,
      cpa: 0,
      convRate: 0,
    });
  }
  for (const day of spendDays ?? []) {
    const point = byDay.get(day.date);
    if (!point) continue;
    point.spend += day.spend;
    point.impressions += day.impressions;
    point.taps += day.taps;
    point.installs += day.installs;
  }
  for (const transaction of revenue?.transactions ?? []) {
    const point = byDay.get((transaction.cohortDate ?? transaction.date).slice(0, 10));
    if (!point) continue;
    if (transaction.isTrial && !transaction.isConvertedTrial) {
      point.trials++;
      if (transaction.potentialProceedsUsd > 0) point.trialPotential += transaction.potentialProceedsUsd;
      else point.unpricedTrials++;
    }
    point.proceeds += transaction.proceedsUsd;
  }

  for (const point of byDay.values()) {
    Object.assign(point, funnelMetricsForDay(point));
  }

  const days = [...byDay.values()];
  const openEnd = days.length >= 2 && rangeEnd >= new Date().toISOString().slice(0, 10);
  const unpricedTotal = days.reduce((sum, day) => sum + day.unpricedTrials, 0);
  const trialsTotal = days.reduce((sum, day) => sum + day.trials, 0);
  const lastAppleDate = days.reduce(
    (last, day) => (day.spend > 0 || day.impressions > 0 || day.taps > 0 || day.installs > 0 ? day.date : last),
    "",
  );
  const showGapNote = lastAppleDate < rangeEnd;

  const metrics: MetricDef[] = [
    { key: "spend", label: "Spend", color: "#6366f1", render: "line", axis: "money", format: "money" },
    {
      key: "proceeds",
      label: "Proceeds",
      color: "#10b981",
      render: "bar",
      axis: "money",
      format: "money",
      usd: true,
      stackId: "revenue",
      disabled: revenueError,
      disabledTitle: "RevenueCat data unavailable",
    },
    {
      key: "trialPotential",
      label: "Trial potential",
      color: "#f59e0b",
      render: "bar",
      axis: "money",
      format: "money",
      usd: true,
      stackId: "revenue",
      disabled: revenueError,
      disabledTitle: "RevenueCat data unavailable",
    },
    ...FUNNEL_METRICS.map(
      (metric): MetricDef => ({
        key: metric.key,
        label: metric.label,
        color: metric.color,
        render: "line",
        axis:
          metric.key === "cpt" || metric.key === "cpa"
            ? "unit"
            : metric.format === "percent"
              ? "percent"
              : metric.format === "money"
                ? "money"
                : "count",
        format: metric.format,
        defaultActive: false,
      }),
    ),
  ];

  return (
    <PerformanceCard
      title="Campaign performance"
      storageKey={`appleAds.annotations.${campaignId ?? "default"}`}
      currency={currency}
      loading={loading}
      error={error}
      errorMessage="Failed to load daily spend"
      metrics={metrics}
      axisGroups={AXIS_GROUPS}
      chartData={days}
      openEnd={openEnd}
      footerLeft="Totals (left) · Counts & unit costs (right)"
      footerRight="TTR & Conv. rate in %"
      notes={(active) => (
        <>
          {revenueError && <div className={`text-[12px] ${textMuted} mb-2`}>RevenueCat data unavailable</div>}
          {active.has("trialPotential") && !revenueError && unpricedTotal > 0 && (
            <div className={`text-[12px] ${textMuted} mb-2`}>
              {fmtNumber(unpricedTotal)} of {fmtNumber(trialsTotal)} trials have no paid reference yet and aren&apos;t
              valued
            </div>
          )}
          {showGapNote && (
            <div className={`text-[12px] ${textMuted} mb-2`}>
              {lastAppleDate === ""
                ? "No Apple activity reported in this range."
                : `No Apple activity reported after ${lastAppleDate}.`}
            </div>
          )}
        </>
      )}
    />
  );
}
