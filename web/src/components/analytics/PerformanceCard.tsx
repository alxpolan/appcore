import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { borderDefault, textMuted, textPrimary } from "../../styles";
import { fmtShortDateWithWeekday } from "../../utils/formatters";

export type MetricFormat = "money" | "count" | "percent";

export interface MetricDef {
  key: string;
  label: string;
  color: string;
  render: "line" | "bar";
  axis: string;
  format: MetricFormat;
  usd?: boolean;
  stackId?: string;
  defaultActive?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
}

export interface AxisGroupDef {
  id: string;
  orientation: "left" | "right";
  width: number;
  tickFormatter?: (value: number) => string;
  alwaysVisible?: boolean;
}

interface ChartAnnotation {
  id: string;
  date: string;
  text: string;
}

function annotationStorageKey(storageKey: string): string {
  return storageKey.startsWith("appleAds.annotations.")
    ? `marteso.${storageKey}`
    : `marteso.chartAnnotations.${storageKey}`;
}

function loadAnnotations(storageKey: string): ChartAnnotation[] {
  try {
    const raw = localStorage.getItem(annotationStorageKey(storageKey));

    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is ChartAnnotation =>
        typeof item?.id === "string" && typeof item?.date === "string" && typeof item?.text === "string",
    );
  } catch {
    return [];
  }
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function axisMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMetricValue(value: number, def: MetricDef, currency: string): string {
  if (def.format === "percent") return `${value.toFixed(1)}%`;
  if (def.format === "money") return money(value, def.usd ? "USD" : currency);

  return value.toLocaleString();
}

function chartDate(value: string): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}`;
}

function MetricsTooltip({
  active,
  payload,
  currency,
  metrics,
}: {
  active?: boolean;
  payload?: {
    payload: Record<string, unknown>;
    dataKey: string | number;
    value: number | string;
    color?: string;
    hide?: boolean;
  }[];
  currency: string;
  metrics: MetricDef[];
}) {
  if (!active || !payload?.length) return null;
  const date = String(payload[0].payload.date);
  const rows: { def: MetricDef; value: number; color: string }[] = [];

  for (const entry of payload) {
    if (entry.hide) continue;

    const rawKey = String(entry.dataKey);
    const key = rawKey.endsWith("Tail") ? rawKey.slice(0, -4) : rawKey;
    const def = metrics.find((item) => item.key === key);

    if (!def) continue;

    const value = entry.value == null ? NaN : Number(entry.value);

    if (Number.isNaN(value)) continue;
    if (rows.some((row) => row.def.key === def.key)) continue;

    rows.push({ def, value, color: entry.color ?? def.color });
  }

  return (
    <div className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl px-3 py-2 shadow-lg text-[12px]`}>
      <div className={`font-semibold ${textPrimary} mb-1`}>{fmtShortDateWithWeekday(date)}</div>
      {rows.map((row) => (
        <div key={row.def.key} className={`${textMuted} flex items-center gap-1.5`}>
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
          {row.def.label}: {formatMetricValue(row.value, row.def, currency)}
        </div>
      ))}
    </div>
  );
}

