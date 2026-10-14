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
 * Downloads are an exact sum: per-territory rows (grouped web split plus any
 * legacy official rows it doesn't cover) plus the XW unattributed remainder.
 * The sync computes the remainder as units − split − legacy, so this sum
 * always equals the units total with no double-count. Trials/purchases/
 * proceeds only ever come from web rows and are summed as-is.
 */
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
      const downloads = group.reduce((acc, r) => acc + r.downloads, 0);
      const webManaged = group.some((r) => r.territory === WEB_METRICS_TERRITORY);
      return {
        date,
        downloads,
        trials: group.reduce((acc, r) => acc + r.trials, 0),
        purchases: group.reduce((acc, r) => acc + r.purchases, 0),
        proceedsUsd: group.reduce((acc, r) => acc + r.proceedsUsd, 0),
        downloadsSource: downloads <= 0 ? "none" : webManaged ? "web" : "official",
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Sums downloads per day across campaigns. Each (bundle, token) group is
 * merged separately; rows without a reportDate are skipped.
 */
export function sumMergedDownloadsPerDay(rows: AppleMetricsRow[]): Map<string, number> {
  const byCampaign = new Map<string, CampaignDayMetricsInput[]>();
  for (const row of rows) {
    if (!row.reportDate) continue;
    const key = `${row.bundleId}\n${row.campaign}`;
    const group = byCampaign.get(key) ?? [];
    group.push({
      date: new Date(row.reportDate).toISOString().slice(0, 10),
      territory: row.territory ?? "",
      downloads: row.downloads,
      trials: 0,
      purchases: 0,
      proceedsUsd: 0,
    });
    byCampaign.set(key, group);
  }
  const perDay = new Map<string, number>();
  for (const group of byCampaign.values()) {
    for (const d of mergeCampaignDayMetrics(group)) {
      perDay.set(d.date, (perDay.get(d.date) ?? 0) + d.downloads);
    }
  }
  return perDay;
}

/** Sums Apple campaign metrics per Google campaign; rows without a known key are ignored. */
export function aggregateAppleMetricsByCampaign(
  rows: AppleMetricsRow[],
  keys: AppleMetricsKey[],
): Map<string, AppleCampaignTotals> {
  const campaignByBundleToken = new Map(keys.map((k) => [`${k.bundleId}\n${k.ctToken}`, k.googleCampaignId]));
  const totals = new Map<string, AppleCampaignTotals>();
  for (const row of rows) {
    const id = campaignByBundleToken.get(`${row.bundleId}\n${row.campaign}`);
    if (!id) continue;
    const t = totals.get(id) ?? { downloads: 0, trials: 0, purchases: 0, proceedsUsd: 0 };
    t.downloads += row.downloads;
    t.trials += row.trials;
    t.purchases += row.purchases;
    t.proceedsUsd += row.proceedsUsd;
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
