import { useEffect, useRef, useState } from "react";
import {
  Check,
  Search,
  ArrowLeft,
  ArrowRight,
  Star,
  Type,
  Tag,
  Image as ImageIcon,
  Users,
  AlignLeft,
  TrendingUp,
  Globe,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { authHeaders, setActiveBundleId } from "../hooks/useApi";
import { borderDefault, btnPrimary, btnSecondary, inputCls, textMuted, textPrimary, textSecondary } from "../styles";
import type { StoreApp } from "../types";
import { usePostHog } from "@posthog/react";

interface Props {
  onComplete: () => void;
  initialStep?: 1 | 2;
}

/* ──────────────────────────────────────────────────────────────────────────
 * OLD ASC-API based onboarding — kept for reference, replaced by the App Store
 * search flow below. Previously we asked the user for their App Store Connect
 * API credentials (Issuer ID, Key ID, .p8 private key, vendor number) and then
 * listed the apps from their ASC account to import.
 *
 * import type { AscApp } from "../types";
 *
 * interface AscForm {
 *   ascIssuerId: string;
 *   ascKeyId: string;
 *   ascPrivateKey: string;
 *   ascVendorNumber: string;
 * }
 *
 * function StepIndicator({ step }: { step: 1 | 2 }) {
 *   return (
 *     <div className="flex items-center gap-3 mb-8">
 *       <div className="flex items-center gap-2">
 *         <div
 *           className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
 *             step >= 1
 *               ? "bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white"
 *               : "bg-[#eef0f3] dark:bg-[#2a2f3d] text-[#9ca3af]"
 *           }`}
 *         >
 *           {step > 1 ? <Check className="w-3 h-3" /> : "1"}
 *         </div>
 *         <span className={`text-sm font-medium ${step >= 1 ? textPrimary : "text-[#9ca3af]"}`}>
 *           App Store Connect
 *         </span>
 *       </div>
 *       <div className="flex-1 h-px bg-[#eef0f3] dark:bg-[#2a2f3d]" />
 *       <div className="flex items-center gap-2">
 *         <div
 *           className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
 *             step >= 2
 *               ? "bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white"
 *               : "bg-[#eef0f3] dark:bg-[#2a2f3d] text-[#9ca3af]"
 *           }`}
 *         >
 *           2
 *         </div>
 *         <span className={`text-sm font-medium ${step >= 2 ? textPrimary : "text-[#9ca3af]"}`}>Import App</span>
 *       </div>
 *     </div>
 *   );
 * }
 *
 * // inside the component:
 * const [form, setForm] = useState<AscForm>({
 *   ascIssuerId: "",
 *   ascKeyId: "",
 *   ascPrivateKey: "",
 *   ascVendorNumber: "",
 * });
 * const [saving, setSaving] = useState(false);
 * const [saveError, setSaveError] = useState<string | null>(null);
 * const [apps, setApps] = useState<AscApp[] | null>(null);
 * const [appsLoading, setAppsLoading] = useState(false);
 *
 * const loadApps = async () => {
 *   setAppsLoading(true);
 *   setAppsError(null);
 *   try {
 *     const res = await fetch("/api/asc/apps", { headers: authHeaders() });
 *     const data = await res.json();
 *     if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
 *     setApps(data);
 *   } catch (err: any) {
 *     setAppsError(err.message ?? "Failed to load apps");
 *   } finally {
 *     setAppsLoading(false);
 *   }
 * };
 *
 * useEffect(() => {
 *   if (step === 2) loadApps();
 * }, [step]);
 *
 * const handleSaveCredentials = async (e: React.FormEvent) => {
 *   e.preventDefault();
 *   setSaveError(null);
 *   if (!form.ascIssuerId || !form.ascKeyId || !form.ascPrivateKey) {
 *     setSaveError("Issuer ID, Key ID, and Private Key are required.");
 *     return;
 *   }
 *   setSaving(true);
 *   try {
 *     const res = await fetch("/api/settings", {
 *       method: "PUT",
 *       headers: { "Content-Type": "application/json", ...authHeaders() },
 *       body: JSON.stringify(form),
 *     });
 *     const data = await res.json();
 *     if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
 *     setStep(2);
 *   } catch (err: any) {
 *     setSaveError(err.message ?? "Failed to save credentials");
 *   } finally {
 *     setSaving(false);
 *   }
 * };
 *
 * // Step 1 — ASC credentials form
 * {step === 1 && (
 *   <>
 *     <div className="mb-6">
 *       <h1 className={`text-xl font-bold ${textPrimary}`}>Connect App Store Connect</h1>
 *       <p className={`text-sm ${textSecondary} mt-1`}>
 *         Enter your API credentials to sync your apps and metadata. You'll find these in{" "}
 *         <span className="font-medium text-[#374151] dark:text-[#c5cad6]">
 *           App Store Connect → Users & Access → Integrations
 *         </span>
 *         .
 *       </p>
 *     </div>
 *
 *     <form onSubmit={handleSaveCredentials} className="flex flex-col gap-4">
 *       <div className="grid grid-cols-2 gap-4">
 *         <label className="flex flex-col gap-1.5">
 *           <span className={`text-sm font-medium ${textPrimary}`}>Issuer ID</span>
 *           <input
 *             className={inputCls}
 *             type="text"
 *             placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 *             value={form.ascIssuerId}
 *             onChange={(e) => setForm((f) => ({ ...f, ascIssuerId: e.target.value }))}
 *           />
 *         </label>
 *         <label className="flex flex-col gap-1.5">
 *           <span className={`text-sm font-medium ${textPrimary}`}>Key ID</span>
 *           <input
 *             className={inputCls}
 *             type="text"
 *             placeholder="XXXXXXXXXX"
 *             value={form.ascKeyId}
 *             onChange={(e) => setForm((f) => ({ ...f, ascKeyId: e.target.value }))}
 *           />
 *         </label>
 *       </div>
 *
 *       <label className="flex flex-col gap-1.5">
 *         <span className={`text-sm font-medium ${textPrimary}`}>
 *           Vendor Number
 *           <span className="ml-1 text-[11px] font-normal text-[#9ca3af]">
 *             (Payments &amp; Financial Reports)
 *           </span>
 *         </span>
 *         <input
 *           className={inputCls}
 *           type="text"
 *           placeholder="12345678"
 *           value={form.ascVendorNumber}
 *           onChange={(e) => setForm((f) => ({ ...f, ascVendorNumber: e.target.value }))}
 *         />
 *       </label>
 *
 *       <label className="flex flex-col gap-1.5">
 *         <span className={`text-sm font-medium ${textPrimary}`}>Private Key (.p8)</span>
 *         <p className={`text-[11px] ${textMuted} -mt-0.5`}>
 *           Paste the full contents of your AuthKey_XXXXXX.p8 file.
 *         </p>
 *         <textarea
 *           className={textareaCls}
 *           rows={5}
 *           placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
 *           value={form.ascPrivateKey}
 *           onChange={(e) => setForm((f) => ({ ...f, ascPrivateKey: e.target.value }))}
 *         />
 *       </label>
 *
 *       {saveError && (
 *         <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-2.5">
 *           {saveError}
 *         </div>
 *       )}
 *
 *       <button type="submit" disabled={saving} className={`${btnPrimary} w-full justify-center mt-1`}>
 *         {saving ? "Saving…" : "Continue →"}
 *       </button>
 *     </form>
 *   </>
 * )}
 * ────────────────────────────────────────────────────────────────────────── */

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="flex items-center gap-2">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 1
              ? "bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white"
              : "bg-[#eef0f3] dark:bg-[#2a2f3d] text-[#9ca3af]"
          }`}
        >
          {step > 1 ? <Check className="w-3 h-3" /> : "1"}
        </div>
        <span className={`text-sm font-medium ${step >= 1 ? textPrimary : "text-[#9ca3af]"}`}>Find your app</span>
      </div>
      <div className="flex-1 h-px bg-[#eef0f3] dark:bg-[#2a2f3d]" />
      <div className="flex items-center gap-2">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 2
              ? "bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white"
              : "bg-[#eef0f3] dark:bg-[#2a2f3d] text-[#9ca3af]"
          }`}
        >
          2
        </div>
        <span className={`text-sm font-medium ${step >= 2 ? textPrimary : "text-[#9ca3af]"}`}>Confirm</span>
      </div>
    </div>
  );
}

