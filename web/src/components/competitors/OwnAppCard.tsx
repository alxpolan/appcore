import AppIcon from "./AppIcon";
import { textMuted, textPrimary, textSecondary } from "../../styles";

export interface AppItem {
  id: string;
  bundleId: string;
  name: string;
  isOwnApp: boolean;
  rating: number | null;
  ratingsCount: number | null;
  iconUrl: string | null;
  subtitle: string | null;
  languagesCount: number;
  competitorCount: number;
  inAppPurchases: { name: string; price: string | null; kind: string }[];
  updatedAt: string;
}

interface Props {
  app: AppItem;
}

export default function OwnAppCard({ app }: Props) {
  return (
    <div className="mb-6">
      <div className={`text-xs font-medium uppercase tracking-wide ${textMuted} mb-3`}>Your App</div>
      <div className="bg-white dark:bg-[#1c2028] border-2 border-[#D94412] rounded-2xl p-5 inline-flex items-center gap-3">
        <AppIcon url={app.iconUrl} name={app.name} own />
        <div>
          <div className={`text-sm font-semibold ${textPrimary}`}>{app.name}</div>
          <div className={`text-xs ${textMuted}`}>{app.bundleId}</div>
          {app.rating != null && (
            <div className={`text-xs ${textSecondary} mt-0.5 flex items-center gap-1`}>
              <span className="text-amber-400">&#9733;</span> {app.rating.toFixed(1)} (
              {app.ratingsCount?.toLocaleString()})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
