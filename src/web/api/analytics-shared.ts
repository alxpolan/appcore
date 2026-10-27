import { prisma } from "../../config";
import type { TrialPotential } from "../../services/asc-analytics";

export const trialPotentialCache = new Map<string, { expiresAt: number; value: Promise<TrialPotential> }>();

export async function getAnchorDate(bundleId: string): Promise<Date> {
  const latest = await prisma.appStoreAnalytics.findFirst({
    where: { bundleId },
    orderBy: { reportDate: "desc" },
    select: { reportDate: true },
  });

  return latest?.reportDate ?? new Date();
}

export function resolveSince(query: Record<string, any>, anchor: Date): Date | null {
  if (query.period === "all") return null;

  if (query.startDate) {
    return new Date(query.startDate as string);
  }

  if (query.period === "ytd") {
    return new Date(anchor.getFullYear(), 0, 1);
  }

  const days = parseInt(query.days as string, 10);
  const n = !isNaN(days) && days > 0 ? days : 30;
  const d = new Date(anchor);

  d.setDate(d.getDate() - (n - 1));
  return d;
}

export function resolveUntil(query: Record<string, any>): Date | null {
  if (query.endDate) return new Date(query.endDate as string);

  return null;
}

export function majorIosVersion(platformVersion: string): string {
  const major = platformVersion.match(/^iOS (\d+)/)?.[1];
  return major ? `iOS ${major}` : platformVersion || "Unknown";
}

export function majorVersionNumber(version: string): number | null {
  const major = version.match(/(\d+)/)?.[1];
  return major ? parseInt(major, 10) : null;
}

export const DOWNLOAD_SOURCE_TYPES = [
  "App Store search",
  "App Store browse",
  "App referrer",
  "Web referrer",
  "Unavailable",
  "Institutional purchase",
] as const;

export function downloadSourceLabel(sourceType: string): string {
  return (DOWNLOAD_SOURCE_TYPES as readonly string[]).includes(sourceType) ? sourceType : "Other";
}

