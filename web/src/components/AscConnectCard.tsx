import { useState } from "react";
import { KeyRound, ArrowRight } from "lucide-react";
import { textPrimary, textSecondary } from "../styles";
import AscConnectModal from "./AscConnectModal";

export default function AscConnectCard({
  title = "Connect App Store Connect",
  description,
  cta = "Connect App Store Connect",
  className = "",
  addToast,
}: {
  title?: string;
  description: string;
  cta?: string;
  className?: string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--sidebar-bg)] p-5 ${className}`}
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-white dark:bg-[#1c2028] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-sm">
          <KeyRound className={`w-5 h-5 ${textPrimary}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-bold ${textPrimary}`}>{title}</div>
          <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>{description}</p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#1a1a2e] text-white dark:bg-[#e8eaf0] dark:text-[#1a1a2e] hover:opacity-90 transition-all"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {cta}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {modalOpen && <AscConnectModal onClose={() => setModalOpen(false)} addToast={addToast} />}
    </div>
  );
}
