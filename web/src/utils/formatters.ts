export function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function fmtShortDateWithWeekday(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  return `${weekday}, ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function fmtMediumDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelativeDateTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);

  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}, ${time}`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

export function fmtLargeNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function fmtRevenue(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtRevenueShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string): string {
  if (code === "WW") return "Worldwide";
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code.toUpperCase())) return code;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
