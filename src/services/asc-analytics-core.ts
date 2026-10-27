import { prisma } from "../config";

export function parseTsv(raw: string): Record<string, string>[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");

    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cols[i] ?? "").trim()]));
  });
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type ReportKind = "engagement" | "usage" | "downloads" | "purchases" | "installDeletion" | "downloadsDetailed" | "purchasesDetailed";

export const TRACKED_ANALYTICS_REPORTS: { category: string; name: string; kind: ReportKind; namePattern?: RegExp }[] = [
  { category: "APP_STORE_ENGAGEMENT", name: "App Store Discovery and Engagement Standard", kind: "engagement" },
  { category: "APP_USAGE", name: "App Sessions Standard", kind: "usage" },
  {
    category: "APP_USAGE",
    name: "App Store Installation and Deletion Standard",
    kind: "installDeletion",
    namePattern: /^app store installations? and deletions? standard$/i,
  },
  { category: "COMMERCE", name: "App Downloads Standard", kind: "downloads" },
  { category: "COMMERCE", name: "App Store Purchases Standard", kind: "purchases" },
  { category: "COMMERCE", name: "App Downloads Detailed", kind: "downloadsDetailed" },
  { category: "COMMERCE", name: "App Store Purchases Detailed", kind: "purchasesDetailed" },
];

export type AnalyticsMetrics = { impressions: number; pageViews: number; taps: number; sessions: number };

export function aggregateAnalyticsSegment(
  rows: Record<string, string>[],
  kind: "engagement" | "usage",
  dimensionColumn: string,
  normalizeDimension: (raw: string) => string,
): Record<string, AnalyticsMetrics> {
  const metricsByDayDimension: Record<string, AnalyticsMetrics> = {};

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const dimension = normalizeDimension(row[dimensionColumn] ?? "");
    const key = `${dateStr}::${dimension}`;
    const metrics = (metricsByDayDimension[key] ??= { impressions: 0, pageViews: 0, taps: 0, sessions: 0 });

    if (kind === "usage") {
      metrics.sessions += parseInt(row["Sessions"] ?? "0", 10) || 0;
      continue;
    }

    const eventType = (row["Event"] ?? "").trim();
    const counts = parseInt(row["Counts"] ?? "0", 10) || 0;

    if (eventType === "Impression") metrics.impressions += counts;
    if (eventType === "Page view") metrics.pageViews += counts;
    if (eventType === "Tap") metrics.taps += counts;
  }

  return metricsByDayDimension;
}

export function parseAnalyticsSegment(rows: Record<string, string>[], kind: "engagement" | "usage") {
  return aggregateAnalyticsSegment(rows, kind, "Territory", (raw) => raw.toUpperCase().trim() || "WW");
}

export function parsePlatformSegment(rows: Record<string, string>[], kind: "engagement" | "usage") {
  return aggregateAnalyticsSegment(rows, kind, "Platform Version", (raw) => raw.trim() || "Unknown");
}

export async function storeAnalyticsSegment(
  bundleId: string,
  kind: "engagement" | "usage",
  metricsByDayCountry: Record<string, AnalyticsMetrics>,
): Promise<number> {
  const entries = Object.entries(metricsByDayCountry);
  await Promise.all(
    entries.map(([key, metrics]) => {
      const [dateStr, country] = key.split("::");
      const reportDate = new Date(dateStr);
      const update =
        kind === "usage"
          ? { sessions: metrics.sessions }
          : { impressions: metrics.impressions, pageViews: metrics.pageViews, taps: metrics.taps };

      return prisma.appStoreAnalytics.upsert({
        where: { bundleId_reportDate_country: { bundleId, reportDate, country } },
        create: { bundleId, reportDate, country, ...metrics },
        update,
      });
    }),
  );

  return entries.length;
}

export async function storePlatformSegment(
  bundleId: string,
  kind: "engagement" | "usage",
  metricsByDayPlatform: Record<string, AnalyticsMetrics>,
): Promise<number> {
  const entries = Object.entries(metricsByDayPlatform);
  await Promise.all(
    entries.map(([key, metrics]) => {
      const [dateStr, platformVersion] = key.split("::");
      const reportDate = new Date(dateStr);
      const update =
        kind === "usage"
          ? { sessions: metrics.sessions }
          : { impressions: metrics.impressions, pageViews: metrics.pageViews, taps: metrics.taps };

      return prisma.appStoreAnalyticsPlatform.upsert({
        where: { bundleId_reportDate_platformVersion: { bundleId, reportDate, platformVersion } },
        create: { bundleId, reportDate, platformVersion, ...metrics },
        update,
      });
    }),
  );

  return entries.length;
}

export interface DownloadRow {
  dateStr: string;
  downloadType: string;
  appVersion: string;
  device: string;
  platformVersion: string;
  sourceType: string;
  pageType: string;
  preOrder: string;
  territory: string;
  counts: number;
}

