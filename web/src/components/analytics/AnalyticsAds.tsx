import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Megaphone,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  FolderPlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
  DollarSign,
  Download,
  Eye,
  MousePointerClick,
  Percent,
  TrendingUp,
} from "lucide-react";
import { useApi, apiDelete, apiGet, apiPatch, apiPost, apiPut, getActiveBundleId } from "../../hooks/useApi";
import { usePermissions } from "../../hooks/usePermissions";
import type {
  AppleAdsCampaign,
  AppleAdsCampaignGroup,
  AppleAdsCampaignRevenue,
  AppleAdsDailyStatsResponse,
  AppleAdsStatus,
} from "../../types";
import { TD, TH, borderDefault, btnSecSm, pageTitle, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtNumber, fmtPct } from "../../utils/formatters";
import { type RangeKey, RANGE_OPTIONS, rangeLabel, rangeToParams } from "../../utils/analyticsRange";
import AnalyticsAdsCreateCampaign from "./AnalyticsAdsCreateCampaign";
import AdsOverviewChart from "./AdsOverviewChart";
import { StatCard } from "../StatCard";
import { TransactionTypeBadge, adsTransactionType, prettyProductName } from "../TransactionTypeBadge";

function fmtMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function statusDot(status: string) {
  const isOn = status === "ENABLED";
  const isPaused = status === "PAUSED";
  return (
    <span
      title={status.replace(/_/g, " ")}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
        isOn
          ? "bg-emerald-100 dark:bg-emerald-900/30"
          : isPaused
            ? "bg-gray-100 dark:bg-[#252b38]"
            : "bg-red-100 dark:bg-red-900/30"
      }`}
    >
      {isOn ? (
        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
      ) : isPaused ? (
        <Pause className="w-3 h-3 text-gray-600 dark:text-[#8b93a5]" fill="currentColor" strokeWidth={0} />
      ) : (
        <X className="w-3 h-3 text-red-600 dark:text-red-400" strokeWidth={3} />
      )}
    </span>
  );
}

const UNGROUPED = "__ungrouped__";

type CampaignSortKey =
  | "name"
  | "dailyBudget"
  | "spend"
  | "impressions"
  | "taps"
  | "installs"
  | "transactions"
  | "proceeds";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`inline-flex flex-col ml-1 leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`w-4 h-4 -mb-1.5 ${active && dir === "asc" ? "text-[#595DD2]" : "text-current"}`} />
      <ChevronDown className={`w-4 h-4 -mt-1 ${active && dir === "desc" ? "text-[#595DD2]" : "text-current"}`} />
    </span>
  );
}

const COLLAPSED_GROUPS_KEY = "appcore_ads_collapsed_groups";

