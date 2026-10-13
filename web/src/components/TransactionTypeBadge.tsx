import { CircleCheck, CircleDashed, CirclePlus, RefreshCw } from "lucide-react";

export function TransactionTypeBadge({ type }: { type: string }) {
  const normalized = type.toLowerCase();
  let label = type;
  let Icon = CircleCheck;
  let color = "bg-slate-100 text-slate-600 dark:bg-[#2a2f3d] dark:text-[#a6aec0]";
  let iconColor = "text-slate-500 dark:text-[#a6aec0]";

  if (normalized === "new subscription" || normalized === "subscription") {
    label = normalized === "new subscription" ? "New Sub" : type;
    Icon = CirclePlus;
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  } else if (normalized === "one time") {
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  } else if (normalized === "trial") {
    Icon = CircleDashed;
    color = "bg-orange-50 text-slate-800 dark:bg-[#3d2a1e] dark:text-white";
    iconColor = "text-[#f97316] dark:text-[#fb923c]";
  } else if (normalized === "trial converted") {
    color = "bg-emerald-50 text-slate-800 dark:bg-[#203c30] dark:text-white";
    iconColor = "text-[#10b981] dark:text-[#32e4a5]";
  } else if (normalized === "trial canceled" || normalized === "trial cancelled" || normalized === "trial ended") {
    Icon = CircleDashed;
    color = "bg-red-50 text-slate-800 dark:bg-[#3c2427] dark:text-white";
    iconColor = "text-[#ef4444] dark:text-[#ff4d63]";
  } else if (normalized === "renewal") {
    Icon = RefreshCw;
    color = "bg-indigo-50 text-slate-800 dark:bg-[#2c3041] dark:text-white";
    iconColor = "text-[#637bf1] dark:text-[#8298ff]";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${color}`}
      title={type}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 stroke-[2.7] ${iconColor}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Maps an Apple Ads revenue transaction onto Financial's badge types. */
export function adsTransactionType(t: { eventType: string; isTrial: boolean; isConvertedTrial: boolean }): string {
  if (t.isTrial && !t.isConvertedTrial) return "Trial";
  if (t.isConvertedTrial) return "Trial Converted";
  if (t.eventType === "NON_RENEWING_PURCHASE") return "One Time";
  if (t.eventType === "RENEWAL") return "Renewal";
  if (t.eventType === "INITIAL_PURCHASE") return "New Subscription";
  return t.eventType
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Turns a raw product id (com.shop.app.pro_yearly) into a readable name (Pro Yearly). */
export function prettyProductName(productId: string): string {
  const last = productId.split(".").pop()?.trim() || productId;
  const words = last
    .split(/[_-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return productId;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
