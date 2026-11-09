import { useMemo } from "react";
import { fmtLargeNum } from "../../utils/formatters";
import { PerformanceCard, type AxisGroupDef, type MetricDef } from "./PerformanceCard";

export interface PerformanceDayInput {
  date: string;
  spend: number;
  impressions: number;
  actions: number;
  installs: number;
}

const AXIS_GROUPS: AxisGroupDef[] = [
  { id: "count", orientation: "left", width: 40, tickFormatter: fmtLargeNum, alwaysVisible: true },
  { id: "money", orientation: "right", width: 40, tickFormatter: fmtLargeNum },
  { id: "percent", orientation: "right", width: 0, alwaysVisible: true },
];

export default function AdsOverviewChart({
  days,
  startDate,
  endDate,
  currency,
  loading,
  actionLabel,
  rateLabel,
  storageKey,
}: {
  days: PerformanceDayInput[];
  startDate?: string;
  endDate?: string;
  currency: string;
  loading: boolean;
  actionLabel: string;
  rateLabel: string;
  storageKey: string;
}) {
  const metrics: MetricDef[] = useMemo(
    () => [
      { key: "spend", label: "Spend", color: "#f59e0b", render: "line", axis: "money", format: "money" },
      {
        key: "impressions",
        label: "Impressions",
        color: "#0ea5e9",
        render: "line",
        axis: "count",
        format: "count",
        defaultActive: false,
      },
      { key: "actions", label: actionLabel, color: "#6366f1", render: "line", axis: "count", format: "count" },
      { key: "installs", label: "Installs", color: "#10b981", render: "line", axis: "count", format: "count" },
      {
        key: "rate",
        label: rateLabel,
        color: "#8b5cf6",
        render: "line",
        axis: "percent",
        format: "percent",
        defaultActive: false,
      },
      {
        key: "conversionRate",
        label: "Conv. Rate",
        color: "#D94412",
        render: "line",
        axis: "percent",
        format: "percent",
        defaultActive: false,
      },
    ],
    [actionLabel, rateLabel],
  );

  const chartData = useMemo(() => {
    if (!startDate || !endDate) return days;
    const byDate = new Map(days.map((d) => [d.date, d]));
    const points: {
      date: string;
      spend: number;
      impressions: number;
      actions: number;
      installs: number;
      rate: number;
      conversionRate: number;
    }[] = [];

    for (
      let cursor = new Date(`${startDate}T00:00:00Z`);
      cursor <= new Date(`${endDate}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      const d = byDate.get(key);
      const impressions = d?.impressions ?? 0;
      const actions = d?.actions ?? 0;
      const installs = d?.installs ?? 0;

      points.push({
        date: key,
        spend: d?.spend ?? 0,
        impressions,
        actions,
        installs,
        rate: impressions > 0 ? (actions / impressions) * 100 : 0,
        conversionRate: actions > 0 ? (installs / actions) * 100 : 0,
      });
    }

    return points;
  }, [days, startDate, endDate]);

  const openEnd = chartData.length >= 2 && (endDate ?? "") >= new Date().toISOString().slice(0, 10);

  return (
    <PerformanceCard
      title="Performance over time"
      storageKey={storageKey}
      currency={currency}
      loading={loading}
      isEmpty={days.length === 0}
      metrics={metrics}
      axisGroups={AXIS_GROUPS}
      chartData={chartData}
      openEnd={openEnd}
    />
  );
}
