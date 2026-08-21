import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePostHog } from "@posthog/react";
import { borderDefault, textMuted, textPrimary, textSecondary } from "./styles";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  useApi,
  apiPost,
  setActiveBundleId,
  getActiveBundleId,
  authHeaders,
  preloadApi,
  clearApiCache,
} from "./hooks/useApi";
import { useClickOutside } from "./hooks/useClickOutside";
import { useToast, ToastContainer } from "./hooks/useToast";
import { PermissionsProvider, getPermissions } from "./hooks/usePermissions";
import Dashboard from "./components/dashboard/Dashboard";
import Suggestions from "./components/suggestions/Suggestions";
import Keywords from "./components/keywords/Keywords";
import Competitors from "./components/competitors/Competitors";
import CompetitorDetailPage from "./components/competitors/CompetitorDetailPage";
import Actions from "./components/Logs";
import Agents from "./components/Agents";
import Settings from "./components/settings/Settings";
import AppSettings from "./components/settings/AppSettings";
import ProfileSettings from "./components/settings/ProfileSettings";
import Billing from "./components/settings/Billing";
import Security from "./components/settings/Security";
import Analytics from "./components/analytics/Analytics";
import AnalyticsDownloads from "./components/analytics/AnalyticsDownloads";
import AnalyticsCountries from "./components/analytics/AnalyticsCountries";
import AnalyticsCountryDetail from "./components/analytics/AnalyticsCountryDetail";
import AnalyticsReviews from "./components/analytics/AnalyticsReviews";
import Versions from "./components/Versions";
import MonetizationSubscriptions from "./components/monetization/Subscriptions";
import MonetizationProducts from "./components/monetization/Products";
import GameCenterLeaderboards from "./components/gamecenter/Leaderboards";
import GameCenterAchievements from "./components/gamecenter/Achievements";
import GameCenterChallenges from "./components/gamecenter/Challenges";
import Login from "./components/login/Login";
import VerifyEmail from "./components/login/VerifyEmail";
import Team from "./components/Team";
import InviteAccept from "./components/InviteAccept";
import Onboarding from "./components/Onboarding";
import SearchModal from "./components/SearchModal";
import AscConnectCard from "./components/AscConnectCard";
import type { AuthUser, DashboardData, AppItem, AscApp, VersionSummary } from "./types";
import {
  LayoutDashboard,
  Layers,
  Search,
  Users,
  Zap,
  BarChart2,
  Settings as SettingsIcon,
  FileText,
  Bot,
  Moon,
  Sun,
  ChevronDown,
  Check,
  Plus,
  X,
  Menu,
  HelpCircle,
  BookOpen,
  MessageSquare,
  LogOut,
  DollarSign,
  Trophy,
  Swords,
  User as UserIcon,
  ArrowLeft,
  CreditCard,
  Shield,
} from "lucide-react";

const sidebarLinks = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/keywords", label: "Keywords", icon: Search },
  { to: "/competitors", label: "Competitors", icon: Users },
  { to: "/suggestions", label: "Suggestions", icon: Layers },
];

const sidebarOperations = [
  { to: "/logs", label: "Logs", icon: Zap },
  { to: "/app-settings", label: "App Settings", icon: SettingsIcon },
];

// Routes whose data comes from the App Store Connect API. Without a key these
// views render empty/broken, so we surface a connect CTA on each of them.
// /dashboard is excluded — it shows its own connect card inside the action plan.
const ASC_REQUIRED_VIEWS: { prefix: string; description: string }[] = [
  {
    prefix: "/versions",
    description:
      "Connect your App Store Connect API key to load and edit your app's versions, metadata and screenshots.",
  },
  {
    prefix: "/monetization",
    description: "Connect your App Store Connect API key to manage subscriptions and in-app purchases.",
  },
  {
    prefix: "/game-center",
    description:
      "Connect your App Store Connect API key to manage Game Center leaderboards, achievements and challenges.",
  },
  {
    prefix: "/analytics",
    description: "Connect your App Store Connect API key to pull downloads, proceeds, impressions and reviews.",
  },
];

