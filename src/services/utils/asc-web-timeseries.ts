import { storefrontToTerritory } from "./asc-storefronts";

export interface WebCampaignDayRow {
  dateStr: string;
  trials: number;
  purchases: number;
  proceedsUsd: number;
  downloads: number;
}

export interface GroupedWebDayRow {
  dateStr: string;
  territory: string;
  downloads: number;
  trials: number;
  proceedsUsd: number;
}

const GROUPED_MEASURE_FIELDS: Record<string, "downloads" | "trials" | "proceedsUsd"> = {
  totaldownloads: "downloads",
  "subscription-events-offerstarts-freetrial": "trials",
  proceeds: "proceedsUsd",
};

const MEASURE_FIELDS: Record<string, keyof Omit<WebCampaignDayRow, "dateStr">> = {
  "subscription-events-offerstarts-freetrial": "trials",
  "subscription-events-paidstarts": "purchases",
  proceeds: "proceedsUsd",
  units: "downloads",
};

export function parseWebTimeseries(body: any): WebCampaignDayRow[] {
  const results: any[] = body?.results ?? [];
  const byDate = new Map<string, WebCampaignDayRow>();
  for (const r of results) {
    const field = MEASURE_FIELDS[String(r?.totals?.key ?? "").toLowerCase()];
    if (!field) continue;
    for (const p of r?.data ?? []) {
      const dateStr = String(p?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      let value = 0;
      for (const [k, v] of Object.entries(p)) {
        if (k === "date") continue;
        const n = Number(v);

        if (Number.isFinite(n)) {
          value = n;
          break;
        }
      }
      const row = byDate.get(dateStr) ?? { dateStr, trials: 0, purchases: 0, proceedsUsd: 0, downloads: 0 };

      row[field] += value;
      byDate.set(dateStr, row);
    }
  }

  return [...byDate.values()].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

export function parseGroupedWebTimeseries(body: any): GroupedWebDayRow[] {
  const results: any[] = body?.results ?? [];
  const byKey = new Map<string, GroupedWebDayRow>();
  for (const r of results) {
    const field = GROUPED_MEASURE_FIELDS[String(r?.totals?.key ?? "").toLowerCase()];
    if (!field) continue;
    const territory = storefrontToTerritory(r?.group?.key) ?? "ZZ";
    for (const p of r?.data ?? []) {
      const dateStr = String(p?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      let value = 0;
      for (const [k, v] of Object.entries(p)) {
        if (k === "date") continue;
        const n = Number(v);

        if (Number.isFinite(n)) {
          value = n;
          break;
        }
      }
      const key = `${dateStr}\n${territory}`;
      const row = byKey.get(key) ?? { dateStr, territory, downloads: 0, trials: 0, proceedsUsd: 0 };

      row[field] += value;
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.dateStr.localeCompare(b.dateStr) || a.territory.localeCompare(b.territory),
  );
}

export interface SplitValueRow {
  dateStr: string;
  territory: string;
  value: number;
}

export function splitRemainderPerDay(args: {
  totalsByDate: Map<string, number>;
  split: SplitValueRow[];
  legacy: SplitValueRow[];
}): Map<string, number> {
  const splitByDay = new Map<string, number>();
  const covered = new Set<string>();
  for (const g of args.split) {
    if (g.value <= 0) continue;
    splitByDay.set(g.dateStr, (splitByDay.get(g.dateStr) ?? 0) + g.value);
    covered.add(`${g.dateStr}\n${g.territory}`);
  }
  const legacyUncoveredByDay = new Map<string, number>();
  for (const o of args.legacy) {
    if (o.value <= 0 || covered.has(`${o.dateStr}\n${o.territory}`)) continue;
    legacyUncoveredByDay.set(o.dateStr, (legacyUncoveredByDay.get(o.dateStr) ?? 0) + o.value);
  }
  const cents = (n: number): number => Math.round(n * 100) / 100;
  const remainder = new Map<string, number>();
  for (const [dateStr, total] of args.totalsByDate) {
    remainder.set(
      dateStr,
      Math.max(0, cents(total) - cents(splitByDay.get(dateStr) ?? 0) - cents(legacyUncoveredByDay.get(dateStr) ?? 0)),
    );
  }

  return remainder;
}

export function collectUnknownStorefrontKeys(body: any): string[] {
  const results: any[] = body?.results ?? [];
  const unknown = new Set<string>();
  for (const r of results) {
    const key = r?.group?.key != null ? String(r.group.key) : "";
    if (key && !storefrontToTerritory(key)) unknown.add(key);
  }

  return [...unknown].sort();
}
