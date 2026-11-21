import { ChevronDown, ChevronUp } from "lucide-react";

export function SortIcon({
  active,
  dir,
  compact = false,
}: {
  active: boolean;
  dir: "asc" | "desc";
  compact?: boolean;
}) {
  const size = compact ? "w-3 h-3" : "w-4 h-4";
  const wrapperMargin = compact ? "ml-0.5" : "ml-1";
  const topMargin = compact ? "-mb-1" : "-mb-1.5";

  return (
    <span className={`inline-flex flex-col ${wrapperMargin} leading-none ${active ? "opacity-100" : "opacity-25"}`}>
      <ChevronUp className={`${size} ${topMargin} ${active && dir === "asc" ? "text-[#595DD2]" : "text-current"}`} />
      <ChevronDown className={`${size} -mt-1 ${active && dir === "desc" ? "text-[#595DD2]" : "text-current"}`} />
    </span>
  );
}
