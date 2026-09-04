import { useState } from "react";
import { TD, TH, borderDefault, textMuted, textPrimary, textSecondary } from "../../styles";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { AppItem } from "./OwnAppCard";

type SortKey = "name" | "rating" | "ratingsCount" | "languagesCount" | "competitorCount";

interface Props {
  competitors: AppItem[];
  ownAppId?: string;
  onRemove?: (competitorId: string) => void;
  onRowClick: (id: string) => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={`inline-flex flex-col ml-1 leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`w-4 h-4 -mb-1.5 ${active && dir === "asc" ? "text-[#D94412]" : "text-current"}`} />
      <ChevronDown className={`w-4 h-4 -mt-1 ${active && dir === "desc" ? "text-[#D94412]" : "text-current"}`} />
    </span>
  );
}

export default function CompetitorTable({ competitors, ownAppId, onRemove, onRowClick }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("ratingsCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sorted = [...competitors].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "name") return a.name.localeCompare(b.name) * dir;
    
    const av = (a[sortBy] as number | null) ?? -1;
    const bv = (b[sortBy] as number | null) ?? -1;
    return (av - bv) * dir;
  });

  const col = (key: SortKey, label: string) => (
    <th
      className={`${TH} cursor-pointer select-none hover:text-[#111827] dark:hover:text-[#e8eaf0] transition-colors`}
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={sortBy === key} dir={sortDir} />
      </span>
    </th>
  );

  return (
    <div
      className={`bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-2xl overflow-hidden mb-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
    >
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "6%" }} />
        </colgroup>
        <thead>
          <tr>
            {col("name", "App")}
            <th className={TH}>Bundle ID</th>
            {col("rating", "Rating")}
            {col("ratingsCount", "Ratings")}
            {col("languagesCount", "Languages")}
            <th className={TH}>Monetization</th>
            {col("competitorCount", "Competitors")}
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr
              key={c.id}
              onClick={() => onRowClick(c.id)}
              className="cursor-pointer hover:bg-gray-50/60 dark:hover:bg-white/[0.03]"
            >
              <td className={TD}>
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  {c.iconUrl ? (
                    <img src={c.iconUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 bg-[#f3f4f6] text-[#6b7280] dark:bg-[#252b38] dark:text-[#8b93a5]">
                      {c.name.charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className={`block font-medium ${textPrimary} truncate`} title={c.name}>
                      {c.name}
                    </span>
                    {c.subtitle && <span className={`block text-[11px] ${textMuted} truncate`}>{c.subtitle}</span>}
                  </span>
                </span>
              </td>
              <td className={`${TD} ${textSecondary} truncate`} title={c.bundleId}>
                {c.bundleId}
              </td>
              <td className={TD}>
                {c.rating != null ? (
                  <span className={`inline-flex items-center gap-1 ${textPrimary}`}>
                    <span className="text-amber-400">&#9733;</span>
                    {c.rating.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-[#5c6478]">—</span>
                )}
              </td>
              <td className={`${TD} ${textSecondary} tabular-nums`}>
                {c.ratingsCount != null ? c.ratingsCount.toLocaleString() : "—"}
              </td>
              <td className={`${TD} ${textSecondary}`}>
                {c.languagesCount > 0 ? `${c.languagesCount} languages` : "—"}
              </td>
              <td className={TD}>
                {c.inAppPurchases.length === 0 ? (
                  <span className="text-gray-400 dark:text-[#5c6478]">—</span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {c.inAppPurchases.map((p, i) => (
                      <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                        <span
                          className={`inline-flex items-center px-1 py-px rounded text-[9px] font-bold uppercase tracking-wide shrink-0 ${
                            p.kind === "subscription"
                              ? "bg-violet-50 text-violet-700 dark:bg-violet-900/25 dark:text-violet-300"
                              : "bg-sky-50 text-sky-700 dark:bg-sky-900/25 dark:text-sky-300"
                          }`}
                        >
                          {p.kind === "subscription" ? "Sub" : "IAP"}
                        </span>
                        <span className={`text-xs ${textPrimary} truncate`} title={p.name}>
                          {p.name}
                        </span>
                        <span className={`text-xs ${textMuted} shrink-0 ml-auto tabular-nums`}>{p.price ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className={`${TD} ${textSecondary} tabular-nums`}>{c.competitorCount}</td>
              <td className={`${TD} text-right`}>
                {onRemove && ownAppId && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(c.id);
                    }}
                    title="Remove competitor"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-300 dark:text-[#5c6478] hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
