export interface AppleAdsDailyStats {
  date: string;
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
}

export function aggregateDailyStats(rows: any[], campaignId?: string): AppleAdsDailyStats[] {
  const byDate = new Map<string, AppleAdsDailyStats>();
  const zero = (date: string): AppleAdsDailyStats => ({ date, spend: 0, impressions: 0, taps: 0, installs: 0 });
  for (const row of rows) {
    if (campaignId != null && String(row.metadata?.campaignId) !== campaignId) continue;
    for (const day of row.granularity ?? []) {
      const date = String(day.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const bucket = byDate.get(date) ?? zero(date);
      bucket.spend += Number(day.localSpend?.amount ?? 0);
      bucket.impressions += Number(day.impressions ?? 0);
      bucket.taps += Number(day.taps ?? 0);
      // Granularity entries mirror the total keys, where installs arrive as `totalInstalls`.
      bucket.installs += Number(day.totalInstalls ?? day.installs ?? 0);
      byDate.set(date, bucket);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Merges per-org day series into one, summing metrics that share a date. */
export function mergeDailyStatsLists(lists: AppleAdsDailyStats[][]): AppleAdsDailyStats[] {
  const byDate = new Map<string, AppleAdsDailyStats>();
  for (const list of lists) {
    for (const day of list) {
      const bucket = byDate.get(day.date) ?? { date: day.date, spend: 0, impressions: 0, taps: 0, installs: 0 };
      bucket.spend += day.spend;
      bucket.impressions += day.impressions;
      bucket.taps += day.taps;
      bucket.installs += day.installs;
      byDate.set(day.date, bucket);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
