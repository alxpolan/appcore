import { prisma, logger } from "../config";

export interface CampaignMetricsRow {
  dateStr: string;
  campaign: string;
  territory: string;
  downloads: number;
  purchases: number;
  trials: number;
  proceedsUsd: number;
}

export function parseCampaignPurchasesSegment(rows: Record<string, string>[]): CampaignMetricsRow[] {
  const byKey = new Map<string, CampaignMetricsRow>();
  const seenTypes = new Set<string>();

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const campaign = (row["Campaign"] ?? "").trim();
    if (!campaign) continue;

    const purchaseType = (row["Purchase Type"] ?? "").trim();
    if (purchaseType) seenTypes.add(purchaseType);
    const territory = (row["Territory"] ?? "").trim().toUpperCase() || "ZZ";
    const key = `${dateStr}::${campaign}::${territory}`;
    const purchases = parseInt(row["Purchases"] ?? "0", 10) || 0;
    const proceedsUsd = parseFloat(row["Proceeds in USD"] ?? "0") || 0;
    const trials = /trial/i.test(purchaseType) ? purchases : 0;

    const bucket = byKey.get(key) ?? {
      dateStr,
      campaign,
      territory,
      downloads: 0,
      purchases: 0,
      trials: 0,
      proceedsUsd: 0,
    };

    bucket.purchases += purchases;
    bucket.trials += trials;
    bucket.proceedsUsd += proceedsUsd;
    byKey.set(key, bucket);
  }

  if (seenTypes.size > 0) {
    logger.debug(`Campaign purchases purchase types: ${[...seenTypes].join(" | ")}`);
  }

  return [...byKey.values()];
}

export async function storeCampaignMetricsSegment(
  bundleId: string,
  rows: CampaignMetricsRow[],
  fields: (keyof CampaignMetricsRow)[],
): Promise<number> {
  await Promise.all(
    rows.map((r) => {
      const reportDate = new Date(r.dateStr);
      const dims = { bundleId, campaign: r.campaign, reportDate, territory: r.territory };
      const metrics = Object.fromEntries(fields.map((f) => [f, r[f]]));

      return prisma.appStoreCampaignMetrics.upsert({
        where: { bundleId_campaign_reportDate_territory: dims },
        create: { ...dims, downloads: 0, purchases: 0, trials: 0, proceedsUsd: 0, ...metrics },
        update: metrics,
      });
    }),
  );

  return rows.length;
}

export interface SessionCohortRow {
  dateStr: string;
  downloadDate: string;
  sessions: number;
  totalDuration: number;
  uniqueDevices: number;
}

export function parseSessionCohortSegment(rows: Record<string, string>[]): SessionCohortRow[] {
  const byKey = new Map<string, SessionCohortRow>();

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const rawDownloadDate = (row["App Download Date"] ?? "").slice(0, 10);
    const downloadDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDownloadDate) ? rawDownloadDate : "";
    const key = `${dateStr}::${downloadDate}`;
    const sessions = parseInt(row["Sessions"] ?? "0", 10) || 0;
    const totalDuration = parseFloat(row["Total Session Duration"] ?? "0") || 0;
    const uniqueDevices = parseInt(row["Unique Devices"] ?? "0", 10) || 0;

    const existing = byKey.get(key);

    if (existing) {
      existing.sessions += sessions;
      existing.totalDuration += totalDuration;
      existing.uniqueDevices += uniqueDevices;
    } else {
      byKey.set(key, { dateStr, downloadDate, sessions, totalDuration, uniqueDevices });
    }
  }

  return [...byKey.values()];
}

export async function storeSessionCohortSegment(bundleId: string, rows: SessionCohortRow[]): Promise<number> {
  await Promise.all(
    rows.map((r) => {
      const reportDate = new Date(r.dateStr);
      const metrics = { sessions: r.sessions, totalDuration: r.totalDuration, uniqueDevices: r.uniqueDevices };

      return prisma.appStoreSessionCohort.upsert({
        where: {
          bundleId_reportDate_downloadDate: { bundleId, reportDate, downloadDate: r.downloadDate },
        },
        create: { bundleId, reportDate, downloadDate: r.downloadDate, ...metrics },
        update: metrics,
      });
    }),
  );

  return rows.length;
}

export interface InstallDeletionRow {
  dateStr: string;
  event: string;
  territory: string;
  counts: number;
  uniqueDevices: number;
}

export function parseInstallDeletionSegment(rows: Record<string, string>[]): InstallDeletionRow[] {
  const byKey = new Map<string, InstallDeletionRow>();

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const event = (row["Event"] ?? "").trim() || "Unknown";
    const territory = (row["Territory"] ?? "").toUpperCase().trim() || "WW";
    const key = `${dateStr}::${event}::${territory}`;
    const counts = parseInt(row["Counts"] ?? "0", 10) || 0;
    const uniqueDevices = parseInt(row["Unique Devices"] ?? "0", 10) || 0;

    const existing = byKey.get(key);

    if (existing) {
      existing.counts += counts;
      existing.uniqueDevices += uniqueDevices;
    } else {
      byKey.set(key, { dateStr, event, territory, counts, uniqueDevices });
    }
  }

  return [...byKey.values()];
}

export async function storeInstallDeletionSegment(bundleId: string, rows: InstallDeletionRow[]): Promise<number> {
  await Promise.all(
    rows.map((r) => {
      const reportDate = new Date(r.dateStr);

      return prisma.appStoreInstallDeletion.upsert({
        where: {
          bundleId_reportDate_event_territory: { bundleId, reportDate, event: r.event, territory: r.territory },
        },
        create: {
          bundleId,
          reportDate,
          event: r.event,
          territory: r.territory,
          counts: r.counts,
          uniqueDevices: r.uniqueDevices,
        },
        update: { counts: r.counts, uniqueDevices: r.uniqueDevices },
      });
    }),
  );

  return rows.length;
}
