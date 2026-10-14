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
  /** ISO 3166-1 alpha-2 territory, or "ZZ" for unknown storefronts. */
  territory: string;
  downloads: number;
}

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

/** Parses storefront-grouped totalDownloads into summed (day, territory) rows. */
export function parseGroupedWebTimeseries(body: any): GroupedWebDayRow[] {
  const results: any[] = body?.results ?? [];
  const byKey = new Map<string, GroupedWebDayRow>();
  for (const r of results) {
    if (String(r?.totals?.key ?? "").toLowerCase() !== "totaldownloads") continue;
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
      const row = byKey.get(key) ?? { dateStr, territory, downloads: 0 };
      row.downloads += value;
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.dateStr.localeCompare(b.dateStr) || a.territory.localeCompare(b.territory),
  );
}

/**
 * Per-day unattributed download remainder: units total minus the grouped
 * territory split minus legacy official rows the split doesn't cover, so
 * territories + legacy + remainder always add up to the units total.
 */
export function downloadRemainderPerDay(args: {
  unitsByDate: Map<string, number>;
  grouped: GroupedWebDayRow[];
  official: { dateStr: string; territory: string; downloads: number }[];
}): Map<string, number> {
  const groupedByDay = new Map<string, number>();
  const covered = new Set<string>();
  for (const g of args.grouped) {
    if (g.downloads <= 0) continue;
    groupedByDay.set(g.dateStr, (groupedByDay.get(g.dateStr) ?? 0) + g.downloads);
    covered.add(`${g.dateStr}\n${g.territory}`);
  }
  const officialUncoveredByDay = new Map<string, number>();
  for (const o of args.official) {
    if (o.downloads <= 0 || covered.has(`${o.dateStr}\n${o.territory}`)) continue;
    officialUncoveredByDay.set(o.dateStr, (officialUncoveredByDay.get(o.dateStr) ?? 0) + o.downloads);
  }
  const remainder = new Map<string, number>();
  for (const [dateStr, units] of args.unitsByDate) {
    remainder.set(
      dateStr,
      Math.max(
        0,
        Math.round(units) - Math.round(groupedByDay.get(dateStr) ?? 0) - Math.round(officialUncoveredByDay.get(dateStr) ?? 0),
      ),
    );
  }
  return remainder;
}

/** Storefront keys in a grouped response that have no territory mapping (for sync logs). */
export function collectUnknownStorefrontKeys(body: any): string[] {
  const results: any[] = body?.results ?? [];
  const unknown = new Set<string>();
  for (const r of results) {
    const key = r?.group?.key != null ? String(r.group.key) : "";
    if (key && !storefrontToTerritory(key)) unknown.add(key);
  }
  return [...unknown].sort();
}
