/**
 * Pure helpers for Google Ads campaign → app mapping.
 * Dependency-free so the join logic can be unit-tested without Google credentials.
 */

export interface CampaignMappingInput {
  googleCampaignId: string;
  appId: string;
  appName: string;
  ctToken: string;
}

export interface CampaignWithMapping {
  id: string;
  name: string;
  status: string;
  mapping: { appId: string; appName: string; ctToken: string } | null;
}

/** Keeps only campaigns assigned to an app (matched by Google campaign id). */
export function filterCampaignsByApp<T extends { id: string }>(campaigns: T[], googleCampaignIds: string[]): T[] {
  const allowed = new Set(googleCampaignIds);
  return campaigns.filter((c) => allowed.has(c.id));
}

/**
 * Territory key for private-web (App Store Connect UI session) campaign metrics.
 * ISO 3166-1 user-assigned range, so it can never collide with a real country or
 * with official "ZZ" (unknown territory) rows.
 */
export const WEB_METRICS_TERRITORY = "XW";

export interface AppleMetricsRow {
  bundleId: string;
  campaign: string;
  downloads: number;
  trials: number;
  purchases: number;
  proceedsUsd: number;
  territory?: string;
  reportDate?: Date | string;
}

export interface AppleMetricsKey {
  googleCampaignId: string;
  bundleId: string;
  ctToken: string;
}

export interface AppleCampaignTotals {
  downloads: number;
  trials: number;
  purchases: number;
  proceedsUsd: number;
}

/**
 * Merges official per-territory downloads with private-web (XW) campaign totals.
 * Official rows win per day where present; web fills only privacy-suppressed gaps,
 * so the two sources are never double-counted. Trials/purchases/proceeds only ever
 * come from web rows (official campaign sync carries none) and are summed as-is.
 */
export function mergeDayDownloads(
  officialDownloads: number,
  webDownloads: number,
): { downloads: number; downloadsSource: "official" | "web" | "none" } {
  if (officialDownloads > 0) return { downloads: officialDownloads, downloadsSource: "official" };
  if (webDownloads > 0) return { downloads: webDownloads, downloadsSource: "web" };
  return { downloads: 0, downloadsSource: "none" };
}

export interface CampaignDayMetricsInput {
  date: string;
  territory: string;
  downloads: number;
  trials: number;
  purchases: number;
  proceedsUsd: number;
}

export interface MergedCampaignDay {
  date: string;
  downloads: number;
  trials: number;
  purchases: number;
  proceedsUsd: number;
  downloadsSource: "official" | "web" | "none";
}

/** Collapses raw rows to one merged row per day (see mergeDayDownloads). */
export function mergeCampaignDayMetrics(rows: CampaignDayMetricsInput[]): MergedCampaignDay[] {
  const byDate = new Map<string, CampaignDayMetricsInput[]>();
  for (const row of rows) {
    const group = byDate.get(row.date) ?? [];
    group.push(row);
    byDate.set(row.date, group);
  }
  return [...byDate.entries()]
    .map(([date, group]) => {
      const officialDownloads = group
        .filter((r) => r.territory !== WEB_METRICS_TERRITORY)
        .reduce((acc, r) => acc + r.downloads, 0);
      const webDownloads = group
        .filter((r) => r.territory === WEB_METRICS_TERRITORY)
        .reduce((acc, r) => acc + r.downloads, 0);
      const merged = mergeDayDownloads(officialDownloads, webDownloads);
      return {
        date,
        downloads: merged.downloads,
        trials: group.reduce((acc, r) => acc + r.trials, 0),
        purchases: group.reduce((acc, r) => acc + r.purchases, 0),
        proceedsUsd: group.reduce((acc, r) => acc + r.proceedsUsd, 0),
        downloadsSource: merged.downloadsSource,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Sums Apple campaign metrics per Google campaign; rows without a known key are ignored. */
export function aggregateAppleMetricsByCampaign(
  rows: AppleMetricsRow[],
  keys: AppleMetricsKey[],
): Map<string, AppleCampaignTotals> {
  const campaignByBundleToken = new Map(keys.map((k) => [`${k.bundleId}\n${k.ctToken}`, k.googleCampaignId]));
  // Group per campaign + day so web downloads only fill gaps (rows without a
  // reportDate keep legacy straight-sum behavior via their own group each).
  const byDay = new Map<string, { id: string; rows: AppleMetricsRow[] }>();
  rows.forEach((row, i) => {
    const id = campaignByBundleToken.get(`${row.bundleId}\n${row.campaign}`);
    if (!id) return;
    const day = row.reportDate ? new Date(row.reportDate).toISOString().slice(0, 10) : `#${i}`;
    const key = `${id}\n${day}`;
    const group = byDay.get(key) ?? { id, rows: [] };
    group.rows.push(row);
    byDay.set(key, group);
  });
  const totals = new Map<string, AppleCampaignTotals>();
  for (const { id, rows: group } of byDay.values()) {
    const officialDownloads = group
      .filter((r) => (r.territory ?? "") !== WEB_METRICS_TERRITORY)
      .reduce((acc, r) => acc + r.downloads, 0);
    const webDownloads = group
      .filter((r) => r.territory === WEB_METRICS_TERRITORY)
      .reduce((acc, r) => acc + r.downloads, 0);
    const t = totals.get(id) ?? { downloads: 0, trials: 0, purchases: 0, proceedsUsd: 0 };
    t.downloads += mergeDayDownloads(officialDownloads, webDownloads).downloads;
    t.trials += group.reduce((acc, r) => acc + r.trials, 0);
    t.purchases += group.reduce((acc, r) => acc + r.purchases, 0);
    t.proceedsUsd += group.reduce((acc, r) => acc + r.proceedsUsd, 0);
    totals.set(id, t);
  }
  return totals;
}

/**
 * Whether an app's campaign metrics need a one-off history backfill.
 * Incremental sync only covers a few days, so apps that already have mappings
 * but no (or only shallow) campaign history would otherwise never show past
 * campaign performance. Apps without mappings never need one.
 */
export function needsCampaignBackfill(args: {
  mappingCount: number;
  oldestReportDate: Date | null;
  now?: Date;
  minHistoryDays?: number;
}): boolean {
  if (args.mappingCount === 0) return false;
  if (!args.oldestReportDate) return true;
  const now = args.now ?? new Date();
  const historyDays = (now.getTime() - args.oldestReportDate.getTime()) / 86_400_000;
  return historyDays < (args.minHistoryDays ?? 60);
}

/** Attaches stored mappings to Google campaigns by campaign id; unmapped campaigns get null. */
export function parseCtParam(finalUrl: string): string | null {
  try {
    const ct = new URL(finalUrl).searchParams.get("ct")?.trim();

    return ct ? ct : null;
  } catch {
    return null;
  }
}

export function withCtParam(finalUrl: string, ctToken: string): string {
  try {
    const url = new URL(finalUrl);
    if (!url.searchParams.get("ct")) url.searchParams.set("ct", ctToken);

    return url.toString();
  } catch {
    return finalUrl;
  }
}

export function attachCampaignMappings(
  campaigns: Array<{ id: string; name: string; status: string }>,
  mappings: CampaignMappingInput[],
): CampaignWithMapping[] {
  const byCampaignId = new Map(mappings.map((m) => [m.googleCampaignId, m]));
  return campaigns.map((c) => {
    const m = byCampaignId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      mapping: m ? { appId: m.appId, appName: m.appName, ctToken: m.ctToken } : null,
    };
  });
}
