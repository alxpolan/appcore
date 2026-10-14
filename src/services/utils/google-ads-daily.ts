/**
 * Pure helpers for Google Ads daily series.
 * Dependency-free so the aggregation can be unit-tested without Google credentials.
 */

export interface GoogleAdsDailyStats {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/** Sums per-(campaign, day) GAQL rows into one series per calendar day. */
export function aggregateGoogleDailyStats(rows: any[], campaignIds?: string[]): GoogleAdsDailyStats[] {
  const allowed = campaignIds ? new Set(campaignIds.map(String)) : null;
  const byDate = new Map<string, GoogleAdsDailyStats>();
  const zero = (date: string): GoogleAdsDailyStats => ({ date, spend: 0, impressions: 0, clicks: 0 });
  for (const row of rows) {
    if (allowed && !allowed.has(String(row.campaign?.id))) continue;
    const date = String(row.segments?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = (v: unknown): number => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    const bucket = byDate.get(date) ?? zero(date);
    bucket.spend += num(row.metrics?.cost_micros) / 1_000_000;
    bucket.impressions += num(row.metrics?.impressions);
    bucket.clicks += num(row.metrics?.clicks);
    byDate.set(date, bucket);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
