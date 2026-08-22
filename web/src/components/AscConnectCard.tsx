import { Link } from "react-router-dom";
import { KeyRound, ArrowRight } from "lucide-react";
import { textPrimary, textSecondary } from "../styles";

export default function AscConnectCard({
  title = "Connect App Store Connect",
  description,
  cta = "Connect App Store Connect",
  className = "",
}: {
  title?: string;
  description: string;
  cta?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[#D94412]/30 bg-gradient-to-br from-[#fff5f1] to-[#fdeee9] dark:from-[#2a1812] dark:to-[#231210] p-5 ${className}`}
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#D94412] to-[#C4001E] flex items-center justify-center shrink-0 shadow-sm">
          <KeyRound className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-bold ${textPrimary}`}>{title}</div>
          <p className={`text-[13px] ${textSecondary} mt-1 max-w-xl`}>{description}</p>
          <Link
            to="/settings/team-settings"
            className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#D94412] text-white hover:bg-[#c80b24] transition-all"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {cta}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
