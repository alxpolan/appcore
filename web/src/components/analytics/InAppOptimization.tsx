import { useCallback, useRef, useState } from "react";
import { ChevronDown, Globe, Smartphone, Tag, type LucideIcon } from "lucide-react";
import { useApi, getActiveBundleId } from "../../hooks/useApi";
import { useClickOutside } from "../../hooks/useClickOutside";
import SectionCard from "../settings/SectionCard";
import { TD, TH, borderDefault, inputCls, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { countryName, fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
import AppleAdsMilestoneRows from "./AppleAdsMilestoneRows";
import type { AudienceFilterOption, AudienceFilterOptions, ProductEngagementResponse } from "../../types";

const UNKNOWN_FILTER_VALUE = "__unknown";

function platformLabel(value: string): string {
  if (value === UNKNOWN_FILTER_VALUE) return "Unknown platform";
  if (value.toLowerCase() === "ios") return "iOS";

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function countryOptionLabel(value: string): string {
  return value === UNKNOWN_FILTER_VALUE ? "Unknown country" : countryName(value);
}

function appVersionOptionLabel(value: string): string {
  return value === UNKNOWN_FILTER_VALUE ? "Unknown version" : value;
}

function countryOptionIcon(value: string) {
  if (value === UNKNOWN_FILTER_VALUE) return <Globe className={`w-4 h-4 ${textSecondary}`} />;

  return (
    <img
      src={`/country-flags/${value.toLowerCase()}.svg`}
      alt={value}
      className="w-4 h-3 rounded-xs object-cover shrink-0"
    />
  );
}

function FilterSelect({
  icon: Icon,
  allLabel,
  value,
  options,
  getLabel,
  renderOptionIcon,
  onChange,
}: {
  icon: LucideIcon;
  allLabel: string;
  value: string;
  options: AudienceFilterOption[];
  getLabel: (value: string) => string;
  renderOptionIcon?: (value: string) => React.ReactNode;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(
    ref,
    useCallback(() => setOpen(false), []),
  );

  if (options.length < 2) return null;

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 pl-3 pr-2.5 py-[7px] rounded-full border bg-white dark:bg-[#1c2028] text-[13px] font-medium ${textPrimary} transition-all ${
          open
            ? "border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400 dark:ring-blue-400/25"
            : `${borderDefault} hover:border-gray-300 dark:hover:border-[#3a4050]`
        }`}
      >
        {selected && renderOptionIcon ? (
          renderOptionIcon(selected.value)
        ) : (
          <Icon className={`w-4 h-4 ${textSecondary}`} />
        )}
        <span>{selected ? getLabel(selected.value) : allLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 ${textMuted} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute left-0 top-full mt-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[220px] max-h-[320px] overflow-auto`}
        >
          <button
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left ${
              value === "" ? "font-semibold" : ""
            }`}
          >
            <Icon className={`w-4 h-4 ${textSecondary} shrink-0`} />
            {allLabel}
          </button>
          <div className={`my-1 border-t ${borderDefault}`} />
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left ${
                value === opt.value ? "font-semibold" : ""
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {renderOptionIcon?.(opt.value)}
                <span className="truncate">{getLabel(opt.value)}</span>
              </span>
              <span className={`text-[12px] ${textMuted} tabular-nums shrink-0`}>{fmtNumber(opt.count)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TimingBucketRow {
  key: string;
  label: string;
  maxSeconds: number | null;
  users: number;
  subscribed: number;
  trialsStarted: number;
  cancelled: number;
  conversionRate: number | null;
  cancelRate: number | null;
}

interface TimingResponse {
  ok: boolean;
  buckets: TimingBucketRow[];
  totalUsers: number;
  excludedNoAnchor: number;
  excludedNoActivity: number;
  capped: boolean;
  maturityDays: number;
  anchorEvent: string;
  filterOptions?: AudienceFilterOptions;
}

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function InAppOptimization({ addToast }: Props) {
  void addToast;

  const bundleId = getActiveBundleId() ?? "";
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [anchorEvent, setAnchorEvent] = useState("$first_event");
  const [anchorDraft, setAnchorDraft] = useState("$first_event");

  const [country, setCountry] = useState("");
  const [platform, setPlatform] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const audienceFilterQuery =
    (country ? `&country=${encodeURIComponent(country)}` : "") +
    (platform ? `&platform=${encodeURIComponent(platform)}` : "") +
    (appVersion ? `&appVersion=${encodeURIComponent(appVersion)}` : "");
  const filterDeps = [country, platform, appVersion];

  const query = `${rangeToParams(range, customStart, customEnd)}&anchorEvent=${encodeURIComponent(anchorEvent)}${audienceFilterQuery}`;

  const { data, loading, error } = useApi<TimingResponse>(
    `/posthog/paywall-timing?bundleId=${encodeURIComponent(bundleId)}${query}`,
    [bundleId, range, customStart, customEnd, anchorEvent, ...filterDeps],
  );

  const rangeQuery = rangeToParams(range, customStart, customEnd);
  const {
    data: engagementData,
    loading: engagementLoading,
    error: engagementError,
  } = useApi<ProductEngagementResponse>(
    `/posthog/engagement?bundleId=${encodeURIComponent(bundleId)}${rangeQuery}${audienceFilterQuery}`,
    [bundleId, range, customStart, customEnd, ...filterDeps],
  );

  const filterOptions = data?.filterOptions ?? engagementData?.filterOptions;

  const hasRows = !!data && data.buckets.some((b) => b.users > 0);
  const applyAnchor = () => setAnchorEvent(anchorDraft.trim() || "$first_event");

  if (!bundleId) {
    return (
      <div className="max-w-[1200px] mx-auto">
        <h1 className={pageTitle}>In-App Optimization</h1>
        <p className={`text-[13px] ${textMuted} mt-1`}>Select an app to see its paywall timing.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto">
      <h1 className={`${pageTitle} mb-4`}>In-App Optimization</h1>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors ${
                range === opt.key
                  ? "bg-white dark:bg-[#252b38] text-[#111827] dark:text-[#e8eaf0] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : `${textMuted} hover:text-[#6b7280]`
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className={`${inputCls} h-8 !py-1 text-[12px] w-auto`}
            />
            <span className={`text-[12px] ${textMuted}`}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className={`${inputCls} h-8 !py-1 text-[12px] w-auto`}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className={`text-[12px] ${textMuted}`}>Anchor event</span>
          <input
            type="text"
            value={anchorDraft}
            onChange={(e) => setAnchorDraft(e.target.value)}
            onBlur={applyAnchor}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyAnchor();
            }}
            placeholder="$first_event"
            spellCheck={false}
            className={`${inputCls} h-8 !py-1 font-mono text-[12px] w-44`}
            title="Event the free-usage time is measured from ($first_event = first tracked event)"
          />
        </div>
      </div>

      {filterOptions && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <FilterSelect
            icon={Globe}
            allLabel="All Countries"
            value={country}
            options={filterOptions.countries}
            getLabel={countryOptionLabel}
            renderOptionIcon={countryOptionIcon}
            onChange={setCountry}
          />
          <FilterSelect
            icon={Smartphone}
            allLabel="All Platforms"
            value={platform}
            options={filterOptions.platforms}
            getLabel={platformLabel}
            onChange={setPlatform}
          />
          <FilterSelect
            icon={Tag}
            allLabel="All Versions"
            value={appVersion}
            options={filterOptions.appVersions}
            getLabel={appVersionOptionLabel}
            onChange={setAppVersion}
          />
        </div>
      )}

      {loading ? (
        <div className={`text-[13px] ${textMuted}`}>Loading…</div>
      ) : error || !data ? (
        <div className={`text-[13px] ${textMuted}`}>
          {error ?? "Failed to load paywall timing. Connect PostHog first."}
        </div>
      ) : !hasRows ? (
        <div className={`text-[13px] ${textMuted}`}>No paywall views recorded for this app yet.</div>
      ) : (
        <>
          <SectionCard
            title="Time to paywall vs conversion"
            desc={`Based on ${fmtNumber(data.totalUsers)} users${data.excludedNoActivity > 0 ? ` (${fmtNumber(data.excludedNoActivity)} without app activity excluded: test purchases and server-only events)` : ""}${data.excludedNoAnchor > 0 ? ` (${fmtNumber(data.excludedNoAnchor)} without anchor event excluded)` : ""}${data.capped ? " (most recent, capped)" : ""}. Cancelled = RevenueCat reports the trial won't renew, or it ended without converting.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[12px]">
                <thead>
                  <tr>
                    <th className={TH}>Free usage before paywall</th>
                    <th className={`${TH} text-right`}>Users</th>
                    <th className={`${TH} text-right`}>Subscribed</th>
                    <th className={`${TH} text-right`}>Conversion</th>
                    <th className={`${TH} text-right`}>Trials</th>
                    <th className={`${TH} text-right`}>Cancelled</th>
                    <th className={`${TH} text-right pr-4`}>Cancel rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => (
                    <tr key={b.key} className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors">
                      <td className={`${TD} font-medium ${textPrimary}`}>{b.label}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(b.users)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(b.subscribed)}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        <span className="inline-flex items-center justify-end gap-2 w-full">
                          <span
                            className="inline-block h-1.5 rounded-full bg-[#595DD2]"
                            style={{ width: `${Math.min(100, (b.conversionRate ?? 0) * 100)}px`, maxWidth: "120px" }}
                          />
                          {b.conversionRate == null ? "—" : fmtPct(b.conversionRate * 100)}
                        </span>
                      </td>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtNumber(b.trialsStarted)}</td>
                      <td className={`${TD} text-right tabular-nums ${textMuted}`}>{fmtNumber(b.cancelled)}</td>
                      <td className={`${TD} text-right pr-4 tabular-nums ${textMuted}`}>
                        {b.cancelRate == null ? "—" : fmtPct(b.cancelRate * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
          {data.capped && (
            <p className={`text-[12px] ${textMuted} mt-3`}>Analysis capped at the most recent users for performance.</p>
          )}
        </>
      )}

      <div
        className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] mt-5`}
      >
        <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d]">
          <div className={`text-[16px] font-semibold ${textPrimary}`}>Product Engagement</div>
          <p className={`text-[12px] ${textMuted} mt-0.5`}>All users first seen {rangeLabel(range)}.</p>
        </div>
        {engagementLoading ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
        ) : engagementError || !engagementData ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {engagementError ?? "Failed to load engagement"}
          </div>
        ) : !engagementData.available ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            {engagementData.reason === "no-revenuecat"
              ? "Connect RevenueCat for this app to track engagement."
              : "Connect PostHog in Integrations to track engagement."}
          </div>
        ) : engagementData.reason === "no-milestones" || engagementData.milestones.length === 0 ? (
          <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
            No milestones configured yet — add some in App Settings.
          </div>
        ) : (
          <>
            <AppleAdsMilestoneRows
              milestones={engagementData.milestones}
              variants={engagementData.variants}
              basisInstalls={engagementData.totalUsers}
              fallbackTotal={engagementData.totalUsers}
            />
            {engagementData.capped && (
              <p className={`px-5 pb-4 text-[12px] ${textMuted}`}>
                Analysis capped at the most recent users for performance.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
