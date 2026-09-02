import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, FileText, GitBranch, Hammer, Package, ShieldCheck, Store, Upload, Zap } from "lucide-react";
import { useApi, apiPost, getActiveBundleId } from "../hooks/useApi";
import { RepoLinker, BuildJobsTable } from "./Logs";
import { badgeOutline, borderDefault, btnPrimary, cardCls, pageTitle, textMuted, textPrimary, textSecondary } from "../styles";
import type { AppItem, AppRepoLink, GitHubStatus } from "../types";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Builds({ addToast }: Props) {
  const { data: apps } = useApi<AppItem[]>("/apps?ownOnly=true", [], true);
  const bundleId = getActiveBundleId();
  const activeApp = apps?.find((a) => a.bundleId === bundleId && a.isOwnApp);

  if (!activeApp) {
    return (
      <div>
        <h1 className={`${pageTitle} mb-5`}>Builds</h1>
        <div className={`${cardCls} text-sm ${textMuted}`}>
          Select one of your own apps in the sidebar to use the build pipeline.
        </div>
      </div>
    );
  }

  return <BuildsPage key={activeApp.id} app={activeApp} addToast={addToast} />;
}

function BuildsPage({ app, addToast }: { app: AppItem; addToast: Props["addToast"] }) {
  const { data: link, refetch: refetchLink } = useApi<AppRepoLink>(`/github/app-repo/${app.id}`, [app.id], true);
  const [reloadToken, setReloadToken] = useState(0);
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await apiPost(`/github/builds/trigger/${app.id}`);
      addToast("Build started", "success");
      setTimeout(() => setReloadToken((t) => t + 1), 800);
    } catch {
      addToast("Failed to start build", "error");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className={pageTitle}>Builds</h1>
          <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>
            Signed iOS builds straight from your repo, ready to submit to the App Store.
          </p>
        </div>
        {link?.linked && (
          <button className={btnPrimary} onClick={handleTrigger} disabled={triggering}>
            {triggering ? <div className="spinner !w-3.5 !h-3.5" /> : <Hammer className="w-4 h-4" />}
            {triggering ? "Starting…" : "Build Binary"}
          </button>
        )}
      </div>

      {!link ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-10 justify-center">
          <div className="spinner !w-4 !h-4" /> Loading…
        </div>
      ) : !link.linked ? (
        <BuildsIntro app={app} addToast={addToast} onLinked={refetchLink} />
      ) : (
        <>
          <LatestBuildCard app={app} reloadToken={reloadToken} />
          <BuildJobsTable appId={app.id} reloadToken={reloadToken} />
          <p className={`text-[12px] ${textMuted}`}>
            Builds also start automatically on every push to{" "}
            <span className="font-mono">{link.branch ?? "the linked branch"}</span>. Signing and pipeline settings
            live in{" "}
            <Link to="/app-settings" className="underline underline-offset-2 hover:text-[#C4001E]">
              App Settings
            </Link>
            , the finished binary is submitted from{" "}
            <Link to="/versions" className="underline underline-offset-2 hover:text-[#C4001E]">
              Versions
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

const INTRO_STEPS = [
  {
    icon: GitBranch,
    title: "1 · Link your repository",
    desc: "Connect the GitHub repo of your app. Marteso auto-detects the framework and sets up the pipeline.",
  },
  {
    icon: ShieldCheck,
    title: "2 · Add signing",
    desc: "Upload your distribution certificate and provisioning profile once in App Settings.",
  },
  {
    icon: Upload,
    title: "3 · Build and submit",
    desc: "Build a signed .ipa with one click or on every push, then submit it to App Store Connect from Versions.",
  },
];

const INTRO_FEATURES = [
  { icon: Package, label: "Signed .ipa" },
  { icon: Zap, label: "Builds on every push" },
  { icon: Upload, label: "Submit from Versions" },
];

function BuildsIntro({ app, addToast, onLinked }: { app: AppItem; addToast: Props["addToast"]; onLinked: () => void }) {
  const { data: ghStatus } = useApi<GitHubStatus>("/github/status", [], true);

  return (
    <>
      <div className={`${cardCls} mb-5`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#D94412] to-[#C4001E] flex items-center justify-center shrink-0">
            <Hammer className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className={`text-[18px] font-semibold ${textPrimary}`}>Ship builds without a Mac</h2>
            <p className={`text-[13px] ${textSecondary}`}>
              Marteso clones your repo, builds and signs your app on macOS workers and hands you a ready-to-submit
              .ipa. No Xcode session, no local archive.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          {INTRO_STEPS.map((step) => (
            <div key={step.title} className={`border ${borderDefault} rounded-xl p-4 bg-[#fafbfc] dark:bg-[#252b38]`}>
              <step.icon className="w-5 h-5 text-[#C4001E] mb-2" />
              <div className={`text-[13px] font-semibold ${textPrimary} mb-1`}>{step.title}</div>
              <div className={`text-[12px] ${textSecondary} leading-relaxed`}>{step.desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {INTRO_FEATURES.map((f) => (
            <span
              key={f.label}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${borderDefault} text-[12px] ${textSecondary}`}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <RepoLinker
        appId={app.id}
        appName={app.displayName ?? app.name}
        connected={!!ghStatus?.connected}
        addToast={addToast}
        onChanged={onLinked}
      />
    </>
  );
}

interface LatestBuild {
  builtAt: string;
  originalFilename: string;
  bundleId: string;
  exportMethod: string;
  sizeBytes: number;
  iconUrl: string | null;
}

function LatestBuildCard({ app, reloadToken }: { app: AppItem; reloadToken: number }) {
  const { data, loading } = useApi<{ build: LatestBuild | null }>(
    `/submissions/build-info?bundleId=${encodeURIComponent(app.bundleId)}`,
    [app.bundleId, reloadToken],
  );

  if (loading && !data) {
    return (
      <div className={`${cardCls} mb-5 flex items-center gap-2 text-sm text-gray-400 dark:text-[#5c6478] py-8 justify-center`}>
        <div className="spinner !w-4 !h-4" /> Loading build info…
      </div>
    );
  }

  if (!data?.build) {
    return (
      <div className={`${cardCls} mb-5 text-center py-10`}>
        <Hammer className="w-6 h-6 mx-auto mb-2 text-gray-300 dark:text-[#3a4050]" />
        <div className={`text-sm font-medium ${textPrimary} mb-1`}>No builds yet</div>
        <p className={`text-[13px] ${textSecondary}`}>
          Hit Build Binary to start your first run. The finished .ipa shows up here once it completes.
        </p>
      </div>
    );
  }

  const build = data.build;
  const appName = app.displayName ?? app.name;
  const sizeMb = (build.sizeBytes / 1024 / 1024).toFixed(1);
  const builtDate = new Date(build.builtAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className={`${cardCls} mb-5`}>
      <h2 className={`text-[16px] font-semibold ${textPrimary} mb-3`}>Latest Build</h2>
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          {build.iconUrl ? (
            <img
              src={build.iconUrl}
              alt={appName}
              className={`w-16 h-16 rounded-[16px] border ${borderDefault} shadow-sm object-cover`}
            />
          ) : (
            <div
              className={`w-16 h-16 rounded-[16px] bg-[#f3f4f6] dark:bg-[#252b38] border ${borderDefault} flex items-center justify-center`}
            >
              <Store className="w-6 h-6 text-[#9ca3af]" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className={`text-[14px] font-semibold ${textPrimary} leading-tight`}>{appName}</div>
              <div className={`text-[11px] ${textMuted} font-mono mt-0.5`}>{build.bundleId}</div>
            </div>
            <span className={`${badgeOutline("sandbox")} shrink-0 uppercase tracking-wide`}>{build.exportMethod}</span>
          </div>

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className={`flex items-center gap-1 text-[12px] ${textSecondary}`}>
              <FileText className="w-3.5 h-3.5 shrink-0" />
              {sizeMb} MB
            </span>
            <span className={`flex items-center gap-1 text-[12px] ${textSecondary}`}>
              <Calendar className="w-3.5 h-3.5" />
              {builtDate}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
