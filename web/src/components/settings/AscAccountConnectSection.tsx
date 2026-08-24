import { useState } from "react";
import { Mail, Copy, Check, CheckCircle2 } from "lucide-react";
import { apiPost } from "../../hooks/useApi";
import { borderDefault, btnPrimary, textMuted, textPrimary, textSecondary } from "../../styles";
import { fmtRelativeDateTime } from "../../utils/formatters";
import { SettingsData } from "./types";

const ASC_ACCOUNT_EMAIL = "asc@marteso.com";

interface Props {
  data: SettingsData | null;
  refetch: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AscAccountConnectSection({ data, refetch, addToast }: Props) {
  const [copied, setCopied] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(ASC_ACCOUNT_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRequest = async () => {
    setRequesting(true);
    try {
      await apiPost("/settings/asc-account-connect", {});
      addToast("Invite noted — we'll finish connecting your account shortly", "success");
      refetch();
    } catch (err: any) {
      addToast(err.message ?? "Failed to record invite", "error");
    } finally {
      setRequesting(false);
    }
  };

  const requestedAt = data?.ascAccountConnectRequestedAt ?? null;
  const connectedAt = data?.ascAutoConnectedAt ?? null;

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl p-5 mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <div className="flex items-center gap-2 mb-1">
        <h2 className={`text-[18px] font-semibold ${textPrimary}`}>App Store Connect</h2>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[#D94412] bg-[#D94412]/10 px-2 py-0.5 rounded-full">
          Recommended
        </span>
      </div>
      <p className={`text-[13px] ${textSecondary} mb-4 max-w-xl`}>
        Give Marteso access without generating or sharing an API key yourself. Invite our account as a user in your
        App Store Connect team and we'll take care of the rest.
      </p>

      {connectedAt ? (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-medium text-emerald-800 dark:text-emerald-400">
              Connected {fmtRelativeDateTime(connectedAt)}
            </div>
            <div className={`text-[12px] ${textMuted} mt-0.5`}>
              Marteso is connected to your App Store Connect team. Nothing else to do.
            </div>
          </div>
        </div>
      ) : requestedAt ? (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-medium text-emerald-800 dark:text-emerald-400">
              Invite noted {fmtRelativeDateTime(requestedAt)}
            </div>
            <div className={`text-[12px] ${textMuted} mt-0.5`}>
              We're setting this up on our end. Haven't invited {ASC_ACCOUNT_EMAIL} yet? Do that first, then let us
              know again below.
            </div>
            <button
              onClick={handleRequest}
              disabled={requesting}
              className="mt-2 text-[12px] font-medium text-[#D94412] hover:underline disabled:opacity-60"
            >
              {requesting ? "Sending…" : "Let us know again"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <ol className={`text-[13px] ${textSecondary} space-y-1.5 mb-4 list-decimal list-inside`}>
            <li>
              Go to App Store Connect →{" "}
              <span className={`font-medium ${textPrimary}`}>Users and Access</span> →{" "}
              <span className={`font-medium ${textPrimary}`}>People</span>
            </li>
            <li>
              Invite <span className={`font-medium ${textPrimary}`}>{ASC_ACCOUNT_EMAIL}</span> with the{" "}
              <span className={`font-medium ${textPrimary}`}>Admin</span> role
            </li>
            <li>Click the button below once the invite is sent</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border ${borderDefault} bg-[#f8f9fb] dark:bg-[#252b38]`}
            >
              <Mail className={`w-3.5 h-3.5 ${textMuted}`} />
              <span className={`text-[13px] font-mono ${textPrimary}`}>{ASC_ACCOUNT_EMAIL}</span>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium border border-[#eef0f3] dark:border-[#2a2f3d] bg-white dark:bg-[#1c2028] text-[#111827] dark:text-[#e8eaf0] hover:bg-gray-50 dark:hover:bg-[#252b38] transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy email"}
            </button>
          </div>

          <button onClick={handleRequest} disabled={requesting} className={btnPrimary}>
            {requesting ? "Sending…" : "I've sent the invite"}
          </button>
        </>
      )}
    </div>
  );
}
