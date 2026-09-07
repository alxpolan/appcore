import AppIcon from "./AppIcon";
import { borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { AppItem } from "./OwnAppCard";
import { X } from "lucide-react";

interface Props {
  competitor: AppItem;
  ownAppId?: string;
  onRemove?: (competitorId: string) => void;
  onClick?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export default function CompetitorCard({ competitor: c, ownAppId, onRemove, onClick, selected, onToggleSelect }: Props) {
  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${
        selected ? "border-[#D94412]" : borderDefault
      } rounded-2xl p-5 flex items-center gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] cursor-pointer hover:border-[#D94412]/40 transition-colors`}
      onClick={onClick}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelect}
          className="shrink-0 w-4 h-4"
        />
      )}
      <AppIcon url={c.iconUrl} name={c.name} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${textPrimary} truncate`}>{c.name}</div>
        <div className={`text-[11px] ${textMuted} truncate`}>{c.bundleId}</div>
        {c.rating != null && (
          <div className={`text-xs ${textSecondary} mt-0.5 flex items-center gap-1`}>
            <span className="text-amber-400">&#9733;</span> {c.rating.toFixed(1)}{" "}
            {c.ratingsCount != null && `(${c.ratingsCount.toLocaleString()})`}
          </div>
        )}
        {c.subtitle && <div className={`text-[11px] ${textMuted} mt-0.5 truncate`}>{c.subtitle}</div>}
      </div>
      {onRemove && ownAppId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(c.id);
          }}
          title="Remove competitor"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 dark:text-[#5c6478] hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
