export const textPrimary = "text-[#111827] dark:text-[#e8eaf0]";
export const textSecondary = "text-[#6b7280] dark:text-[#8b93a5]";
export const textMuted = "text-[#9ca3af] dark:text-[#5c6478]";
export const borderDefault = "border-[#eef0f3] dark:border-[#2a2f3d]";
export const pageTitle = `text-3xl font-semibold tracking-tight ${textPrimary}`;

export const TH =
  "text-left text-[12.5px] font-medium tracking-wide text-[#9ca3af] dark:text-[#5c6478] px-4 py-3 border-b border-[#f3f4f6] dark:border-[#2a2f3d] whitespace-nowrap";

export const TD = "px-4 py-3.5 border-b border-[#f3f4f6] dark:border-[#2a2f3d] text-[13px] align-middle";

export const cardCls =
  "bg-white dark:bg-[#1c2028] border border-[#eef0f3] dark:border-[#2a2f3d] rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]";

export const btnPrimary =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export const btnPrimSm =
  "inline-flex items-center gap-1.5 px-3 py-[6px] rounded-xl text-xs font-medium bg-gradient-to-br from-[#6E72E4] to-[#595DD2] text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export const btnSecondary =
  "inline-flex items-center gap-1.5 px-3 py-[7px] rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] bg-transparent text-[#111827] dark:text-[#e8eaf0] text-[13px] font-medium transition-all hover:border-[#595DD2] hover:text-[#595DD2] disabled:opacity-50 disabled:cursor-not-allowed";

export const btnSecSm =
  "inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-xl text-xs font-medium border border-[#eef0f3] dark:border-[#2a2f3d] bg-white dark:bg-[#1c2028] text-[#111827] dark:text-[#e8eaf0] hover:bg-gray-50 dark:hover:bg-[#252b38] transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

export const inputCls =
  "w-full px-3.5 py-[9px] rounded-xl border border-[#eef0f3] dark:border-[#2a2f3d] bg-white dark:bg-[#1c2028] text-[#111827] dark:text-[#e8eaf0] text-[13px] outline-none transition-colors focus:border-[#595DD2] font-[inherit] placeholder:text-[#9ca3af] dark:placeholder:text-[#5c6478]";

export const textareaCls = `${inputCls} resize-y font-mono text-xs`;

const BADGE_FALLBACK = "bg-gray-50 text-gray-600 dark:bg-[#252b38] dark:text-[#8b93a5]";

export const badgeVariants: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  applied: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  rejected: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  running: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  title: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  subtitle: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
  keywords: "bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400",
  description: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  created: "bg-gray-50 text-gray-600 dark:bg-[#252b38] dark:text-[#8b93a5]",
  active: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  retry: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  failed: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  cancelled: "bg-gray-50 text-gray-500 dark:bg-[#252b38] dark:text-[#5c6478]",
};

export const badge = (v: string) =>
  `inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${badgeVariants[v.toLowerCase()] ?? BADGE_FALLBACK}`;

const BADGE_OUTLINE_FALLBACK =
  "bg-gray-50 text-gray-600 border-gray-100 dark:bg-[#252b38] dark:text-[#8b93a5] dark:border-[#2a2f3d]";

export const badgeOutlineVariants: Record<string, string> = {
  pending:
    "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40",
  running: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/40",
  completed:
    "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40",
  failed: "bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40",
  ready_for_sale:
    "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40",
  replaced_with_new_version:
    "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40",
  prepare_for_submission:
    "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40",
  waiting_for_review:
    "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/40",
  in_review:
    "bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-900/40",
  rejected: "bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40",
  developer_rejected:
    "bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40",
  metadata_rejected:
    "bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40",
  editable:
    "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40",
  readonly:
    "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40",
  sandbox: "bg-sky-50 text-sky-600 border-sky-100 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-900/40",
  success_tonal: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  danger_tonal: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  info_tonal: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  warning_tonal: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  approved:
    "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/40",
  applied: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/40",
  title:
    "bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-900/40",
  subtitle: "bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-900/40",
  keywords: "bg-pink-50 text-pink-700 border-pink-100 dark:bg-pink-900/20 dark:text-pink-400 dark:border-pink-900/40",
  description:
    "bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-900/20 dark:text-teal-400 dark:border-teal-900/40",
};

export const badgeOutline = (v: string) =>
  `inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badgeOutlineVariants[v.toLowerCase()] ?? BADGE_OUTLINE_FALLBACK}`;
