import { Fragment, useMemo, useState } from "react";
import { Ban, ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TD, TH, borderDefault, btnSecSm, textMuted, textPrimary } from "../../styles";
import { fmtMoney, fmtNumber, fmtPct } from "../../utils/formatters";
import {
  EMPTY_KEYWORD_FILTERS,
  filterKeywordRows,
  isFilterActive,
  sortKeywordRows,
  type KeywordFilters,
  type KeywordSortCol,
  type SortDir,
} from "../../utils/keywordTable";
import AdGroupCppSettings from "./AdGroupCppSettings";
import { KeywordDevices } from "./AppleAdsKeywordDevices";
import { KeywordCountries } from "./AppleAdsCountryTable";
import { STAT_HEADERS, StatCells } from "./AppleAdsStatCells";
import { StatusDot } from "../StatusDot";
import { TransactionTypeBadge, adsTransactionType, prettyProductName } from "../TransactionTypeBadge";
import type { AppleAdsAdGroup, AppleAdsRevenueBucket } from "../../types";

const TEXT_SORT_COLS: KeywordSortCol[] = ["keyword", "matchType"];

interface Props {
  campaignId: string | undefined;
  group: AppleAdsAdGroup;
  currency: string | null;
  revenueByKeyword: Record<string, AppleAdsRevenueBucket> | undefined;
  revenueLoading: boolean;
  revenueError: string | null;
  rangeQuery: string;
  canWrite: boolean;
  negativeCount: number | null;
  onOpenNegatives: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AdGroupKeywordsPanel({
  campaignId,
  group: g,
  currency,
  revenueByKeyword,
  revenueLoading,
  revenueError,
  rangeQuery,
  canWrite,
  negativeCount,
  onOpenNegatives,
  addToast,
}: Props) {
  const [kwSortCol, setKwSortCol] = useState<KeywordSortCol>("spend");
  const [kwSortDir, setKwSortDir] = useState<SortDir>("desc");
  const [kwFilter, setKwFilter] = useState<KeywordFilters>(EMPTY_KEYWORD_FILTERS);
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);

  function handleKwSort(col: KeywordSortCol) {
    if (kwSortCol === col) {
      setKwSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setKwSortCol(col);
      setKwSortDir(TEXT_SORT_COLS.includes(col) ? "asc" : "desc");
    }
  }

