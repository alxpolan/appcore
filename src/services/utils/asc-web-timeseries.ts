export interface WebCampaignDayRow {
  dateStr: string;
  trials: number;
  purchases: number;
  proceedsUsd: number;
}

const MEASURE_FIELDS: Record<string, keyof Omit<WebCampaignDayRow, "dateStr">> = {
  "subscription-events-offerstarts-freetrial": "trials",
  "subscription-events-paidstarts": "purchases",
  proceeds: "proceedsUsd",
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
      const row = byDate.get(dateStr) ?? { dateStr, trials: 0, purchases: 0, proceedsUsd: 0 };
      row[field] += value;
      byDate.set(dateStr, row);
    }
  }
  return [...byDate.values()].sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}