function AppAvatar({
  url,
  name,
  size = 9,
  accent,
}: {
  url?: string | null;
  name: string;
  size?: number;
  accent?: boolean;
}) {
  const cls = `shrink-0 rounded-lg object-cover flex items-center justify-center font-bold text-white`;
  const px = `w-${size} h-${size}`;
  return url ? (
    <img src={url} alt="" className={`${px} ${cls}`} />
  ) : (
    <div className={`${px} ${cls} ${accent ? "bg-[#C4001E]" : "bg-[#c8cdd3]"} text-sm`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function AppSwitcher({
  current,
  addToast,
}: {
  current: DashboardData["app"];
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const posthog = usePostHog();
  const { data: apps, refetch: refetchApps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const [open, setOpen] = useState(false);
  const [activeBundleId, setLocalBundle] = useState(getActiveBundleId);
  const [importOpen, setImportOpen] = useState(false);
  const [ascApps, setAscApps] = useState<AscApp[] | null>(null);
  const [ascLoading, setAscLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setOpen(false), []);
  useClickOutside(ref, closeDropdown);

  const ownApps = apps?.filter((a) => a.isOwnApp) ?? [];
  const activeBundleResolved = activeBundleId ?? current?.bundleId ?? null;
  const activeApp = ownApps.find((a) => a.bundleId === activeBundleResolved) ?? (ownApps[0] || null);
  const importedBundleIds = new Set(ownApps.map((a) => a.bundleId));
  const unimportedAscApps = ascApps?.filter((a) => !importedBundleIds.has(a.bundleId)) ?? null;

  const handleSelect = (a: AppItem) => {
    if (a.bundleId !== activeBundleResolved) {
      posthog?.capture("app_switched", { bundle_id: a.bundleId });
    }

    setActiveBundleId(a.bundleId);
    setLocalBundle(a.bundleId);
    setOpen(false);
  };

  const openImport = () => {
    setOpen(false);
    setAscApps(null);
    setImportOpen(true);
    loadAscApps();
  };

  const closeImport = () => {
    setImportOpen(false);
    setAscApps(null);
  };

  const loadAscApps = async () => {
    setAscLoading(true);
    setAscApps(null);
    try {
      const res = await fetch("/api/asc/apps", {
        credentials: "include",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      setAscApps(await res.json());
    } catch (err: any) {
      addToast(`Failed to load apps: ${err.message}`, "error");
    } finally {
      setAscLoading(false);
    }
  };

  const importApp = async (app: AscApp) => {
    setImporting(app.ascId);
    try {
      const result = await apiPost<{
        ok: boolean;
        app: { name: string; bundleId: string };
      }>("/asc/import", {
        ascId: app.ascId,
        bundleId: app.bundleId,
        name: app.name,
      });

      addToast(`"${result.app.name}" imported`, "success");
      setActiveBundleId(result.app.bundleId);
      setLocalBundle(result.app.bundleId);
      refetchApps();
      closeImport();
    } catch (err: any) {
      addToast(`Import failed: ${err.message}`, "error");
    } finally {
      setImporting(null);
    }
  };

  return (
    <>
      <div ref={ref} className="relative mx-2 mb-4">
        <button
          onClick={() => setOpen(!open)}
          className="w-full px-3 py-2.5 bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-xl flex items-center gap-2.5 hover:border-[#d1d5db] dark:hover:border-[#3a4050] transition-colors group"
        >
          {activeApp ? (
            <AppAvatar url={activeApp.iconUrl} name={activeApp.displayName ?? activeApp.name} size={9} accent />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-[#2a2f3d] shrink-0" />
          )}
          <div className="overflow-hidden flex-1 text-left">
            <div className="text-[15px] font-semibold text-[#1a1a2e] dark:text-[#e8eaf0] truncate leading-tight">
              {activeApp?.displayName ?? activeApp?.name ?? current?.displayName ?? current?.name ?? "No app"}
            </div>
            <div className={`text-[11px] ${textMuted} truncate font-mono`}>
              {activeApp?.bundleId ?? current?.bundleId ?? "—"}
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#5c6478]">
              Your Apps
            </div>
            {ownApps.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-[#5c6478]">No apps found</div>
            )}
            {ownApps.map((a) => (
              <button
                key={a.id}
                onClick={() => handleSelect(a)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-left ${a.bundleId === activeBundleResolved ? "bg-[#fef2f3] dark:bg-[#2a1f23]" : ""}`}
              >
                <AppAvatar url={a.iconUrl} name={a.displayName ?? a.name} size={8} accent />
                <div className="overflow-hidden">
                  <div className="text-[13px] font-medium text-[#1a1a2e] dark:text-[#e8eaf0] truncate">
                    {a.displayName ?? a.name}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-[#5c6478] font-mono truncate">{a.bundleId}</div>
                </div>
                {a.bundleId === activeBundleResolved && (
                  <Check className="w-3.5 h-3.5 shrink-0 text-[#C4001E] ml-auto" />
                )}
              </button>
            ))}
            <div className="border-t border-gray-100 dark:border-[#2a2f3d] px-2 py-2">
              <button
                onClick={openImport}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#252b38] flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 text-gray-400 dark:text-[#5c6478]" />
                </div>
                <span className="text-[13px] font-medium text-gray-500 dark:text-[#8b93a5]">Add project</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {importOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 dark:bg-black/60"
            onClick={closeImport}
          >
            <div
              className="bg-white dark:bg-[#1c2028] rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 border-b border-gray-100 dark:border-[#2a2f3d] flex items-center justify-between">
                <div>
                  <h2 className={`text-lg font-bold ${textPrimary}`}>Add project</h2>
                  <p className="text-sm text-gray-500 dark:text-[#8b93a5] mt-0.5">
                    Import an app from App Store Connect.
                  </p>
                </div>
                <button
                  onClick={closeImport}
                  className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-[#252b38] flex items-center justify-center text-gray-400 dark:text-[#5c6478] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-5 flex-1 overflow-y-auto">
                {ascLoading && (
                  <div className="flex items-center justify-center py-8 gap-2 text-gray-400 dark:text-[#5c6478] text-sm">
                    <div className="spinner" /> Loading…
                  </div>
                )}
                {ascApps !== null && unimportedAscApps !== null && unimportedAscApps.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-[#5c6478] text-center py-6">
                    {ascApps.length === 0
                      ? "No apps found. Check your ASC credentials in Settings."
                      : "All apps are already imported."}
                  </p>
                )}
                {unimportedAscApps !== null && unimportedAscApps.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {unimportedAscApps.map((app) => (
                      <div
                        key={app.ascId}
                        className="flex items-center justify-between gap-3 px-4 py-3 bg-[#f7f8fa] dark:bg-[#252b38] rounded-xl border border-gray-200 dark:border-[#2a2f3d]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <AppAvatar url={app.iconUrl} name={app.name} size={9} accent />
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold ${textPrimary} truncate`}>{app.name}</div>
                            <div className="text-[11px] text-gray-400 dark:text-[#5c6478] font-mono">
                              {app.bundleId}
                              {app.primaryLocale ? ` · ${app.primaryLocale}` : ""}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={importing === app.ascId}
                          onClick={() => importApp(app)}
                          className={`shrink-0 px-3 py-1.5 rounded-xl border ${borderDefault} bg-transparent ${textPrimary} text-xs font-medium hover:border-[#C4001E] hover:text-[#C4001E] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {importing === app.ascId ? "Importing…" : "Import"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(ref, closeMenu);

  return (
    <div ref={ref} className="relative mr-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors text-[#374151] dark:text-white/80 text-sm font-medium"
      >
        <HelpCircle className="w-4 h-4 shrink-0" />
        Help
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-48 bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-xl shadow-lg z-50 overflow-hidden py-1">
          <a
            href="https://docs.marteso.com/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-[13px] text-[#1a1a2e] dark:text-[#e8eaf0] font-medium"
          >
            <BookOpen className="w-4 h-4 text-gray-400 dark:text-[#5c6478] shrink-0" />
            Documentation
          </a>
          <a
            href="https://marteso.com/contact"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-[13px] text-[#1a1a2e] dark:text-[#e8eaf0] font-medium"
          >
            <MessageSquare className="w-4 h-4 text-gray-400 dark:text-[#5c6478] shrink-0" />
            Contact Support
          </a>
        </div>
      )}
    </div>
  );
}

function HeaderProfileMenu({
  user,
  onLogout,
  dark,
  onToggleDark,
}: {
  user: AuthUser;
  onLogout: () => void;
  dark: boolean;
  onToggleDark: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(ref, closeMenu);

  const displayName = user.name || user.email || "User";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors text-[#374151] dark:text-white/80 text-sm font-medium"
      >
        <div className="w-6 h-6 rounded-full bg-[#C4001E] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {initials}
        </div>
        <span className="max-w-[120px] truncate">{displayName}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-52 bg-white dark:bg-[#1c2028] border border-[#e5e7eb] dark:border-[#2a2f3d] rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 pt-2.5 pb-1">
            <div className="text-[16px] font-semibold text-[#1a1a2e] dark:text-[#e8eaf0] truncate">{displayName}</div>
            {user.email && <div className={`text-[12px] ${textMuted} truncate`}>{user.email}</div>}
            <div className="mt-1.5 flex items-center gap-1.5">
              {user.teamRole && (
                <span className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#252b38] text-gray-600 dark:text-[#8b93a5]">
                  {user.teamRole}
                </span>
              )}
              <span
                className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  user.plan === "pro"
                    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                    : "bg-gray-100 dark:bg-[#252b38] text-gray-600 dark:text-[#8b93a5]"
                }`}
              >
                {user.plan === "pro" ? "Pro" : "Free"}
              </span>
            </div>
          </div>
          <div className="h-px bg-[#e5e7eb] dark:bg-[#2a2f3d] mx-3 my-1" />
          <NavLink
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-[13px] text-[#1a1a2e] dark:text-[#e8eaf0] font-medium"
          >
            <SettingsIcon className="w-4 h-4 text-gray-400 dark:text-[#5c6478] shrink-0" />
            Settings
          </NavLink>
          <button
            onClick={() => {
              onToggleDark();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#f7f8fa] dark:hover:bg-[#252b38] transition-colors text-[13px] text-[#1a1a2e] dark:text-[#e8eaf0] font-medium"
          >
            {dark ? (
              <Sun className="w-4 h-4 shrink-0 text-gray-400 dark:text-[#5c6478]" />
            ) : (
              <Moon className="w-4 h-4 shrink-0 text-gray-400 dark:text-[#5c6478]" />
            )}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <div className="h-px bg-[#e5e7eb] dark:bg-[#2a2f3d] mx-3 my-1" />
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-red-50 dark:hover:bg-[#2a1f23] transition-colors text-[13px] text-red-500 font-medium"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
          <div className="h-1" />
        </div>
      )}
    </div>
  );
}

const VERSION_STATE_COLORS: Record<string, string> = {
  READY_FOR_SALE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  REPLACED_WITH_NEW_VERSION: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  PREPARE_FOR_SUBMISSION: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  WAITING_FOR_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  IN_REVIEW: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  PENDING_DEVELOPER_RELEASE: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  REJECTED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  DEVELOPER_REJECTED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  METADATA_REJECTED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const VERSION_STATE_SHORT: Record<string, string> = {
  READY_FOR_SALE: "Live",
  REPLACED_WITH_NEW_VERSION: "Replaced",
  PREPARE_FOR_SUBMISSION: "Draft",
  WAITING_FOR_REVIEW: "Review",
  IN_REVIEW: "In Review",
  PENDING_DEVELOPER_RELEASE: "Pending",
  REJECTED: "Rejected",
  DEVELOPER_REJECTED: "Rejected",
  METADATA_REJECTED: "Meta Rejected",
};

function suggestNextVersion(versions: VersionSummary[] | null): string {
  if (!versions || versions.length === 0) return "1.0.0";
  const latest = versions[0];
  const parts = latest.versionString.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1]++;
  return parts.join(".");
}

function AnalyticsSidebarSection({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAnyAnalyticsActive = location.pathname.startsWith("/analytics");

  useEffect(() => {
    if (location.pathname.startsWith("/analytics")) setExpanded(true);
  }, []);

  const subLinks = [
    { to: "/analytics", label: "Overview", end: true },
    { to: "/analytics/downloads", label: "Downloads" },
    { to: "/analytics/countries", label: "Countries" },
    { to: "/analytics/reviews", label: "Reviews" },
  ];

  const handleHeaderClick = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!isAnyAnalyticsActive) navigate(subLinks[0].to);
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <button
          onClick={handleHeaderClick}
          className="flex-1 flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&>svg:first-child]:opacity-60"
        >
          <BarChart2 />
          <span className="flex-1 text-left">Analytics</span>
          <ChevronDown
            className={`!w-3.5 !h-3.5 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded && (
        <div className="ml-3 pl-3 border-l border-[#e5e7eb] dark:border-[#2a2f3d] mb-1 flex flex-col gap-0.5">
          {subLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `flex items-center px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-white text-[#1a1a2e] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#1f242e] dark:text-[#e8eaf0] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                    : "text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0]"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionsSidebarSection({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const [expanded, setExpanded] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newVersionStr, setNewVersionStr] = useState("");
  const [newReleaseType, setNewReleaseType] = useState<"MANUAL" | "AFTER_APPROVAL">("MANUAL");
  const [creating, setCreating] = useState(false);
  const newVersionInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname.startsWith("/versions")) setExpanded(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bundleId = getActiveBundleId();
      const url = bundleId
        ? `/api/asc/versions/list?bundleId=${encodeURIComponent(bundleId)}`
        : "/api/asc/versions/list";
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VersionSummary[] = await res.json();

      data.sort((a, b) => {
        const aParts = a.versionString.split(".").map(Number);
        const bParts = b.versionString.split(".").map(Number);

        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aNum = aParts[i] || 0;
          const bNum = bParts[i] || 0;
          if (aNum !== bNum) return bNum - aNum;
        }

        return 0;
      });

      setVersions(data);

      if (window.location.pathname.startsWith("/versions")) {
        const rawId = window.location.pathname.match(/^\/versions\/(.+)$/)?.[1];
        const currentId = rawId ? decodeURIComponent(rawId) : undefined;
        const onCurrentApp = currentId ? data.some((v) => v.versionId === currentId) : false;

        if (!onCurrentApp) {
          if (data.length > 0) {
            const best = data.find((v) => v.isEditable) ?? data[0];
            navigate(`/versions/${best.versionId}`, { replace: true });
          } else if (currentId) {
            navigate("/versions", { replace: true });
          }
        }
      }

      data.slice(0, 5).forEach((v) => preloadApi(`/asc/versions?versionId=${encodeURIComponent(v.versionId)}`));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (expanded && !versions) load();
  }, [expanded, versions, load]);

  useEffect(() => {
    const handler = () => {
      clearApiCache();
      setVersions(null);
      load();
    };
    window.addEventListener("app-changed", handler);
    return () => window.removeEventListener("app-changed", handler);
  }, [load]);

  const handleToggle = () => {
    if (location.pathname.startsWith("/versions")) {
      const next = !expanded;
      setExpanded(next);
      if (next && !versions) load();
      return;
    }

    setExpanded(true);
    if (versions && versions.length > 0) {
      const best = versions.find((v) => v.isEditable) ?? versions[0];
      navigate(`/versions/${best.versionId}`);
    } else {
      navigate("/versions");
      if (!versions) load();
    }
  };

  const openNewForm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNewVersionStr(suggestNextVersion(versions));
    setNewReleaseType("MANUAL");
    setShowNewForm(true);
    setExpanded(true);
    setTimeout(() => newVersionInputRef.current?.focus(), 50);
  };

  const handleCreate = async () => {
    if (!newVersionStr.trim()) return;
    setCreating(true);
    try {
      const bundleId = getActiveBundleId();
      const res = await fetch("/api/asc/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          bundleId: bundleId ?? undefined,
          versionString: newVersionStr.trim(),
          releaseType: newReleaseType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setShowNewForm(false);
      await load();
      navigate(`/versions/${json.versionId}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <button
          onClick={handleToggle}
          className="flex-1 flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&>svg:first-child]:opacity-60"
        >
          <FileText />
          <span className="flex-1 text-left">Versions</span>
          <ChevronDown
            className={`!w-3.5 !h-3.5 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={openNewForm}
          title="New version"
          className={`p-[7px] rounded-lg ${textMuted} hover:text-[#C4001E] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {showNewForm && (
        <div
          className={`ml-3 mb-2 p-3 bg-white dark:bg-[#1c2028] rounded-xl border ${borderDefault} shadow-sm flex flex-col gap-2`}
        >
          <p className={`text-[11px] font-semibold ${textSecondary} uppercase tracking-wide`}>New Version</p>
          <input
            ref={newVersionInputRef}
            value={newVersionStr}
            onChange={(e) => setNewVersionStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNewForm(false);
            }}
            placeholder="e.g. 2.1.0"
            className={`w-full px-3 py-[7px] text-[13px] rounded-lg border ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#C4001E]`}
          />
          <select
            value={newReleaseType}
            onChange={(e) => setNewReleaseType(e.target.value as "MANUAL" | "AFTER_APPROVAL")}
            className={`w-full px-3 py-[7px] text-[13px] rounded-lg border ${borderDefault} bg-[#fafbfc] dark:bg-[#252b38] ${textPrimary} focus:outline-none focus:border-[#C4001E]`}
          >
            <option value="MANUAL">Manual Release</option>
            <option value="AFTER_APPROVAL">After Approval</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newVersionStr.trim()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-[6px] rounded-lg text-[12px] font-semibold bg-[#C4001E] text-white hover:bg-[#A8001A] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <div className="spinner !w-3 !h-3" /> Creating…
                </>
              ) : (
                "Create"
              )}
            </button>
            <button
              onClick={() => setShowNewForm(false)}
              disabled={creating}
              className={`px-3 py-[6px] rounded-lg text-[12px] font-medium border ${borderDefault} bg-white dark:bg-[#1c2028] ${textSecondary} hover:bg-gray-50 dark:hover:bg-[#252b38] transition-all`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="ml-3 pl-3 border-l border-[#e5e7eb] dark:border-[#2a2f3d] mb-1 flex flex-col gap-0.5">
          {loading && !versions && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-gray-400 dark:text-[#5c6478]">
              <div className="spinner !w-3 !h-3" /> Loading…
            </div>
          )}
          {versions?.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-gray-400 dark:text-[#5c6478]">No versions found</div>
          )}
          {versions?.map((v) => {
            const isActive = location.pathname === `/versions/${v.versionId}`;
            const stateColor =
              VERSION_STATE_COLORS[v.appStoreState] ??
              "bg-gray-100 text-gray-500 dark:bg-[#252b38] dark:text-[#8b93a5]";
            const stateShort = VERSION_STATE_SHORT[v.appStoreState] ?? v.appStoreState;
            return (
              <NavLink
                key={v.versionId}
                to={`/versions/${v.versionId}`}
                className={`flex items-center justify-between gap-2 px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-white text-[#1a1a2e] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#1f242e] dark:text-[#e8eaf0] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                    : "text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0]"
                }`}
              >
                <span className="truncate">{v.versionString}</span>
                <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${stateColor}`}>
                  {stateShort}
                </span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GameCenterSidebarSection({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAnyGcActive = location.pathname.startsWith("/game-center");

  useEffect(() => {
    if (location.pathname.startsWith("/game-center")) setExpanded(true);
  }, []);

  const subLinks = [
    { to: "/game-center/leaderboards", label: "Leaderboards" },
    { to: "/game-center/achievements", label: "Achievements" },
    { to: "/game-center/challenges", label: "Challenges" },
  ];

  const handleHeaderClick = () => {
    if (isAnyGcActive) {
      setExpanded((v) => !v);
    } else {
      setExpanded(true);
      navigate(subLinks[0].to);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <button
          onClick={handleHeaderClick}
          className="flex-1 flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&>svg:first-child]:opacity-60"
        >
          <Trophy />
          <span className="flex-1 text-left">Game Center</span>
          <ChevronDown
            className={`!w-3.5 !h-3.5 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded && (
        <div className="ml-3 pl-3 border-l border-[#e5e7eb] dark:border-[#2a2f3d] mb-1 flex flex-col gap-0.5">
          {subLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-white text-[#1a1a2e] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#1f242e] dark:text-[#e8eaf0] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                    : "text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0]"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function MoreSidebarSection({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith("/game-center")) setExpanded(true);
  }, []);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&>svg:first-child]:opacity-60"
      >
        <Swords />
        <span className="flex-1 text-left">More</span>
        <ChevronDown
          className={`!w-3.5 !h-3.5 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="ml-3 pl-3 border-l border-[#e5e7eb] dark:border-[#2a2f3d] mb-1 flex flex-col gap-0.5">
          <GameCenterSidebarSection navLinkClass={navLinkClass} />
        </div>
      )}
    </div>
  );
}

function MonetizationSidebarSection({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAnyMonetizationActive = location.pathname.startsWith("/monetization");

  useEffect(() => {
    if (location.pathname.startsWith("/monetization")) setExpanded(true);
  }, []);

  const subLinks = [
    { to: "/monetization/subscriptions", label: "Subscriptions" },
    { to: "/monetization/products", label: "Products" },
  ];

  const handleHeaderClick = () => {
    if (isAnyMonetizationActive) {
      setExpanded((v) => !v);
    } else {
      setExpanded(true);
      navigate(subLinks[0].to);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <button
          onClick={handleHeaderClick}
          className="flex-1 flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&>svg:first-child]:opacity-60"
        >
          <DollarSign />
          <span className="flex-1 text-left">Monetization</span>
          <ChevronDown
            className={`!w-3.5 !h-3.5 shrink-0 text-gray-400 dark:text-[#5c6478] transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded && (
        <div className="ml-3 pl-3 border-l border-[#e5e7eb] dark:border-[#2a2f3d] mb-1 flex flex-col gap-0.5">
          {subLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center px-2.5 py-[7px] rounded-lg text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-white text-[#1a1a2e] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#1f242e] dark:text-[#e8eaf0] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                    : "text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0]"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsSidebar({ navLinkClass }: { navLinkClass: (p: { isActive: boolean }) => string }) {
  const navigate = useNavigate();
  const settingsLinks = [
    { to: "/settings/profile", label: "Profile", icon: UserIcon },
    { to: "/settings/security", label: "Security", icon: Shield },
    { to: "/settings/team-settings", label: "Team Settings", icon: SettingsIcon },
    { to: "/settings/team", label: "Team", icon: Users },
    { to: "/settings/agents", label: "Agents", icon: Bot },
    { to: "/settings/billing", label: "Billing", icon: CreditCard },
  ];

  return (
    <nav className="px-2 pt-1 flex-1 flex flex-col">
      <button
        onClick={() => navigate("/dashboard")}
        className="flex items-center gap-2 px-3 py-[9px] mb-2 rounded-lg text-sm font-medium text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] transition-all"
      >
        <ArrowLeft className="w-[18px] h-[18px] opacity-60" />
        Back
      </button>
      <div className="px-3 pb-2 text-[12px] font-semibold text-gray-400 dark:text-[#5c6478]">Settings</div>
      {settingsLinks.map((link) => (
        <NavLink key={link.to} to={link.to} className={navLinkClass}>
          <link.icon />
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const posthog = usePostHog();
  const { data: dash } = useApi<DashboardData>("/dashboard");
  const { toasts, addToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });
  const inSettings = location.pathname.startsWith("/settings");

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const checkOnboarding = async (forUser?: AuthUser) => {
    if (forUser?.isDemo) return;
    try {
      const [settingsRes, appsRes] = await Promise.all([
        fetch("/api/settings", { credentials: "include" }),
        fetch("/api/apps?ownOnly=true", { credentials: "include" }),
      ]);

      const settings = settingsRes.ok ? await settingsRes.json() : null;
      const apps: { isOwnApp: boolean }[] = appsRes.ok ? await appsRes.json() : [];
      if (apps.some((a) => a.isOwnApp)) return;

      const step: 1 | 2 = settings?.ascPrivateKeySet ? 2 : 1;
      setOnboardingStep(step);
      setShowOnboarding(true);
    } catch {
      // don't block login on error
    }
  };

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  useEffect(() => {
    const hex = dash?.app?.accentColor;
    if (hex) {
      document.documentElement.style.setProperty("--app-accent", hex);
    } else {
      document.documentElement.style.removeProperty("--app-accent");
    }
  }, [dash?.app?.accentColor]);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (
      hash.includes("gh_done=") ||
      hash.includes("gh_error=") ||
      hash.includes("gg_done=") ||
      hash.includes("gg_error=")
    ) {
      const params = new URLSearchParams(hash);
      const oauthError = params.get("gh_error") ?? params.get("gg_error");
      const isNew = params.get("gh_new") === "1" || params.get("gg_new") === "1";
      const userEncoded = params.get("user");

      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      if (oauthError) {
        setAuthLoading(false);
        return;
      }

      if (userEncoded) {
        try {
          const b64 = userEncoded.replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
          const decoded = JSON.parse(atob(padded));

          setUser(decoded);
          setAuthLoading(false);

          const oauthMethod = hash.includes("gh_") ? "github" : "google";
          posthog?.identify(decoded.id, { email: decoded.email, name: decoded.name ?? undefined });
          posthog?.capture(isNew ? "user_signed_up" : "user_logged_in", { method: oauthMethod });
          if (isNew) checkOnboarding(decoded);
          return;
        } catch {
          // fall through to /me fetch
        }
      }
    }

    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        setAuthLoading(false);
        if (u) checkOnboarding(u);
      })
      .catch(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleLogout = () => {
    posthog?.capture("user_logged_out");
    posthog?.reset();
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setUser(null);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8f9fb] dark:bg-[#0f1117]">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    const hash = window.location.hash;
    const inviteMatch = hash.match(/^#\/invite\/([a-f0-9]+)$/);

    if (inviteMatch) {
      return <InviteAccept onAuth={(u) => setUser(u)} />;
    }

    const handleAuth = (u: AuthUser) => {
      setUser(u);
      checkOnboarding(u);
    };

    return (
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail onAuth={handleAuth} />} />
        <Route path="/signup" element={<Login mode="signup" onAuth={handleAuth} />} />
        <Route path="/login" element={<Login mode="login" onAuth={handleAuth} />} />
        <Route path="*" element={<Login mode="login" onAuth={handleAuth} />} />
      </Routes>
    );
  }

  if (showOnboarding) {
    const finishOnboarding = () => {
      clearApiCache();
      setShowOnboarding(false);
      navigate("/dashboard");
    };
    return <Onboarding initialStep={onboardingStep} onComplete={finishOnboarding} />;
  }

  const ascRequiredView = ASC_REQUIRED_VIEWS.find((v) => location.pathname.startsWith(v.prefix));
  const hasASC = dash?.config?.hasASC ?? true;
  const showAscBanner = !hasASC && !!ascRequiredView && !user.isDemo;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-sm font-medium mb-0.5 transition-all [&_svg]:w-[18px] [&_svg]:h-[18px] ${
      isActive
        ? "bg-white text-[#1a1a2e] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#1f242e] dark:text-[#e8eaf0] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)] [&_svg]:opacity-100"
        : "text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-[#e8eaf0] [&_svg]:opacity-60"
    }`;

  return (
    <PermissionsProvider value={getPermissions(user)}>
      <div className="flex flex-col h-screen overflow-hidden bg-[var(--shell-bg)] transition-colors">
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        <ToastContainer toasts={toasts} />
        {user.email === "demo@marteso.com" && (
          <div className="shrink-0 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 px-4 py-2 flex items-center justify-center gap-3 text-sm text-amber-800 dark:text-amber-300">
            <span>You are using a Demo Account - Changes are not saved.</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
                setUser(null);
              }}
              className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
            >
              Create Your Own Account
            </a>
          </div>
        )}
        {/*demo@marteso.com*/}
        <header className="h-[52px] bg-[var(--shell-bg)] flex items-center px-4 shrink-0 transition-colors">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="lg:hidden mr-1 -ml-1 p-2 rounded-lg text-[#374151] dark:text-white/80 hover:bg-black/[0.06] dark:hover:bg-white/10 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <a href="/" className="flex items-center">
            <img src="/logo-wordmark.svg" alt="Marteso" className="h-[28px] w-auto" />
          </a>
          <div className="flex-1" />
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex items-center gap-2 bg-black/[0.06] dark:bg-white/10 rounded-md px-3 py-1.5 text-sm text-[#6b7280] dark:text-white/50 w-44 mr-3 cursor-pointer select-none hover:bg-black/[0.09] dark:hover:bg-white/[0.15] transition-colors"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>Search…</span>
            <span className="ml-auto text-[10px] bg-black/[0.08] dark:bg-white/20 rounded px-1 py-0.5 font-mono">
              ⌘K
            </span>
          </button>
          <HelpMenu />
          <HeaderProfileMenu user={user} onLogout={handleLogout} dark={dark} onToggleDark={() => setDark((d) => !d)} />
        </header>
        <div className="flex flex-1 min-h-0">
          {mobileNavOpen && (
            <div
              onClick={() => setMobileNavOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              aria-hidden="true"
            />
          )}
          <aside
            className={`fixed lg:static inset-y-0 left-0 z-50 lg:z-auto w-[250px] min-w-[250px] bg-[var(--shell-bg)] flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out lg:translate-x-0 lg:shadow-none lg:transition-colors ${
              mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
            }`}
          >
            <div className="lg:hidden flex justify-end px-2 pt-2">
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="p-2 rounded-lg text-[#374151] dark:text-[#c4cad8] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {inSettings ? (
              <SettingsSidebar navLinkClass={navLinkClass} />
            ) : (
              <>
                <AppSwitcher current={dash?.app ?? null} addToast={addToast} />
                <nav className="px-2 pt-1 flex-1 flex flex-col">
                  {sidebarLinks.slice(0, 1).map((link) => (
                    <NavLink key={link.to} to={link.to} className={navLinkClass}>
                      {link.icon && <link.icon />}
                      {link.label}
                    </NavLink>
                  ))}
                  <AnalyticsSidebarSection navLinkClass={navLinkClass} />
                  {sidebarLinks.slice(1).map((link) => (
                    <NavLink key={link.to} to={link.to} className={navLinkClass}>
                      {link.icon && <link.icon />}
                      {link.label}
                    </NavLink>
                  ))}
                  <MonetizationSidebarSection navLinkClass={navLinkClass} />
                  <VersionsSidebarSection navLinkClass={navLinkClass} />
                  <MoreSidebarSection navLinkClass={navLinkClass} />
                  <div className="mt-auto pb-3">
                    <div className="h-px bg-[#eef0f3] dark:bg-[#2a2f3d] mx-1 mb-2 mt-1" />
                    {sidebarOperations.map((link) => (
                      <NavLink key={link.to} to={link.to} className={navLinkClass}>
                        {link.icon && <link.icon />}
                        {link.label}
                      </NavLink>
                    ))}
                  </div>
                </nav>
              </>
            )}
          </aside>

          <main className="relative z-30 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-7 sm:py-6 bg-white dark:bg-[#0f1117] rounded-tl-2xl border-t border-l border-[rgba(16,24,40,0.06)] dark:border-[rgba(255,255,255,0.05)] shadow-[-4px_-4px_14px_-8px_rgba(16,24,40,0.05),0_-6px_16px_-8px_rgba(16,24,40,0.07)] dark:shadow-[-4px_-4px_14px_-8px_rgba(0,0,0,0.3),0_-6px_16px_-8px_rgba(0,0,0,0.35)]">
            {showAscBanner && ascRequiredView && (
              <AscConnectCard className="mb-5" description={ascRequiredView.description} />
            )}
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/suggestions" element={<Suggestions addToast={addToast} />} />
              <Route path="/keywords" element={<Keywords addToast={addToast} isPro={user.plan === "pro"} />} />
              <Route path="/competitors" element={<Competitors addToast={addToast} />} />
              <Route path="/competitors/:id" element={<CompetitorDetailPage addToast={addToast} />} />
              <Route path="/analytics" element={<Analytics addToast={addToast} />} />
              <Route path="/analytics/downloads" element={<AnalyticsDownloads />} />
              <Route path="/analytics/countries" element={<AnalyticsCountries />} />
              <Route path="/analytics/countries/:country" element={<AnalyticsCountryDetail />} />
              <Route path="/analytics/reviews" element={<AnalyticsReviews />} />
              <Route path="/versions/:versionId" element={<Versions addToast={addToast} />} />
              <Route path="/versions" element={<Versions addToast={addToast} />} />
              <Route path="/monetization/subscriptions" element={<MonetizationSubscriptions addToast={addToast} />} />
              <Route path="/monetization/products" element={<MonetizationProducts addToast={addToast} />} />
              <Route path="/game-center/leaderboards" element={<GameCenterLeaderboards addToast={addToast} />} />
              <Route path="/game-center/achievements" element={<GameCenterAchievements addToast={addToast} />} />
              <Route path="/game-center/challenges" element={<GameCenterChallenges addToast={addToast} />} />
              <Route path="/logs" element={<Actions addToast={addToast} />} />
              <Route path="/app-settings" element={<AppSettings addToast={addToast} />} />
              <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
              <Route
                path="/settings/profile"
                element={<ProfileSettings user={user} onUserUpdate={(u) => setUser(u)} addToast={addToast} />}
              />
              <Route path="/settings/team-settings" element={<Settings addToast={addToast} />} />
              <Route path="/settings/team" element={<Team addToast={addToast} currentUserId={user.id} />} />
              <Route path="/settings/agents" element={<Agents addToast={addToast} />} />
              <Route path="/settings/security" element={<Security addToast={addToast} />} />
              <Route path="/settings/billing" element={<Billing addToast={addToast} />} />
              <Route path="/invite/:token" element={<InviteAccept onAuth={(u) => setUser(u)} />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
