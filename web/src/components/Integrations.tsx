import { useState } from "react";
import { BarChart2, Megaphone, CheckCircle2 } from "lucide-react";
import { useApi, apiPost } from "../hooks/useApi";
import { borderDefault, btnPrimary, cardCls, pageTitle, textMuted, textPrimary, textSecondary } from "../styles";
import { fmtRelativeDateTime } from "../utils/formatters";
import type { AppleAdsStatus } from "../types";
import AppleAdsConnectModal from "./integrations/AppleAdsConnectModal";

interface Props {
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function Integrations({ addToast }: Props) {
  const { data: appleAds, refetch: refetchAppleAds } = useApi<AppleAdsStatus>("/apple-ads/status", [], true);
  const [showAppleAdsModal, setShowAppleAdsModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnectAppleAds = async () => {
    if (!confirm("Disconnect Apple Search Ads?")) return;
    setDisconnecting(true);
    try {
      await apiPost("/apple-ads/disconnect");
      addToast("Apple Search Ads disconnected", "info");
      refetchAppleAds();
    } catch (err: any) {
      addToast(err.message ?? "Failed to disconnect", "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const integrations = [
    {
      key: "apple-ads",
      name: "Apple Search Ads",
      description:
        "Connect Apple Search Ads to see campaign spend and performance next to your ASO data.",
      icon: Megaphone,
      iconBg: "bg-[#000000]",
      iconColor: "text-white",
      render: () =>
        appleAds?.connected ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-emerald-800 dark:text-emerald-400 truncate">
                {appleAds.orgName ?? "Connected"}
              </div>
              <div className={`text-[11px] ${textMuted} mt-0.5`}>
                Connected {appleAds.connectedAt ? fmtRelativeDateTime(appleAds.connectedAt) : ""}
              </div>
              <button
                onClick={handleDisconnectAppleAds}
                disabled={disconnecting}
                className="mt-1.5 text-[12px] font-medium text-[#595DD2] hover:underline disabled:opacity-60"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAppleAdsModal(true)} className={btnPrimary}>
            Connect
          </button>
        ),
    },
    {
      key: "posthog",
      name: "PostHog",
      description:
        "Connect your PostHog project to see product analytics like funnels, retention and events next to your ASO data.",
      icon: BarChart2,
      iconBg: "bg-[#f9bd2b]",
      iconColor: "text-black/80",
      render: () => (
        <button
          disabled
          className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-xl border ${borderDefault} text-[13px] font-medium ${textSecondary} cursor-not-allowed`}
        >
          Coming soon
        </button>
      ),
    },
  ];

  return (
    <div>
      <h1 className={pageTitle}>Integrations</h1>
      <p className={`text-[13px] ${textSecondary} mt-1 mb-5 max-w-xl`}>
        Connect the tools you already use with Marteso.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((integration) => (
          <div key={integration.key} className={`${cardCls} flex flex-col`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-xl ${integration.iconBg} flex items-center justify-center shrink-0`}>
                <integration.icon className={`w-5 h-5 ${integration.iconColor}`} />
              </div>
              <div className={`text-[15px] font-semibold ${textPrimary}`}>{integration.name}</div>
            </div>
            <p className={`text-[13px] ${textSecondary} leading-relaxed flex-1`}>{integration.description}</p>
            <div className="mt-4">{integration.render()}</div>
          </div>
        ))}
      </div>

      {showAppleAdsModal && (
        <AppleAdsConnectModal
          onClose={() => setShowAppleAdsModal(false)}
          onConnected={refetchAppleAds}
          addToast={addToast}
        />
      )}
    </div>
  );
}