export async function revenueCatGapStart(bundleId: string): Promise<Date> {
  const agg = await prisma.appStoreCommercePurchase.aggregate({
    where: { bundleId },
    _max: { reportDate: true },
  });

  if (!agg._max.reportDate) return new Date(0);
  const start = new Date(agg._max.reportDate);

  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function revenueCatGapWhere(bundleId: string, gapStart: Date) {
  return {
    bundleId,
    OR: [{ store: { not: "app_store" } }, { occurredAt: { gte: gapStart } }],
  };
}

export interface AnalyticsDayRow {
  reportDate: Date;
  country: string;
  downloads: number;
  updates: number;
  proceeds: number;
  impressions: number;
  pageViews: number;
  taps: number;
  sessions: number;
}

export interface AnalyticsProceedsRow {
  reportDate: Date;
  proceedsUsd: number;
}

export interface AnalyticsSourceRow {
  reportDate: Date;
  sourceType: string;
  _sum: { counts: number | null };
}

export interface AnalyticsInstallDeletionRow {
  reportDate: Date;
  event: string;
  counts: number;
}

export interface AnalyticsRevenueCatRow {
  occurredAt: Date;
  proceedsUsd: number;
}

export interface DownloadsBreakdownInput {
  rows: AnalyticsDayRow[];
  purchaseRows: AnalyticsProceedsRow[];
  sourceRows: AnalyticsSourceRow[];
  installDeletionRows: AnalyticsInstallDeletionRow[];
  rcRows: AnalyticsRevenueCatRow[];
}

export function buildDownloadsBreakdown(input: DownloadsBreakdownInput) {
  const { rows, purchaseRows, sourceRows, installDeletionRows, rcRows } = input;

  type DayEntry = {
    date: string;
    downloads: number;
    updates: number;
    proceeds: number;
    impressions: number;
    pageViews: number;
    taps: number;
    sessions: number;
    installs: number;
    deletions: number;
  };

  type CountryEntry = {
    downloads: number;
    impressions: number;
    pageViews: number;
    taps: number;
  };

  const byDayMap: Record<string, DayEntry> = {};
  const byCountryMap: Record<string, CountryEntry> = {};

  for (const r of rows) {
    const key = r.reportDate.toISOString().slice(0, 10);
    const day = (byDayMap[key] ??= {
      date: key,
      downloads: 0,
      updates: 0,
      proceeds: 0,
      impressions: 0,
      pageViews: 0,
      taps: 0,
      sessions: 0,
      installs: 0,
      deletions: 0,
    });

    day.downloads += r.downloads;
    day.updates += r.updates;
    day.proceeds += r.proceeds;
    day.impressions += r.impressions;
    day.pageViews += r.pageViews;
    day.taps += r.taps;
    day.sessions += r.sessions;

    const c = (byCountryMap[r.country] ??= {
      downloads: 0,
      impressions: 0,
      pageViews: 0,
      taps: 0,
    });

    c.downloads += r.downloads;
    c.impressions += r.impressions;
    c.pageViews += r.pageViews;
    c.taps += r.taps;
  }

  for (const p of purchaseRows) {
    const key = p.reportDate.toISOString().slice(0, 10);
    const day = (byDayMap[key] ??= {
      date: key,
      downloads: 0,
      updates: 0,
      proceeds: 0,
      impressions: 0,
      pageViews: 0,
      taps: 0,
      sessions: 0,
      installs: 0,
      deletions: 0,
    });

    day.proceeds += p.proceedsUsd;
  }

  for (const r of rcRows) {
    const key = r.occurredAt.toISOString().slice(0, 10);
    const day = (byDayMap[key] ??= {
      date: key,
      downloads: 0,
      updates: 0,
      proceeds: 0,
      impressions: 0,
      pageViews: 0,
      taps: 0,
      sessions: 0,
      installs: 0,
      deletions: 0,
    });

    day.proceeds += r.proceedsUsd;
  }

  for (const r of installDeletionRows) {
    const key = r.reportDate.toISOString().slice(0, 10);
    const day = (byDayMap[key] ??= {
      date: key,
      downloads: 0,
      updates: 0,
      proceeds: 0,
      impressions: 0,
      pageViews: 0,
      taps: 0,
      sessions: 0,
      installs: 0,
      deletions: 0,
    });

    const event = r.event.toLowerCase();

    if (event.startsWith("delet")) day.deletions += r.counts;
    else if (event.startsWith("install")) day.installs += r.counts;
  }

  const byCountry = Object.entries(byCountryMap)
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.downloads - a.downloads);

  const topCountryCodes = byCountry.slice(0, 5).map((c) => c.country);
  const byCountryDayMap: Record<string, Record<string, number>> = {};
  let otherCountryTotal = 0;
  for (const r of rows) {
    const key = r.reportDate.toISOString().slice(0, 10);
    const label = topCountryCodes.includes(r.country) ? r.country : "Other";
    if (label === "Other") otherCountryTotal += r.downloads;
    const day = (byCountryDayMap[key] ??= {});

    day[label] = (day[label] ?? 0) + r.downloads;
  }
  const countrySeries = otherCountryTotal > 0 ? [...topCountryCodes, "Other"] : topCountryCodes;
  const byCountryDay = Object.entries(byCountryDayMap)
    .map(([date, values]) => {
      const filled: Record<string, number> = {};
      for (const c of countrySeries) filled[c] = values[c] ?? 0;

      return { date, ...filled };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const bySourceDayMap: Record<string, Record<string, number>> = {};
  const sourceTotals: Record<string, number> = {};
  for (const r of sourceRows) {
    const key = r.reportDate.toISOString().slice(0, 10);
    const label = downloadSourceLabel(r.sourceType);
    const count = r._sum.counts ?? 0;
    const day = (bySourceDayMap[key] ??= {});

    day[label] = (day[label] ?? 0) + count;
    sourceTotals[label] = (sourceTotals[label] ?? 0) + count;
  }
  const presentSourceTypes = [...DOWNLOAD_SOURCE_TYPES, "Other"].filter((t) => (sourceTotals[t] ?? 0) > 0);
  const bySourceDay = Object.entries(bySourceDayMap)
    .map(([date, values]) => {
      const filled: Record<string, number> = {};
      for (const t of presentSourceTypes) filled[t] = values[t] ?? 0;

      return { date, ...filled };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    byDay: Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date)),
    byCountry,
    countrySeries,
    byCountryDay,
    sourceTypes: presentSourceTypes,
    bySourceDay,
  };
}

export interface RevenueCatDetail {
  id: string;
  customerId: string;
  productId: string;
  store: string;
  environment: string;
  eventType: string;
  periodType: string;
  isTrialConversion: boolean;
  renewalNumber: number | null;
  transactionId: string | null;
  country: string | null;
  proceedsUsd: number;
  grossUsd: number;
  customer: {
    platform: string | null;
    platformVersion: string | null;
    appVersion: string | null;
    country: string | null;
    attributes: Record<string, string | null>;
  } | null;
}