export function PerformanceCard({
  title,
  storageKey,
  currency,
  loading,
  error,
  errorMessage = "Failed to load data",
  isEmpty,
  emptyMessage = "No data for this range.",
  metrics,
  axisGroups,
  chartData,
  openEnd,
  notes,
  footerLeft,
  footerRight,
}: {
  title: string;
  storageKey: string;
  currency: string;
  loading: boolean;
  error?: boolean;
  errorMessage?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  metrics: MetricDef[];
  axisGroups: AxisGroupDef[];
  chartData: Record<string, unknown>[];
  openEnd: boolean;
  notes?: (active: ReadonlySet<string>) => ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
}) {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(
    () => new Set(metrics.filter((m) => m.defaultActive !== false && !m.disabled).map((m) => m.key)),
  );

  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>(() => loadAnnotations(storageKey));
  const hoveredDateRef = useRef<string | null>(null);

  useEffect(() => {
    setAnnotations(loadAnnotations(storageKey));
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(annotationStorageKey(storageKey), JSON.stringify(annotations));
    } catch {}
  }, [annotations, storageKey]);

  const toggleMetric = (key: string) =>
    setActiveKeys((prev) => {
      const next = new Set(prev);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  const placeAnnotation = (date: unknown) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const entry: ChartAnnotation = {
      id:
        typeof crypto?.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date,
      text: "",
    };

    setAnnotations((prev) => [...prev, entry].sort((a, b) => (a.date < b.date ? -1 : 1)));
  };

  const lineMetrics = metrics.filter((m) => m.render === "line");
  const barMetrics = metrics.filter((m) => m.render === "bar");
  const points = chartData.map((day, index) => {
    const isFinalDay = openEnd && index === chartData.length - 1;
    const isTailPoint = openEnd && index >= chartData.length - 2;
    const point: Record<string, unknown> = { ...day };

    for (const metric of lineMetrics) {
      point[metric.key] = isFinalDay ? null : day[metric.key];
      point[`${metric.key}Tail`] = isTailPoint ? day[metric.key] : null;
    }

    return point;
  });

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[16px] font-semibold ${textPrimary}`}>{title}</div>
        <div className={`text-[12px] ${textMuted}`}>UTC</div>
      </div>
      {!loading && !error && (
        <div className="flex flex-wrap gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl w-fit max-w-full mt-3 mb-3">
          {metrics.map((metric) => {
            const active = activeKeys.has(metric.key) && !metric.disabled;

            return (
              <button
                key={metric.key}
                onClick={() => toggleMetric(metric.key)}
                disabled={metric.disabled}
                title={metric.disabled ? metric.disabledTitle : `${active ? "Hide" : "Show"} ${metric.label}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                    : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
                }`}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: metric.color }} />
                {metric.label}
              </button>
            );
          })}
        </div>
      )}
      {loading ? (
        <div className={`h-72 flex items-center justify-center text-[13px] ${textMuted}`}>Loading chart…</div>
      ) : error ? (
        <div className={`h-72 flex items-center justify-center text-[13px] ${textMuted}`}>{errorMessage}</div>
      ) : isEmpty ? (
        <div className={`h-72 flex items-center justify-center text-[13px] ${textMuted}`}>{emptyMessage}</div>
      ) : (
        <div>
          {notes?.(activeKeys)}
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={points}
              margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
              barGap={1}
              style={{ cursor: annotateMode ? "crosshair" : undefined }}
              onMouseMove={(state: any) => {
                hoveredDateRef.current = typeof state?.activeLabel === "string" ? state.activeLabel : null;
              }}
              onClick={(state: any) => {
                if (annotateMode) placeAnnotation(hoveredDateRef.current ?? state?.activeLabel);
              }}
            >
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis
                xAxisId="date"
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickFormatter={chartDate}
                minTickGap={28}
                interval="preserveStartEnd"
              />
              {axisGroups.map((group) => {
                const visible = group.alwaysVisible || metrics.some((m) => m.axis === group.id && activeKeys.has(m.key));

                if (!visible) return null;

                return (
                  <YAxis
                    key={group.id}
                    yAxisId={group.id}
                    orientation={group.orientation}
                    axisLine={false}
                    tickLine={false}
                    width={group.width}
                    hide={group.width === 0}
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={group.tickFormatter ?? axisMoney}
                  />
                );
              })}
              <YAxis yAxisId="annotations" domain={[0, 1]} allowDataOverflow hide width={0} />
              <Tooltip axisId="date" content={<MetricsTooltip currency={currency} metrics={metrics} />} />
              {barMetrics.map((metric) => (
                <Bar
                  key={metric.key}
                  xAxisId="date"
                  yAxisId={metric.axis}
                  dataKey={metric.key}
                  stackId={metric.stackId}
                  fill={metric.color}
                  maxBarSize={12}
                  isAnimationActive={false}
                  hide={!activeKeys.has(metric.key) || metric.disabled}
                />
              ))}
              {lineMetrics.map((metric) => (
                <Line
                  key={metric.key}
                  xAxisId="date"
                  yAxisId={metric.axis}
                  type="monotone"
                  dataKey={metric.key}
                  stroke={metric.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                  hide={!activeKeys.has(metric.key) || metric.disabled}
                />
              ))}
              {lineMetrics.map((metric) => (
                <Line
                  key={`${metric.key}-tail`}
                  xAxisId="date"
                  yAxisId={metric.axis}
                  type="monotone"
                  dataKey={`${metric.key}Tail`}
                  stroke={metric.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                  strokeDasharray="5 4"
                  hide={!openEnd || !activeKeys.has(metric.key) || metric.disabled}
                />
              ))}
              {annotations.map((annotation) => (
                <ReferenceLine
                  key={annotation.id}
                  xAxisId="date"
                  yAxisId="annotations"
                  x={annotation.date}
                  ifOverflow="visible"
                  stroke="#94a3b8"
                  strokeDasharray="4 3"
                  label={
                    annotation.text
                      ? { value: annotation.text, position: "top", fill: "#64748b", fontSize: 11 }
                      : undefined
                  }
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setAnnotateMode((on) => !on)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border border-dashed ${borderDefault} ${
                annotateMode
                  ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                  : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
              }`}
            >
              {annotateMode ? "Done" : "+ Annotate"}
            </button>
            {annotateMode && (
              <span className={`text-[12px] ${textMuted}`}>Click a date in the chart to place a note</span>
            )}
          </div>
          {annotations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {annotations.map((annotation) => (
                <div key={annotation.id} className="flex items-center gap-2">
                  <span className={`text-[11px] tabular-nums ${textMuted} w-20 shrink-0`}>{annotation.date}</span>
                  <input
                    value={annotation.text}
                    onChange={(e) =>
                      setAnnotations((prev) =>
                        prev.map((item) => (item.id === annotation.id ? { ...item, text: e.target.value } : item)),
                      )
                    }
                    placeholder="Note…"
                    maxLength={120}
                    className={`flex-1 h-8 px-2.5 text-[12px] border ${borderDefault} rounded-lg bg-white dark:bg-[#1c2028] ${textPrimary} focus:outline-none`}
                  />
                  <button
                    onClick={() => setAnnotations((prev) => prev.filter((item) => item.id !== annotation.id))}
                    title="Delete note"
                    className={`text-[15px] leading-none ${textMuted} hover:text-red-500 transition-colors px-1`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {(footerLeft || footerRight) && (
            <div className={`flex justify-between text-[11px] ${textMuted} mt-1`}>
              <span>{footerLeft}</span>
              <span>{footerRight}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