  function KwSortTh({
    col,
    children,
    right,
    last,
  }: {
    col: KeywordSortCol;
    children: React.ReactNode;
    right?: boolean;
    last?: boolean;
  }) {
    const active = kwSortCol === col;
    return (
      <th
        className={`${TH} ${right ? "text-right" : ""} ${last ? "pr-5" : ""} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
        onClick={() => handleKwSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <span className="opacity-40 [&_svg]:w-3 [&_svg]:h-3">
            {active ? kwSortDir === "asc" ? <ChevronUp /> : <ChevronDown /> : <ChevronsUpDown />}
          </span>
        </span>
      </th>
    );
  }

  function resetKwTable() {
    setKwFilter(EMPTY_KEYWORD_FILTERS);
    setKwSortCol("spend");
    setKwSortDir("desc");
  }

  const setKwFilterValue = (key: keyof KeywordFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setKwFilter((prev) => ({ ...prev, [key]: e.target.value }));

  const kwFilterInput =
    `h-7 w-full min-w-[56px] px-1.5 text-[11px] border ${borderDefault} rounded-lg ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2] tabular-nums`;
  const kwFilterCell = "px-4 py-1.5 border-b border-[#f3f4f6] dark:border-[#2a2f3d]";
  const kwTableModified = isFilterActive(kwFilter) || kwSortCol !== "spend" || kwSortDir !== "desc";
  const visibleKeywords = useMemo(
    () => sortKeywordRows(filterKeywordRows(g.keywords, kwFilter, revenueByKeyword), kwSortCol, kwSortDir, revenueByKeyword),
    [g.keywords, kwFilter, kwSortCol, kwSortDir, revenueByKeyword],
  );

  return (
    <>
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <button onClick={onOpenNegatives} className={btnSecSm} title="Ad-group-level negative keywords">
          <Ban className="w-3.5 h-3.5" /> Negative Keywords
          {negativeCount != null && <span className={`text-[11px] ${textMuted} tabular-nums`}>({negativeCount})</span>}
        </button>
      </div>
      {campaignId && (
        <div className="mb-3">
          <AdGroupCppSettings campaignId={campaignId} adGroupId={g.id} canWrite={canWrite} addToast={addToast} />
        </div>
      )}
      <div className={`text-[12px] font-semibold ${textPrimary} mb-2 flex items-center justify-between gap-2`}>
        <span>
          Keywords{" "}
          {g.cpaGoal != null && (
            <span className={`font-normal ${textMuted}`}>
              · CPA goal {fmtMoney(g.cpaGoal, g.currency ?? currency)}
            </span>
          )}
        </span>
        {kwTableModified && (
          <button
            onClick={resetKwTable}
            className={`text-[11px] font-medium ${textMuted} hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
          >
            Reset
          </button>
        )}
      </div>
      {g.keywords.length === 0 ? (
        <div className={`text-[12px] ${textMuted}`}>No keywords in this ad group.</div>
      ) : visibleKeywords.length === 0 ? (
        <div className={`text-[12px] ${textMuted}`}>No keywords match the current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[1200px]">
            <thead>
              <tr>
                <th className={TH}></th>
                <KwSortTh col="keyword">Keyword</KwSortTh>
                <KwSortTh col="matchType">Match Type</KwSortTh>
                <KwSortTh col="bid" right>
                  Bid
                </KwSortTh>
                <KwSortTh col="spend" right>
                  Spend
                </KwSortTh>
                <KwSortTh col="impressions" right>
                  Impressions
                </KwSortTh>
                <KwSortTh col="taps" right>
                  Taps
                </KwSortTh>
                <KwSortTh col="ttr" right>
                  TTR
                </KwSortTh>
                <KwSortTh col="installs" right>
                  Installs
                </KwSortTh>
                <KwSortTh col="avgCpt" right>
                  Avg CPT
                </KwSortTh>
                <KwSortTh col="avgCpa" right>
                  Avg CPA
                </KwSortTh>
                <KwSortTh col="convRate" right>
                  Conv. Rate
                </KwSortTh>
                <KwSortTh col="rcTxns" right>
                  Txns
                </KwSortTh>
                <KwSortTh col="rcProceeds" right last>
                  Proceeds
                </KwSortTh>
              </tr>
              <tr>
                <th className={kwFilterCell}>
                  {isFilterActive(kwFilter) && (
                    <span className={`text-[11px] tabular-nums ${textMuted}`}>
                      {visibleKeywords.length}/{g.keywords.length}
                    </span>
                  )}
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.text}
                    onChange={setKwFilterValue("text")}
                    placeholder="Search"
                    className={kwFilterInput}
                  />
                </th>
                <th className={kwFilterCell}>
                  <select
                    value={kwFilter.matchType}
                    onChange={setKwFilterValue("matchType")}
                    className={kwFilterInput}
                  >
                    <option value="">All</option>
                    {[...new Set(g.keywords.map((k) => k.matchType))].sort().map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.bid}
                    onChange={setKwFilterValue("bid")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.spend}
                    onChange={setKwFilterValue("spend")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.impressions}
                    onChange={setKwFilterValue("impressions")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.taps}
                    onChange={setKwFilterValue("taps")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.ttr}
                    onChange={setKwFilterValue("ttr")}
                    placeholder="min %"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.installs}
                    onChange={setKwFilterValue("installs")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.avgCpt}
                    onChange={setKwFilterValue("avgCpt")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.avgCpa}
                    onChange={setKwFilterValue("avgCpa")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.convRate}
                    onChange={setKwFilterValue("convRate")}
                    placeholder="min %"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={kwFilterCell}>
                  <input
                    value={kwFilter.rcTxns}
                    onChange={setKwFilterValue("rcTxns")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
                <th className={`${kwFilterCell} pr-5`}>
                  <input
                    value={kwFilter.rcProceeds}
                    onChange={setKwFilterValue("rcProceeds")}
                    placeholder="min"
                    inputMode="decimal"
                    className={`${kwFilterInput} text-right`}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleKeywords.map((k) => {
                const kwExpanded = expandedKeyword === k.id;
                const kwRevenue = revenueByKeyword?.[k.id];
                return (
                  <Fragment key={k.id}>
                    <tr
                      onClick={() => setExpandedKeyword(kwExpanded ? null : k.id)}
                      className="cursor-pointer hover:bg-[#f7f8fa] dark:hover:bg-[#252b38]"
                    >
                      <td className={`${TD} w-5`}>
                        <ChevronRight
                          className={`w-3.5 h-3.5 ${textMuted} transition-transform shrink-0 ${kwExpanded ? "rotate-90" : ""}`}
                        />
                      </td>
                      <td className={TD}>
                        <span className={`inline-flex items-center gap-2 font-medium ${textPrimary}`}>
                          <StatusDot status={k.status} />
                          {k.text}
                        </span>
                      </td>
                      <td className={`${TD} ${textMuted}`}>{k.matchType}</td>
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {fmtMoney(k.bidAmount, k.currency ?? g.currency ?? currency)}
                      </td>
                      <StatCells stats={k} currency={k.currency ?? g.currency ?? currency} ttrTrafficLight />
                      <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
                        {revenueLoading ? "…" : revenueError ? "—" : fmtNumber(kwRevenue?.transactions.length ?? 0)}
                      </td>
                      <td className={`${TD} text-right pr-5 tabular-nums font-medium ${textPrimary}`}>
                        {revenueLoading
                          ? "…"
                          : revenueError
                            ? "—"
                            : fmtMoney(kwRevenue?.proceedsUsd ?? 0, "USD")}
                      </td>
                    </tr>
                    {kwExpanded && campaignId && (
                      <tr className="bg-[#fafbfc] dark:bg-[#161920]">
                        <td colSpan={14} className="px-4 py-3">
                          <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>Countries</div>
                          <div className="mb-4">
                            <KeywordCountries
                              campaignId={campaignId}
                              adGroupId={g.id}
                              keywordId={k.id}
                              currency={k.currency ?? g.currency ?? currency}
                              query={rangeQuery}
                            />
                          </div>
                          <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>Devices</div>
                          <div className={kwRevenue ? "mb-4" : ""}>
                            <KeywordDevices
                              campaignId={campaignId}
                              adGroupId={g.id}
                              keywordId={k.id}
                              currency={k.currency ?? g.currency ?? currency}
                              query={rangeQuery}
                            />
                          </div>
                          {kwRevenue && (
                            <>
                              <div className={`text-[12px] font-semibold ${textPrimary} mb-2`}>Revenue</div>
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr>
                                    <th className={TH}>Date</th>
                                    <th className={TH}>App</th>
                                    <th className={TH}>Product</th>
                                    <th className={TH}>Type</th>
                                    <th className={TH}>Country</th>
                                    <th className={`${TH} text-right`}>Proceeds</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {kwRevenue.transactions.map((t) => (
                                    <tr key={t.id}>
                                      <td className={TD}>{t.date.slice(0, 10)}</td>
                                      <td className={TD}>{t.app}</td>
                                      <td className={TD}>
                                        <span className={`font-medium ${textPrimary}`} title={t.product}>
                                          {prettyProductName(t.product)}
                                        </span>
                                      </td>
                                      <td className={TD}>
                                        <TransactionTypeBadge type={adsTransactionType(t)} />
                                      </td>
                                      <td className={TD}>
                                        {t.country ? (
                                          <span className="inline-flex items-center gap-1.5">
                                            <img
                                              src={`/country-flags/${t.country.toLowerCase()}.svg`}
                                              alt={t.country}
                                              className="w-4 h-3 rounded-xs object-cover shrink-0"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = "none";
                                              }}
                                            />
                                            {t.country}
                                          </span>
                                        ) : (
                                          <span className={textMuted}>—</span>
                                        )}
                                      </td>
                                      <td className={`${TD} text-right tabular-nums`}>
                                        {fmtMoney(t.proceedsUsd, "USD")}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