function AppAvatar({ url, name, size = "md" }: { url?: string | null; name: string; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "w-16 h-16 rounded-2xl text-lg" : "w-10 h-10 rounded-xl text-sm";
  return url ? (
    <img src={url} alt="" className={`${cls} object-cover shrink-0`} />
  ) : (
    <div
      className={`${cls} bg-gradient-to-br from-[#6E72E4] to-[#595DD2] flex items-center justify-center text-white font-bold shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

type Impact = "high" | "med" | "low";

interface ScanFinding {
  key: string;
  title: string;
  desc: string;
  impact: Impact;
  suggestion?: string;
}

interface ScanData {
  ready: true;
  app: {
    name: string;
    iconUrl: string | null;
    rating: number | null;
    ratingsCount: number | null;
    category: string | null;
  } | null;
  score: number;
  target: number;
  findings: ScanFinding[];
  aiSummary?: string | null;
}

const FINDING_ICONS: Record<string, LucideIcon> = {
  keyword: Search,
  title: Type,
  subtitle: Tag,
  screenshots: ImageIcon,
  competitor: Users,
  description: AlignLeft,
  localization: Globe,
};

const IMPACT_STYLE: Record<Impact, { cls: string; dot: string; label: string }> = {
  high: { cls: "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400", dot: "bg-red-500", label: "High impact" },
  med: {
    cls: "text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400",
    dot: "bg-amber-500",
    label: "Medium",
  },
  low: {
    cls: "text-slate-600 bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400",
    dot: "bg-slate-400",
    label: "Minor",
  },
};

const SCAN_STEPS = [
  "Reading your App Store listing",
  "Checking keyword coverage",
  "Scanning competitor rankings",
  "Calculating your ASO score",
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117] px-4">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center justify-center mb-8">
          <img src="/logo-wordmark.svg" alt="Marteso" className="h-[38px] w-auto" />
        </div>
        {children}
      </div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const size = 116;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value < 70 ? "#f59e0b" : "#10b981";
  const [off, setOff] = useState(c);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setOff(c - (value / 100) * c), reduce ? 0 : 150);
    return () => clearTimeout(t);
  }, [value, c]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="text-[#eef0f3] dark:text-[#2a2f3d]"
          stroke="currentColor"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.22,.61,.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${textPrimary}`}>{value}</span>
        <span className={`text-[11px] ${textMuted}`}>/ 100</span>
      </div>
    </div>
  );
}

function ScanScreen({
  bundleId,
  onDone,
  onSkip,
}: {
  bundleId: string;
  onDone: (data: ScanData) => void;
  onSkip: () => void;
}) {
  const [pct, setPct] = useState(0);
  const dataRef = useRef<ScanData | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    (async () => {
      while (!cancelled && !dataRef.current && Date.now() - started < 30000) {
        try {
          const res = await fetch(`/api/asc/scan?bundleId=${encodeURIComponent(bundleId)}`, {
            headers: authHeaders(),
          });
          const d = await res.json();
          if (res.ok && d.ready) {
            dataRef.current = d as ScanData;
            break;
          }
        } catch {
          /* keep polling */
        }
        await new Promise((r) => setTimeout(r, 1200));
      }

      if (!cancelled && !dataRef.current) onSkip();
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => {
      setPct((p) => {
        const ceiling = dataRef.current ? 100 : 90;
        if (p >= ceiling) return ceiling;
        const inc = reduce ? 40 : p > 80 ? 0.8 : p > 60 ? 1.3 : 2;
        return Math.min(ceiling, p + inc);
      });
    }, 55);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (pct >= 100 && dataRef.current && !doneRef.current) {
      doneRef.current = true;
      const t = setTimeout(() => onDone(dataRef.current!), 500);
      return () => clearTimeout(t);
    }
  }, [pct]);

  const cur = Math.min(SCAN_STEPS.length - 1, Math.floor(pct / 25));

  return (
    <Shell>
      <div className={`bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-8`}>
        <div className="flex flex-col items-center text-center">
          <div className="relative w-16 h-16 flex items-center justify-center mb-5">
            <span className="absolute inset-0 rounded-2xl bg-[#595DD2]/20 animate-ping" />
            <span className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6E72E4] to-[#595DD2] flex items-center justify-center">
              <Search className="w-7 h-7 text-white" />
            </span>
          </div>
          <div className={`text-lg font-bold ${textPrimary}`}>Scanning your App Store presence…</div>
          <div className={`text-sm ${textSecondary} mt-1`}>{SCAN_STEPS[cur]}</div>

          <div className="w-full h-2 rounded-full bg-[#eef0f3] dark:bg-[#2a2f3d] mt-6 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#6E72E4] to-[#595DD2] transition-[width] duration-200"
              style={{ width: pct + "%" }}
            />
          </div>
          <div className={`text-xs ${textMuted} mt-2 self-end`}>{Math.round(pct)}%</div>

          <div className="w-full flex flex-col gap-2.5 mt-6">
            {SCAN_STEPS.map((s, i) => {
              const done = pct >= (i + 1) * 25;
              const active = !done && cur === i;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2.5 text-[13px] ${done || active ? textPrimary : textMuted}`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                          ? "border-2 border-[#595DD2]"
                          : "border-2 border-[#eef0f3] dark:border-[#2a2f3d]"
                    }`}
                  >
                    {done ? (
                      <Check className="w-3 h-3" />
                    ) : active ? (
                      <span className="w-2 h-2 rounded-full bg-[#595DD2] animate-pulse" />
                    ) : null}
                  </span>
                  {s}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function ResultsScreen({ data, onContinue }: { data: ScanData; onContinue: () => void }) {
  const { app, score, target, findings, aiSummary } = data;
  const appName = app?.name ?? "your app";
  return (
    <Shell>
      <div className={`bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-8`}>
        <div className={`text-[11px] font-semibold uppercase tracking-[0.09em] ${textMuted} mb-5`}>
          Quick scan complete
        </div>

        <div className="flex items-center gap-5 mb-5">
          <ScoreRing value={score} />
          <div className="min-w-0">
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>ASO score</div>
            <div className={`text-xl font-bold ${textPrimary} mt-0.5`}>
              {score < 50 ? "Plenty of upside" : score < 75 ? "Solid, room to grow" : "Looking strong"}
            </div>
            <p className={`text-sm ${textSecondary} mt-1`}>
              We found {findings.length} {findings.length === 1 ? "opportunity" : "opportunities"} for {appName}, ranked
              by impact.
            </p>
            <div className="inline-flex items-center gap-1.5 mt-2.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-full px-2.5 py-1">
              <TrendingUp className="w-3 h-3" /> ~{target}/100 within reach
            </div>
          </div>
        </div>

        {aiSummary && (
          <div className="flex items-start gap-2.5 mb-5 px-4 py-3 rounded-xl bg-gradient-to-br from-[#595DD2]/[0.06] to-[#595DD2]/[0.06] border border-[#595DD2]/15">
            <Sparkles className="w-4 h-4 text-[#595DD2] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className={`text-[11px] font-semibold uppercase tracking-wide ${textMuted}`}>AI review</div>
              <p className={`text-[13px] ${textSecondary} leading-snug mt-0.5`}>{aiSummary}</p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {findings.map((f) => {
            const Icon = FINDING_ICONS[f.key] ?? Search;
            const style = IMPACT_STYLE[f.impact] ?? IMPACT_STYLE.med;
            return (
              <div
                key={f.key}
                className={`flex items-start gap-3.5 px-4 py-3 bg-[#f7f8fa] dark:bg-[#252b38] rounded-xl border ${borderDefault}`}
              >
                <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#1c2028] border border-[#eef0f3] dark:border-[#2a2f3d] flex items-center justify-center text-[#595DD2] shrink-0">
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className={`text-sm font-semibold ${textPrimary}`}>{f.title}</div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${style.cls}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      {style.label}
                    </span>
                  </div>
                  <div className={`text-[12.5px] ${textSecondary} leading-snug mt-0.5`}>{f.desc}</div>
                  {f.suggestion && (
                    <div className="mt-2 flex items-start gap-1.5 text-[12px] bg-[#595DD2]/[0.05] rounded-lg px-2.5 py-1.5">
                      <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-[#595DD2]" />
                      <span className={textSecondary}>
                        <span className="font-semibold text-[#595DD2] dark:text-orange-300">Try:</span> {f.suggestion}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={onContinue} className={`${btnPrimary} w-full justify-center mt-6 !py-2.5 !text-[15px]`}>
          View full analysis
          <ArrowRight className="w-4 h-4" />
        </button>
        <p className={`text-center text-xs ${textMuted} mt-3`}>
          Based on a live scan of your public App Store listing.
        </p>
      </div>
    </Shell>
  );
}

export default function Onboarding({ onComplete }: Props) {
  const posthog = usePostHog();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<StoreApp[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreApp | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"setup" | "scan" | "results">("setup");
  const [importedBundle, setImportedBundle] = useState<string | null>(null);
  const [scanData, setScanData] = useState<ScanData | null>(null);

  const step: 1 | 2 = selected ? 2 : 1;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);

    try {
      const res = await fetch(`/api/asc/store-search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data);
    } catch (err: any) {
      setSearchError(err.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleImport = async (app: StoreApp) => {
    setImporting(true);
    setImportError(null);

    try {
      const res = await fetch("/api/asc/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ascId: app.trackId,
          bundleId: app.bundleId,
          name: app.name,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      posthog?.capture("app_imported", { bundle_id: app.bundleId, app_name: app.name });
      setActiveBundleId(app.bundleId);
      setImportedBundle(app.bundleId);
      setPhase("scan");
    } catch (err: any) {
      setImportError(err.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleOnboardingComplete = (completedScan: boolean) => {
    posthog?.capture("onboarding_completed", { completed_scan: completedScan });
    onComplete();
  };

  if (phase === "scan" && importedBundle) {
    return (
      <ScanScreen
        bundleId={importedBundle}
        onSkip={() => handleOnboardingComplete(false)}
        onDone={(d) => {
          posthog?.capture("aso_scan_completed", {
            bundle_id: importedBundle,
            score: d.score,
            target: d.target,
            findings_count: d.findings.length,
            high_impact_findings: d.findings.filter((f) => f.impact === "high").length,
          });

          setScanData(d);
          setPhase("results");
        }}
      />
    );
  }

  if (phase === "results" && scanData) {
    return <ResultsScreen data={scanData} onContinue={() => handleOnboardingComplete(true)} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb] dark:bg-[#0f1117] px-4">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center justify-center mb-8">
          <img src="/logo-wordmark.svg" alt="Marteso" className="h-[38px] w-auto" />
        </div>

        <div className={`bg-white dark:bg-[#1c2028] rounded-2xl shadow-xl border ${borderDefault} p-8`}>
          <StepIndicator step={step} />

          {!selected && (
            <>
              <div className="mb-6">
                <h1 className={`text-2xl font-bold ${textPrimary}`}>Find your app</h1>
                <p className={`text-md ${textSecondary} mt-1`}>
                  Search by app name or paste your App Store link to import your first app.
                </p>
              </div>

              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  type="text"
                  autoFocus
                  placeholder="App name or https://apps.apple.com/…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" disabled={searching || !query.trim()} className={`${btnPrimary} shrink-0 !px-4`}>
                  <Search className="w-4 h-4" />
                  {searching ? "Searching…" : "Search"}
                </button>
              </form>

              {searchError && (
                <div className="mt-4 bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-2.5">
                  {searchError}
                </div>
              )}

              {searching && (
                <div className={`flex items-center justify-center py-10 gap-2 ${textMuted} text-sm`}>
                  <div className="spinner" /> Searching the App Store…
                </div>
              )}

              {!searching && results !== null && results.length === 0 && (
                <div className={`text-center py-10 text-sm ${textMuted}`}>
                  No apps found. Try a different name or paste the App Store link.
                </div>
              )}

              {!searching && results && results.length > 0 && (
                <div className="flex flex-col gap-2 mt-4">
                  {results.map((app) => (
                    <button
                      key={app.trackId}
                      type="button"
                      onClick={() => {
                        setImportError(null);
                        setSelected(app);
                      }}
                      className={`flex items-center justify-between gap-3 px-4 py-3 bg-[#f7f8fa] dark:bg-[#252b38] rounded-xl border ${borderDefault} hover:border-[#595DD2]/50 transition-colors text-left`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <AppAvatar url={app.iconUrl} name={app.name} />
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold ${textPrimary} truncate`}>{app.name}</div>
                          <div className={`text-[11px] ${textMuted} truncate`}>
                            {app.sellerName}
                            {app.genre ? ` · ${app.genre}` : ""}
                          </div>
                        </div>
                      </div>
                      <span className={`${btnSecondary} shrink-0 !text-xs !py-1.5 !px-3`}>Select →</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {selected && (
            <>
              <div className="mb-6">
                <h1 className={`text-2xl font-bold ${textPrimary}`}>Is this your app?</h1>
                <p className={`text-md ${textSecondary} mt-1`}>
                  Confirm this is the app you want to import and manage with Marteso.
                </p>
              </div>

              <div
                className={`flex items-center gap-4 px-4 py-4 bg-[#f7f8fa] dark:bg-[#252b38] rounded-xl border ${borderDefault}`}
              >
                <AppAvatar url={selected.iconUrl} name={selected.name} size="lg" />
                <div className="min-w-0">
                  <div className={`text-base font-bold ${textPrimary} truncate`}>{selected.name}</div>
                  <div className={`text-xs ${textSecondary} truncate`}>{selected.sellerName}</div>
                  <div className={`text-[11px] ${textMuted} font-mono truncate mt-0.5`}>{selected.bundleId}</div>
                  {selected.rating != null && (
                    <div className={`flex items-center gap-1 mt-1 text-[11px] ${textMuted}`}>
                      <Star className="w-3 h-3 fill-[#f5a623] text-[#f5a623]" />
                      {selected.rating.toFixed(1)}
                      {selected.ratingsCount != null ? ` (${selected.ratingsCount.toLocaleString()})` : ""}
                    </div>
                  )}
                </div>
              </div>

              {importError && (
                <div className="mt-4 bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-2.5">
                  {importError}
                </div>
              )}

              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setSelected(null)}
                  className={`${btnSecondary} flex-1 justify-center`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Not my app
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => handleImport(selected)}
                  className={`${btnPrimary} flex-1 justify-center`}
                >
                  {importing ? "Importing…" : "Yes, import it"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
