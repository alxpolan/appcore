import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { borderDefault, textPrimary } from "../styles";
import AscAccountConnectSection from "./settings/AscAccountConnectSection";
import type { SettingsData } from "./settings/types";

interface Props {
  onClose: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
}

export default function AscConnectModal({ onClose, addToast }: Props) {
  const { data, refetch } = useApi<SettingsData>("/settings");

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-10 pb-10">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div
        className={`relative w-full max-w-lg max-h-[calc(100vh-5rem)] flex flex-col bg-white dark:bg-[#161920] border ${borderDefault} rounded-2xl shadow-2xl overflow-hidden`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderDefault} shrink-0`}>
          <h2 className={`text-lg font-semibold ${textPrimary}`}>Connect App Store Connect</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-[#5c6478] hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          <AscAccountConnectSection data={data ?? null} refetch={refetch} addToast={addToast} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
