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

export interface AppleMetricsRow {
  bundleId: string;
  campaign: string;
  downloads: number;
  trials: number;
  purchases: number;
  proceedsUsd: number;
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

/** Attaches stored mappings to Google campaigns by campaign id; unmapped campaigns get null. */
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