export function parseDownloadsSegment(rows: Record<string, string>[]): DownloadRow[] {
  const byKey = new Map<string, DownloadRow>();

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const dims = {
      dateStr,
      downloadType: (row["Download Type"] ?? "").trim() || "Unknown",
      appVersion: (row["App Version"] ?? "").trim() || "Unknown",
      device: (row["Device"] ?? "").trim() || "Unknown",
      platformVersion: (row["Platform Version"] ?? "").trim() || "Unknown",
      sourceType: (row["Source Type"] ?? "").trim() || "Unknown",
      pageType: (row["Page Type"] ?? "").trim() || "Unknown",
      preOrder: (row["Pre-Order"] ?? "").trim(),
      territory: (row["Territory"] ?? "").toUpperCase().trim() || "WW",
    };

    const key = Object.values(dims).join("");
    const counts = parseInt(row["Counts"] ?? "0", 10) || 0;

    const existing = byKey.get(key);

    if (existing) existing.counts += counts;
    else byKey.set(key, { ...dims, counts });
  }

  return [...byKey.values()];
}

export async function storeDownloadsSegment(bundleId: string, rows: DownloadRow[]): Promise<number> {
  await Promise.all(
    rows.map((r) => {
      const reportDate = new Date(r.dateStr);
      const dims = {
        bundleId,
        reportDate,
        downloadType: r.downloadType,
        appVersion: r.appVersion,
        device: r.device,
        platformVersion: r.platformVersion,
        sourceType: r.sourceType,
        pageType: r.pageType,
        preOrder: r.preOrder,
        territory: r.territory,
      };

      return prisma.appStoreCommerceDownload.upsert({
        where: { downloadDimensions: dims },
        create: { ...dims, counts: r.counts },
        update: { counts: r.counts },
      });
    }),
  );

  return rows.length;
}

export interface PurchaseRow {
  dateStr: string;
  purchaseType: string;
  contentName: string;
  contentAppleId: string;
  paymentMethod: string;
  device: string;
  platformVersion: string;
  sourceType: string;
  pageType: string;
  appDownloadDate: string;
  preOrder: string;
  territory: string;
  purchases: number;
  proceedsUsd: number;
  salesUsd: number;
  payingUsers: number;
}

export function parsePurchasesSegment(rows: Record<string, string>[]): PurchaseRow[] {
  const byKey = new Map<string, PurchaseRow>();

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const dims = {
      dateStr,
      purchaseType: (row["Purchase Type"] ?? "").trim() || "Unknown",
      contentName: (row["Content Name"] ?? "").trim() || "Unknown",
      contentAppleId: (row["Content Apple Identifier"] ?? "").trim(),
      paymentMethod: (row["Payment Method"] ?? "").trim() || "Unknown",
      device: (row["Device"] ?? "").trim() || "Unknown",
      platformVersion: (row["Platform Version"] ?? "").trim() || "Unknown",
      sourceType: (row["Source Type"] ?? "").trim() || "Unknown",
      pageType: (row["Page Type"] ?? "").trim() || "Unknown",
      appDownloadDate: (row["App Download Date"] ?? "").trim(),
      preOrder: (row["Pre-Order"] ?? "").trim(),
      territory: (row["Territory"] ?? "").toUpperCase().trim() || "WW",
    };

    const key = Object.values(dims).join("");
    const purchases = parseInt(row["Purchases"] ?? "0", 10) || 0;
    const proceedsUsd = parseFloat(row["Proceeds in USD"] ?? "0") || 0;
    const salesUsd = parseFloat(row["Sales in USD"] ?? "0") || 0;
    const payingUsers = parseInt(row["Paying Users"] ?? "0", 10) || 0;

    const existing = byKey.get(key);

    if (existing) {
      existing.purchases += purchases;
      existing.proceedsUsd += proceedsUsd;
      existing.salesUsd += salesUsd;
      existing.payingUsers += payingUsers;
    } else {
      byKey.set(key, { ...dims, purchases, proceedsUsd, salesUsd, payingUsers });
    }
  }

  return [...byKey.values()];
}

export async function storePurchasesSegment(bundleId: string, rows: PurchaseRow[]): Promise<number> {
  await Promise.all(
    rows.map((r) => {
      const reportDate = new Date(r.dateStr);
      const dims = {
        bundleId,
        reportDate,
        purchaseType: r.purchaseType,
        contentName: r.contentName,
        contentAppleId: r.contentAppleId,
        paymentMethod: r.paymentMethod,
        device: r.device,
        platformVersion: r.platformVersion,
        sourceType: r.sourceType,
        pageType: r.pageType,
        appDownloadDate: r.appDownloadDate,
        preOrder: r.preOrder,
        territory: r.territory,
      };

      const metrics = {
        purchases: r.purchases,
        proceedsUsd: r.proceedsUsd,
        salesUsd: r.salesUsd,
        payingUsers: r.payingUsers,
      };

      return prisma.appStoreCommercePurchase.upsert({
        where: { purchaseDimensions: dims },
        create: { ...dims, ...metrics },
        update: metrics,
      });
    }),
  );

  return rows.length;
}