function loadCollapsedGroups(bundleId: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw || !bundleId) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const ids = parsed[bundleId];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export default function AnalyticsAds({ addToast }: Props) {
  const navigate = useNavigate();
  const { canManageTeam, canWrite } = usePermissions();
  const [showCreate, setShowCreate] = useState(false);
  const { data: status } = useApi<AppleAdsStatus>("/apple-ads/status", [], true);
  const [bundleId, setBundleId] = useState<string | null>(() => getActiveBundleId());
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [groups, setGroups] = useState<AppleAdsCampaignGroup[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedGroups(getActiveBundleId()));
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupOverride, setGroupOverride] = useState<Record<string, string | null>>({});
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [openRowMenu, setOpenRowMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [openGroupMenu, setOpenGroupMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<CampaignSortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  useEffect(() => {
    const handler = () => {
      setBundleId(getActiveBundleId());
      setExpandedCampaign(null);
      setGroupOverride({});
      setStatusOverride({});
      setTogglingId(null);
      setOpenRowMenu(null);
      setOpenGroupMenu(null);
      setEditingGroup(null);
      setCreatingGroup(false);
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, []);
  // Remember collapsed groups per app across reloads. Loading wins over
  // persisting on app switch so a stale set never leaks into the new app.
  const skipPersistRef = useRef(true);
  useEffect(() => {
    setCollapsed(loadCollapsedGroups(bundleId));
    skipPersistRef.current = true;
  }, [bundleId]);
  useEffect(() => {
    if (!bundleId || skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, string[]>;
      parsed[bundleId] = [...collapsed];
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(parsed));
    } catch {
      // Private mode etc. — collapsing still works for the session.
    }
  }, [collapsed, bundleId]);
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const query = useMemo(
    () => rangeToParams(range, customStart, customEnd).replace(/^&/, "?"),
    [range, customStart, customEnd],
  );
  const rangeDeps = [range, customStart, customEnd];
  const {
    data: campaignsData,
    loading,
    error,
    refetch: refetchCampaigns,
  } = useApi<{ campaigns: AppleAdsCampaign[] }>(
    `/apple-ads/campaigns${query}`,
    [status?.connected, bundleId, ...rangeDeps],
    false,
  );
  const {
    data: revenueData,
    loading: revenueLoading,
    error: revenueError,
  } = useApi<AppleAdsCampaignRevenue>(
    `/apple-ads/campaign-revenue${query}`,
    [status?.connected, bundleId, ...rangeDeps],
    false,
  );
  const { data: dailyData, loading: dailyLoading } = useApi<AppleAdsDailyStatsResponse>(
    `/apple-ads/daily${query}`,
    [status?.connected, bundleId, ...rangeDeps],
    false,
  );
  const days = dailyData?.days ?? [];

  const campaigns = campaignsData?.campaigns ?? [];
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      taps: acc.taps + c.taps,
      installs: acc.installs + c.installs,
    }),
    { spend: 0, impressions: 0, taps: 0, installs: 0 },
  );
  const currency = campaigns.find((c) => c.currency)?.currency ?? "USD";

  const refetchGroups = useCallback(() => {
    if (!status?.connected || !bundleId) {
      setGroups([]);
      return;
    }
    apiGet<{ groups: AppleAdsCampaignGroup[] }>("/apple-ads/campaign-groups")
      .then((res) => setGroups(res.groups))
      .catch(() => setGroups([]));
  }, [status?.connected, bundleId]);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  useEffect(() => {
    setGroupOverride({});
    setStatusOverride({});
  }, [campaignsData]);

  const closeMenus = () => {
    setOpenRowMenu(null);
    setOpenGroupMenu(null);
  };
  const menuPos = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { top: r.bottom + 4, right: window.innerWidth - r.right };
  };

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSort = (key: CampaignSortKey) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const valueFor = (c: AppleAdsCampaign): number | string => {
    switch (sortBy) {
      case "name":
        return c.name.toLowerCase();
      case "dailyBudget":
        return c.dailyBudget ?? -1;
      case "spend":
        return c.spend;
      case "impressions":
        return c.impressions;
      case "taps":
        return c.taps;
      case "installs":
        return c.installs;
      case "transactions":
        return revenueData?.byCampaign[c.id]?.transactions.length ?? -1;
      case "proceeds":
        return revenueData?.byCampaign[c.id]?.proceedsUsd ?? -1;
    }
  };

  const compareValues = (va: number | string, vb: number | string): number => {
    const cmp =
      typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : va - vb;

    return sortDir === "asc" ? cmp : -cmp;
  };

  const sortedCampaigns = useMemo(() => {
    const withOverrides = campaigns.map((c) => ({
      ...c,
      ...(c.id in groupOverride ? { groupId: groupOverride[c.id] } : {}),
      ...(c.id in statusOverride ? { status: statusOverride[c.id] } : {}),
    }));

    return [...withOverrides].sort((a, b) => compareValues(valueFor(a), valueFor(b)));
  }, [campaigns, groupOverride, statusOverride, sortBy, sortDir, revenueData]);

  const sortedGroups = useMemo(() => {
    const groupValue = (g: AppleAdsCampaignGroup): number | string => {
      if (sortBy === "name") return g.name.toLowerCase();

      return sortedCampaigns
        .filter((c) => c.groupId === g.id)
        .reduce((total, c) => {
          const v = valueFor(c);

          return total + (typeof v === "number" ? Math.max(0, v) : 0);
        }, 0);
    };

    return [...groups].sort((a, b) => compareValues(groupValue(a), groupValue(b)));
  }, [groups, sortedCampaigns, sortBy, sortDir, revenueData]);

  const ungrouped = sortedCampaigns.filter((c) => !c.groupId || !groups.some((g) => g.id === c.groupId));
  const hasGroups = groups.length > 0;

  const handleCreateGroup = async (name: string) => {
    if (!canWrite) return;
    try {
      const res = await apiPost<{ group: AppleAdsCampaignGroup }>("/apple-ads/campaign-groups", {
        name,
        bundleId: getActiveBundleId(),
      });
      setGroups((g) => [...g, res.group]);
      setCreatingGroup(false);
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleRenameGroup = async (id: string, name: string) => {
    if (!canWrite) return;
    try {
      const res = await apiPatch<{ group: AppleAdsCampaignGroup }>(`/apple-ads/campaign-groups/${id}`, { name });
      setGroups((g) => g.map((x) => (x.id === id ? res.group : x)));
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!canWrite) return;
    try {
      await apiDelete(`/apple-ads/campaign-groups/${id}`);
      setGroups((g) => g.filter((x) => x.id !== id));
      setGroupOverride((prev) => {
        const next = { ...prev };
        for (const c of campaigns) {
          const effective = c.id in prev ? prev[c.id] : (c.groupId ?? null);
          if (effective === id) next[c.id] = null;
        }
        return next;
      });
    } catch (e: any) {
      addToast(e.message, "error");
    }
  };

  const handleAssignGroup = async (campaignId: string, groupId: string | null) => {
    if (!canWrite) return;
    const hadOverride = campaignId in groupOverride;
    const prev = groupOverride[campaignId];
    setGroupOverride((o) => ({ ...o, [campaignId]: groupId }));
    try {
      await apiPut(`/apple-ads/campaigns/${campaignId}/group`, { groupId, bundleId: getActiveBundleId() });
    } catch (e: any) {
      setGroupOverride((o) => {
        const next = { ...o };
        if (!hadOverride) delete next[campaignId];
        else next[campaignId] = prev;
        return next;
      });
      addToast(e.message, "error");
    }
  };

  const handleToggleStatus = async (campaign: AppleAdsCampaign) => {
    if (!canManageTeam || togglingId) return;

    const nextStatus = campaign.status === "ENABLED" ? "PAUSED" : "ENABLED";

    if (nextStatus === "ENABLED" && !confirm(`Resume campaign "${campaign.name}"? It will start spending again.`)) return;

    setTogglingId(campaign.id);
    setStatusOverride((o) => ({ ...o, [campaign.id]: nextStatus }));

    try {
      await apiPatch(`/apple-ads/campaigns/${campaign.id}/status`, { status: nextStatus });
      addToast(nextStatus === "ENABLED" ? `Resumed "${campaign.name}"` : `Paused "${campaign.name}"`, "success");
      refetchCampaigns();
    } catch (e: any) {
      setStatusOverride((o) => {
        const restored = { ...o };

        delete restored[campaign.id];

        return restored;
      });
      addToast(e.message, "error");
    } finally {
      setTogglingId(null);
    }
  };

  const col = (key: CampaignSortKey, label: string, align: "left" | "right" = "right") => (
    <th
      className={`${TH} ${align === "right" ? "text-right" : ""} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
      onClick={() => handleSort(key)}
    >
      <span
        className={`inline-flex items-center gap-0.5 whitespace-nowrap ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <SortIcon active={sortBy === key} dir={sortDir} />
      </span>
    </th>
  );

  const renderRow = (c: AppleAdsCampaign) => (
    <Fragment key={c.id}>
      <tr
        onClick={() => setExpandedCampaign(expandedCampaign === c.id ? null : c.id)}
        className="hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors cursor-pointer"
      >
        <td className={TD}>
          <span className={`flex min-w-0 items-center gap-2 font-medium ${textPrimary}`}>
            <ChevronRight
              className={`w-3.5 h-3.5 ${textMuted} shrink-0 transition-transform ${expandedCampaign === c.id ? "rotate-90" : ""}`}
            />
            {statusDot(c.status)}
            <span className="truncate" title={c.name}>
              {c.name}
            </span>
          </span>
        </td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
          {c.dailyBudget != null ? fmtMoney(c.dailyBudget, c.currency) : "—"}
        </td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtMoney(c.spend, c.currency)}</td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.impressions)}</td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.taps)}</td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>{fmtNumber(c.installs)}</td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
          {revenueLoading
            ? "…"
            : revenueError
              ? "—"
              : fmtNumber(revenueData?.byCampaign[c.id]?.transactions.length ?? 0)}
        </td>
        <td className={`${TD} text-right tabular-nums ${textPrimary}`}>
          {revenueLoading ? "…" : revenueError ? "—" : fmtMoney(revenueData?.byCampaign[c.id]?.proceedsUsd ?? 0, "USD")}
        </td>
        <td className={`${TD} text-right pr-5`}>
          <span className="inline-flex items-center gap-1">
            {canManageTeam && (c.status === "ENABLED" || c.status === "PAUSED") && (
              <button
                aria-label={c.status === "ENABLED" ? "Pause campaign" : "Resume campaign"}
                title={c.status === "ENABLED" ? "Pause campaign" : "Resume campaign"}
                disabled={togglingId === c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleStatus(c);
                }}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${textMuted} hover:bg-gray-100 dark:hover:bg-white/10 hover:${textPrimary} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {c.status === "ENABLED" ? (
                  <Pause className="w-4 h-4" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play className="w-4 h-4" fill="currentColor" strokeWidth={0} />
                )}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/apple-ads/${c.id}`);
              }}
              className={`inline-flex items-center gap-1 text-[12px] font-medium text-[#595DD2] hover:underline`}
            >
              Details <ExternalLink className="w-3 h-3" />
            </button>
            <button
              aria-label="Campaign actions"
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${textMuted} hover:bg-gray-100 dark:hover:bg-white/10 hover:${textPrimary} transition-colors`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenGroupMenu(null);
                const pos = menuPos(e);
                setOpenRowMenu((m) => (m?.id === c.id ? null : { id: c.id, ...pos }));
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </span>
          {openRowMenu?.id === c.id && (
            <div
              style={{ position: "fixed", top: openRowMenu.top, right: openRowMenu.right }}
              className={`z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[200px] text-left`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>
                Move to group
              </div>
              {groups.length === 0 && <div className={`px-3 py-1.5 text-[12px] ${textMuted}`}>No groups yet</div>}
              {groups.map((g) => (
                <button
                  key={g.id}
                  disabled={!canWrite}
                  onClick={() => {
                    handleAssignGroup(c.id, g.id);
                    setOpenRowMenu(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span className="truncate">{g.name}</span>
                  {c.groupId === g.id && <Check className="w-3.5 h-3.5 text-[#595DD2] shrink-0" strokeWidth={3} />}
                </button>
              ))}
              {c.groupId && (
                <button
                  disabled={!canWrite}
                  onClick={() => {
                    handleAssignGroup(c.id, null);
                    setOpenRowMenu(null);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] ${textSecondary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Remove from group
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {expandedCampaign === c.id && (
        <tr className="bg-[#fafbfc] dark:bg-[#161920]">
          <td colSpan={9} className="px-5 py-4">
            {revenueLoading ? (
              <div className={`text-[12px] ${textMuted}`}>Loading…</div>
            ) : revenueError ? (
              <div className="text-[12px] text-red-500">Could not load attributed transactions.</div>
            ) : !revenueData?.byCampaign[c.id]?.transactions.length ? (
              <div className={`text-[12px] ${textMuted}`}>No attributed transactions in the last 30 days.</div>
            ) : (
              <div className="max-h-80 overflow-auto">
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
                    {revenueData.byCampaign[c.id].transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td className={TD}>{transaction.date.slice(0, 10)}</td>
                        <td className={TD}>{transaction.app}</td>
                        <td className={TD}>
                          <span className={`font-medium ${textPrimary}`} title={transaction.product}>
                            {prettyProductName(transaction.product)}
                          </span>
                        </td>
                        <td className={TD}>
                          <TransactionTypeBadge type={adsTransactionType(transaction)} />
                        </td>
                        <td className={TD}>
                          {transaction.country ? (
                            <span className="inline-flex items-center gap-1.5">
                              <img
                                src={`/country-flags/${transaction.country.toLowerCase()}.svg`}
                                alt={transaction.country}
                                className="w-4 h-3 rounded-xs object-cover shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                              {transaction.country}
                            </span>
                          ) : (
                            <span className={textMuted}>—</span>
                          )}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{fmtMoney(transaction.proceedsUsd, "USD")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );

  const renderGroupHeader = (id: string, name: string, rows: AppleAdsCampaign[], removable: boolean) => {
    const isCollapsed = collapsed.has(id);
    const sum = (pick: (c: AppleAdsCampaign) => number) => rows.reduce((total, c) => total + pick(c), 0);
    const transactions = sum((c) => revenueData?.byCampaign[c.id]?.transactions.length ?? 0);
    const proceeds = sum((c) => revenueData?.byCampaign[c.id]?.proceedsUsd ?? 0);
    const totalCls = `text-right tabular-nums font-semibold ${textPrimary}`;
    return (
      <tr
        key={`hdr-${id}`}
        className="bg-gray-50/70 dark:bg-white/[0.02] border-t border-[#f0f1f3] dark:border-[#252a34]"
      >
        <td className={`${TD} cursor-pointer select-none`} onClick={() => toggleCollapse(id)}>
          <span className="flex min-w-0 items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className={`w-4 h-4 ${textMuted} shrink-0`} />
            ) : (
              <ChevronDown className={`w-4 h-4 ${textMuted} shrink-0`} />
            )}
            {editingGroup === id ? (
              <input
                autoFocus
                defaultValue={name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== name) handleRenameGroup(id, v);
                  setEditingGroup(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingGroup(null);
                }}
                className={`text-[14px] font-semibold ${textPrimary} bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-md px-2 py-0.5 outline-none focus:border-[#595DD2] w-48 max-w-full shrink-0`}
              />
            ) : (
              <span className={`text-[14px] font-semibold ${textPrimary} truncate`} title={name}>
                {name}
              </span>
            )}
            <span className={`text-[12px] ${textMuted} shrink-0`}>
              · {rows.length} campaign{rows.length === 1 ? "" : "s"}
            </span>
          </span>
        </td>
        <td className={`${TD} ${totalCls}`}>
          {fmtMoney(
            sum((c) => c.dailyBudget ?? 0),
            currency,
          )}
        </td>
        <td className={`${TD} ${totalCls}`}>
          {fmtMoney(
            sum((c) => c.spend),
            currency,
          )}
        </td>
        <td className={`${TD} ${totalCls}`}>{fmtNumber(sum((c) => c.impressions))}</td>
        <td className={`${TD} ${totalCls}`}>{fmtNumber(sum((c) => c.taps))}</td>
        <td className={`${TD} ${totalCls}`}>{fmtNumber(sum((c) => c.installs))}</td>
        <td className={`${TD} ${totalCls}`}>{revenueLoading ? "…" : revenueError ? "—" : fmtNumber(transactions)}</td>
        <td className={`${TD} ${totalCls}`}>{revenueLoading ? "…" : revenueError ? "—" : fmtMoney(proceeds, "USD")}</td>
        <td className={`${TD} relative text-right pr-5`}>
          {removable && (
            <button
              aria-label="Group actions"
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${textMuted} hover:bg-gray-100 dark:hover:bg-white/10 hover:${textPrimary} transition-colors`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenRowMenu(null);
                const pos = menuPos(e);
                setOpenGroupMenu((g) => (g?.id === id ? null : { id, ...pos }));
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          )}
          {openGroupMenu?.id === id && (
            <div
              style={{ position: "fixed", top: openGroupMenu.top, right: openGroupMenu.right }}
              className={`z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[160px] text-left`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                disabled={!canWrite}
                onClick={() => {
                  setOpenGroupMenu(null);
                  setEditingGroup(id);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Rename
              </button>
              <button
                disabled={!canWrite}
                onClick={() => {
                  setOpenGroupMenu(null);
                  handleDeleteGroup(id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete group
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="max-w-[1440px] mx-auto">
      <div className="mb-6">
        <h1 className={`${pageTitle} mb-1`}>Apple Ads</h1>
      </div>

      {!status?.connected ? (
        <div className={`rounded-2xl border ${borderDefault} bg-white dark:bg-[#1c2028] p-5`}>
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl bg-black flex items-center justify-center shrink-0 shadow-sm`}>
              <Megaphone className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[15px] font-bold ${textPrimary}`}>Connect Apple Search Ads</div>
              <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>
                Connect your Apple Search Ads account in Integrations to see campaign spend and performance here.
              </p>
              <Link
                to="/integrations"
                className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#1a1a2e] text-white dark:bg-[#e8eaf0] dark:text-[#1a1a2e] hover:opacity-90 transition-all"
              >
                Go to Integrations
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="flex gap-1 p-1 bg-[#f3f4f6] dark:bg-[#1c2028] rounded-xl">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setRange(opt.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    range === opt.key
                      ? `bg-white dark:bg-[#252b38] ${textPrimary} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
                      : `${textMuted} hover:text-[#6b7280] dark:hover:text-[#8b93a5]`
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
                  className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2]`}
                />
                <span className={`${textMuted} text-[12px]`}>–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className={`h-8 px-2.5 text-[12px] border ${borderDefault} rounded-xl ${textPrimary} bg-white dark:bg-[#1c2028] focus:outline-none focus:border-[#c4c9d4] dark:focus:border-[#595DD2]`}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <StatCard
              label="Spend"
              value={loading ? "—" : fmtMoney(totals.spend, currency)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.spend)}
              icon={<DollarSign className="w-4 h-4" />}
              color="#f59e0b"
            />
            <StatCard
              label="Impressions"
              value={loading ? "—" : fmtNumber(totals.impressions)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.impressions)}
              icon={<Eye className="w-4 h-4" />}
              color="#0ea5e9"
            />
            <StatCard
              label="Taps"
              value={loading ? "—" : fmtNumber(totals.taps)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.taps)}
              icon={<MousePointerClick className="w-4 h-4" />}
              color="#6366f1"
            />
            <StatCard
              label="Installs"
              value={loading ? "—" : fmtNumber(totals.installs)}
              sub={rangeLabel(range)}
              sparkline={days.map((d) => d.installs)}
              icon={<Download className="w-4 h-4" />}
              color="#10b981"
            />
            <StatCard
              label="TTR"
              value={loading ? "—" : totals.impressions > 0 ? fmtPct((totals.taps / totals.impressions) * 100) : "—"}
              sub="Taps / Impressions"
              sparkline={days.map((d) => (d.impressions > 0 ? (d.taps / d.impressions) * 100 : 0))}
              icon={<TrendingUp className="w-4 h-4" />}
              color="#8b5cf6"
            />
            <StatCard
              label="Conversion Rate"
              value={loading ? "—" : totals.taps > 0 ? fmtPct((totals.installs / totals.taps) * 100) : "—"}
              sub="Installs / Taps"
              sparkline={days.map((d) => (d.taps > 0 ? (d.installs / d.taps) * 100 : 0))}
              icon={<Percent className="w-4 h-4" />}
              color="#D94412"
            />
          </div>

          <AdsOverviewChart
            days={days.map((d) => ({ ...d, actions: d.taps }))}
            startDate={dailyData?.startDate}
            endDate={dailyData?.endDate}
            currency={currency}
            loading={dailyLoading}
            actionLabel="Taps"
            rateLabel="TTR"
          />

          <div
            className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] [&_td]:text-[14px] [&_th]:text-[13px]`}
          >
            <div className="px-5 py-4 border-b border-[#f3f4f6] dark:border-[#2a2f3d] flex items-center gap-2">
              <Megaphone className={`w-4 h-4 ${textMuted}`} />
              <div className={`text-[16px] font-semibold ${textPrimary}`}>Campaigns</div>
              <div className="ml-auto flex items-center gap-2">
                {canWrite && (
                  <button onClick={() => setCreatingGroup(true)} className={btnSecSm} title="New group">
                    <FolderPlus className="w-3.5 h-3.5" /> New Group
                  </button>
                )}
                {canManageTeam && (
                  <button onClick={() => setShowCreate(true)} className={btnSecSm}>
                    <Plus className="w-3.5 h-3.5" /> New Campaign
                  </button>
                )}
              </div>
            </div>
            {!bundleId ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                Select an app to see its Apple Search Ads campaigns.
              </div>
            ) : loading ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>Loading…</div>
            ) : error ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>
                Failed to load campaigns — map a campaign group for this app in{" "}
                <Link to="/integrations" className="font-medium text-[#595DD2] hover:underline">
                  Integrations
                </Link>
                .
              </div>
            ) : campaigns.length === 0 ? (
              <div className={`px-5 py-8 text-center text-[13px] ${textMuted}`}>No campaigns found</div>
            ) : (
              <div className="overflow-x-auto">
                {(openRowMenu || openGroupMenu) && <div className="fixed inset-0 z-40" onClick={closeMenus} />}
                <table className="w-full min-w-[1200px] border-collapse table-fixed">
                  <colgroup>
                    <col style={{ width: "30%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "10%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {col("name", "Campaign", "left")}
                      {col("dailyBudget", "Daily Budget")}
                      {col("spend", "Spend")}
                      {col("impressions", "Impressions")}
                      {col("taps", "Taps")}
                      {col("installs", "Installs")}
                      {col("transactions", "Transactions")}
                      {col("proceeds", "Proceeds")}
                      <th className={`${TH} pr-5`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {creatingGroup && (
                      <tr className="bg-gray-50/70 dark:bg-white/[0.02] border-b border-[#f0f1f3] dark:border-[#252a34]">
                        <td colSpan={9} className="px-4 py-2.5">
                          <input
                            autoFocus
                            placeholder="Group name…"
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v) handleCreateGroup(v);
                              setCreatingGroup(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setCreatingGroup(false);
                            }}
                            className={`text-[13px] ${textPrimary} bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-md px-2.5 py-1 outline-none focus:border-[#595DD2] w-56`}
                          />
                        </td>
                      </tr>
                    )}
                    {hasGroups ? (
                      <>
                        {sortedGroups.map((g) => {
                          const rows = sortedCampaigns.filter((c) => c.groupId === g.id);
                          return (
                            <Fragment key={g.id}>
                              {renderGroupHeader(g.id, g.name, rows, true)}
                              {!collapsed.has(g.id) && rows.map(renderRow)}
                            </Fragment>
                          );
                        })}
                        {ungrouped.length > 0 && (
                          <>
                            {renderGroupHeader(UNGROUPED, "Ungrouped", ungrouped, false)}
                            {!collapsed.has(UNGROUPED) && ungrouped.map(renderRow)}
                          </>
                        )}
                      </>
                    ) : (
                      sortedCampaigns.map(renderRow)
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {showCreate && (
            <AnalyticsAdsCreateCampaign
              defaultCurrency={currency}
              onClose={() => setShowCreate(false)}
              onCreated={() => {
                setShowCreate(false);
                refetchCampaigns();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
