import { useCallback, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { useClickOutside } from "../../hooks/useClickOutside";

export type RankFilter = "all" | "ranked" | "unranked" | "top10" | "top20" | "top50";
export type CoverageFilter = "all" | "covered" | "uncovered";
export type TrendFilter = "all" | "up" | "down" | "flat";

export interface KeywordFilterState {
  popMin: string;
  popMax: string;
  diffMin: string;
  diffMax: string;
  oppMin: string;
  oppMax: string;
  rank: RankFilter;
  coverage: CoverageFilter;
  trend: TrendFilter;
}

export const emptyFilters: KeywordFilterState = {
  popMin: "",
  popMax: "",
  diffMin: "",
  diffMax: "",
  oppMin: "",
  oppMax: "",
  rank: "all",
  coverage: "all",
  trend: "all",
};

export const activeFilterCount = (f: KeywordFilterState): number => {
  let n = 0;
  if (f.popMin || f.popMax) n++;
  if (f.diffMin || f.diffMax) n++;
  if (f.oppMin || f.oppMax) n++;
  if (f.rank !== "all") n++;
  if (f.coverage !== "all") n++;
  if (f.trend !== "all") n++;
  return n;
};

interface SegOpt<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegOpt<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className={`inline-flex flex-wrap items-center p-1 rounded-lg border ${borderDefault} bg-gray-50/60 dark:bg-[#181c24] gap-0.5`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            value === o.value
              ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_2px_rgba(0,0,0,0.06)]`
              : `${textMuted} hover:${textSecondary}`
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  const inputCls = `w-full px-2 py-1 rounded-md border ${borderDefault} bg-white dark:bg-[#1c2028] text-[12px] ${textPrimary} outline-none focus:border-[#595DD2] tabular-nums`;
  return (
    <div>
      <div className={`text-[11px] font-medium ${textSecondary} mb-1.5`}>{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          placeholder="0"
          value={min}
          onChange={(e) => onMin(e.target.value)}
          className={inputCls}
        />
        <span className={`text-[11px] ${textMuted}`}>to</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          placeholder="100"
          value={max}
          onChange={(e) => onMax(e.target.value)}
          className={inputCls}
        />
      </div>
    </div>
  );
}

interface Props {
  value: KeywordFilterState;
  onChange: (v: KeywordFilterState) => void;
}

export default function KeywordFilters({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(
    ref,
    useCallback(() => setOpen(false), []),
  );
  const count = activeFilterCount(value);
  const patch = (p: Partial<KeywordFilterState>) => onChange({ ...value, ...p });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 pl-3 pr-2.5 py-[7px] rounded-full border bg-white dark:bg-[#1c2028] text-[13px] font-medium ${textPrimary} transition-all ${
          open || count > 0
            ? "border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400 dark:ring-blue-400/25"
            : `${borderDefault} hover:border-gray-300 dark:hover:border-[#3a4050]`
        }`}
      >
        <SlidersHorizontal className={`w-3.5 h-3.5 ${textSecondary}`} />
        Filter
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500 text-white text-[10px] font-bold tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 ${textMuted} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg p-4 w-[340px]`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className={`text-sm font-semibold ${textPrimary}`}>Filters</div>
            <button
              onClick={() => onChange(emptyFilters)}
              disabled={count === 0}
              className={`text-[11px] font-medium ${textSecondary} hover:${textPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Reset all
            </button>
          </div>

          <div className="flex flex-col gap-3.5">
            <RangeRow
              label="Popularity"
              min={value.popMin}
              max={value.popMax}
              onMin={(v) => patch({ popMin: v })}
              onMax={(v) => patch({ popMax: v })}
            />
            <RangeRow
              label="Difficulty"
              min={value.diffMin}
              max={value.diffMax}
              onMin={(v) => patch({ diffMin: v })}
              onMax={(v) => patch({ diffMax: v })}
            />
            <RangeRow
              label="Opportunity"
              min={value.oppMin}
              max={value.oppMax}
              onMin={(v) => patch({ oppMin: v })}
              onMax={(v) => patch({ oppMax: v })}
            />

            <div>
              <div className={`text-[11px] font-medium ${textSecondary} mb-1.5`}>Our Rank</div>
              <Segmented<RankFilter>
                value={value.rank}
                onChange={(v) => patch({ rank: v })}
                options={[
                  { value: "all", label: "All" },
                  { value: "ranked", label: "Ranked" },
                  { value: "unranked", label: "Unranked" },
                  { value: "top10", label: "Top 10" },
                  { value: "top20", label: "Top 20" },
                  { value: "top50", label: "Top 50" },
                ]}
              />
            </div>

            <div>
              <div className={`text-[11px] font-medium ${textSecondary} mb-1.5`}>Metadata Coverage</div>
              <Segmented<CoverageFilter>
                value={value.coverage}
                onChange={(v) => patch({ coverage: v })}
                options={[
                  { value: "all", label: "All" },
                  { value: "covered", label: "Covered" },
                  { value: "uncovered", label: "Not covered" },
                ]}
              />
            </div>

            <div>
              <div className={`text-[11px] font-medium ${textSecondary} mb-1.5`}>Rank Trend</div>
              <Segmented<TrendFilter>
                value={value.trend}
                onChange={(v) => patch({ trend: v })}
                options={[
                  { value: "all", label: "All" },
                  { value: "up", label: "Improving" },
                  { value: "down", label: "Declining" },
                  { value: "flat", label: "Flat" },
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
