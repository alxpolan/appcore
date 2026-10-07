import zlib from "zlib";
import axios from "./utils/http";
import { prisma, logger } from "../config";
import type { EffectiveSettings } from "../config/userSettings";
import { generateASCToken } from "./utils/asc-token";
import { AppStoreConnectClient } from "./appstore-connect";
import { fetchSubscriptionPrices } from "./asc-subscription-prices";
import { ALPHA2_TO_ALPHA3 } from "./utils/territory-codes";

function parseTsv(raw: string): Record<string, string>[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cols[i] ?? "").trim()]));
  });
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type ReportKind = "engagement" | "usage" | "downloads" | "purchases" | "installDeletion";

const TRACKED_ANALYTICS_REPORTS: { category: string; name: string; kind: ReportKind; namePattern?: RegExp }[] = [
  { category: "APP_STORE_ENGAGEMENT", name: "App Store Discovery and Engagement Standard", kind: "engagement" },
  { category: "APP_USAGE", name: "App Sessions Standard", kind: "usage" },
  {
    category: "APP_USAGE",
    name: "App Store Installation and Deletion Standard",
    kind: "installDeletion",
    // Tolerate singular/plural variants of Apple's report name.
    namePattern: /^app store installations? and deletions? standard$/i,
  },
  { category: "COMMERCE", name: "App Downloads Standard", kind: "downloads" },
  { category: "COMMERCE", name: "App Store Purchases Standard", kind: "purchases" },
];

type AnalyticsMetrics = { impressions: number; pageViews: number; taps: number; sessions: number };

function aggregateAnalyticsSegment(
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

function parseAnalyticsSegment(rows: Record<string, string>[], kind: "engagement" | "usage") {
  return aggregateAnalyticsSegment(rows, kind, "Territory", (raw) => raw.toUpperCase().trim() || "WW");
}

function parsePlatformSegment(rows: Record<string, string>[], kind: "engagement" | "usage") {
  return aggregateAnalyticsSegment(rows, kind, "Platform Version", (raw) => raw.trim() || "Unknown");
}

async function storeAnalyticsSegment(
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

async function storePlatformSegment(
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

interface DownloadRow {
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

function parseDownloadsSegment(rows: Record<string, string>[]): DownloadRow[] {
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

async function storeDownloadsSegment(bundleId: string, rows: DownloadRow[]): Promise<number> {
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

interface PurchaseRow {
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

function parsePurchasesSegment(rows: Record<string, string>[]): PurchaseRow[] {
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

async function storePurchasesSegment(bundleId: string, rows: PurchaseRow[]): Promise<number> {
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

interface SessionCohortRow {
  dateStr: string;
  downloadDate: string;
  sessions: number;
  totalDuration: number;
  uniqueDevices: number;
}

// Groups session rows by report day and install-cohort day ("App Download Date").
// This is the basis for retention: which install cohort is still active n days later.
function parseSessionCohortSegment(rows: Record<string, string>[]): SessionCohortRow[] {
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

async function storeSessionCohortSegment(bundleId: string, rows: SessionCohortRow[]): Promise<number> {
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

interface InstallDeletionRow {
  dateStr: string;
  event: string;
  territory: string;
  counts: number;
  uniqueDevices: number;
}

function parseInstallDeletionSegment(rows: Record<string, string>[]): InstallDeletionRow[] {
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

async function storeInstallDeletionSegment(bundleId: string, rows: InstallDeletionRow[]): Promise<number> {
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

export interface AnalyticsSyncResult {
  downloadDays: number;
  reviewsFetched: number;
  error?: string;
}

export interface TrialPotential {
  reportDate: string | null;
  trialCount: number;
  potentialProceedsUsd: number | null;
  unpricedTrials: number;
  countryTotals: { country: string; trialCount: number; proceedsUsd: number }[];
}

const TRIAL_COLUMNS = [
  "Active Free Trial Introductory Offer Subscriptions",
  "Active Free Trial Promotional Offer Subscriptions",
  "Free Trial Offer Code Subscriptions",
  "Free Trial Win-Back Offers",
];

function activeFreeTrials(row: Record<string, string>): number {
  // The legacy column was replaced by separate offer columns in version 1_3.
  if (TRIAL_COLUMNS.some((column) => column in row)) {
    return TRIAL_COLUMNS.reduce((sum, column) => sum + (parseInt(row[column] ?? "0", 10) || 0), 0);
  }
  return parseInt(row["Active Free Trials"] ?? "0", 10) || 0;
}

// Real-world free trials run from a few days to a few months; this bounds how
// far back the SUBSCRIPTION_EVENT report is scanned for cancellations whose
// trial window might still be running today. A trial configured longer than
// this (rare) won't be caught.
const MAX_TRIAL_CANCELLATION_BACKFILL_DAYS = 95;

// Parses the "Subscription Offer Duration" column of the Subscription Event
// report, e.g. "7 Days", "3 Days", "1 Week", "2 Weeks", "1 Month", "1 Year".
// Apple doesn't restrict this to a fixed enum (confirmed against real data:
// a 7-day trial reports as "7 Days", not "1 Week"), so parse the count+unit
// instead of matching a fixed string table.
function parseOfferDurationDays(duration: string): number | null {
  const match = duration.trim().match(/^(\d+)\s+(Day|Days|Week|Weeks|Month|Months|Year|Years)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("month")) return n * 30;
  if (unit.startsWith("year")) return n * 365;
  return null;
}

interface TrialCancellationRow {
  eventDateStr: string;
  subscriptionId: string;
  country: string;
  originalStartDateStr: string;
  trialEndDateStr: string;
  quantity: number;
}

// A subscriber who turns off auto-renew during a free trial still shows up as
// an "active" trial in the daily subscription summary report until the trial
// actually ends, even though we already know they won't convert. This report
// is the only place that cancellation shows up before the trial lapses.
function parseTrialCancellationSegment(rows: Record<string, string>[], appAppleId: string): TrialCancellationRow[] {
  const byKey = new Map<string, TrialCancellationRow>();

  for (const row of rows) {
    if ((row["App Apple ID"] ?? "").trim() !== appAppleId) continue;
    if ((row["Event"] ?? "").trim() !== "Cancel") continue;
    if ((row["Subscription Offer Type"] ?? "").trim() !== "Free Trial") continue;

    const eventDateStr = (row["Event Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateStr)) continue;

    const originalStartDateStr = (row["Original Start Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(originalStartDateStr)) continue;

    const durationDays = parseOfferDurationDays(row["Subscription Offer Duration"] ?? "");
    if (!durationDays) continue; // Unrecognized duration - skip rather than guess.

    const subscriptionId = (row["Subscription Apple ID"] ?? "").trim();
    const country = (row["Country"] ?? "").toUpperCase().trim();
    const quantity = parseInt(row["Quantity"] ?? "0", 10) || 0;
    if (!subscriptionId || !country || quantity <= 0) continue;

    const trialEnd = new Date(originalStartDateStr);
    trialEnd.setUTCDate(trialEnd.getUTCDate() + durationDays);
    const trialEndDateStr = fmtDate(trialEnd);

    const key = `${subscriptionId}::${country}::${originalStartDateStr}::${eventDateStr}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += quantity;
    else byKey.set(key, { eventDateStr, subscriptionId, country, originalStartDateStr, trialEndDateStr, quantity });
  }

  return [...byKey.values()];
}

async function storeTrialCancellationSegment(bundleId: string, rows: TrialCancellationRow[]): Promise<number> {
  await Promise.all(
    rows.map((r) =>
      prisma.appStoreTrialCancellation.upsert({
        where: {
          trialCancelDimensions: {
            bundleId,
            subscriptionId: r.subscriptionId,
            country: r.country,
            originalStartDate: new Date(r.originalStartDateStr),
            eventDate: new Date(r.eventDateStr),
          },
        },
        create: {
          bundleId,
          subscriptionId: r.subscriptionId,
          country: r.country,
          originalStartDate: new Date(r.originalStartDateStr),
          trialEndDate: new Date(r.trialEndDateStr),
          eventDate: new Date(r.eventDateStr),
          quantity: r.quantity,
        },
        update: { quantity: r.quantity, trialEndDate: new Date(r.trialEndDateStr) },
      }),
    ),
  );
  return rows.length;
}

export class AscAnalyticsService {
  private readonly settings: EffectiveSettings;
  private readonly BASE = "https://api.appstoreconnect.apple.com/v1";

  constructor(settings: EffectiveSettings) {
    this.settings = settings;
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${generateASCToken({
        issuerId: this.settings.ascIssuerId,
        keyId: this.settings.ascKeyId,
        privateKey: this.settings.ascPrivateKey,
      })}`,
    };
  }

  private logRateLimit(headers: Record<string, any>): void {
    const header = headers?.["x-rate-limit"];
    if (!header) return;

    const lim = String(header).match(/user-hour-lim:(\d+)/)?.[1];
    const rem = String(header).match(/user-hour-rem:(\d+)/)?.[1];
    if (!lim || !rem) return;

    const limit = parseInt(lim, 10);
    const remaining = parseInt(rem, 10);
    const pct = Math.round((remaining / limit) * 100);
    logger.debug(`ASC rate limit: ${remaining}/${limit} remaining (${pct}%)`);

    const teamId = this.settings.teamId;
    if (teamId) {
      prisma.ascRateLimit
        .upsert({
          where: { teamId },
          update: { hourLimit: limit, hourRemaining: remaining },
          create: { teamId, hourLimit: limit, hourRemaining: remaining },
        })
        .catch((err: unknown) => logger.warn("Failed to persist ASC rate limit", err));
    }
  }

  async fetchTrialPotential(appAppleId: string, bundleId: string): Promise<TrialPotential> {
    if (!this.settings.ascVendorNumber) {
      return { reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] };
    }

    const headers = this.authHeaders();
    let reportDate: string | null = null;
    let rows: Record<string, string>[] = [];

    // Apple's daily report is usually available the next day; allow for delayed delivery.
    for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - daysAgo);
      const date = fmtDate(day);
      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SUBSCRIPTION",
            "filter[reportSubType]": "SUMMARY",
            "filter[version]": "1_3",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": date,
          },
          responseType: "arraybuffer",
        });
        this.logRateLimit(resp.headers);
        rows = parseTsv(zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8"));
        reportDate = date;
        break;
      } catch (err: any) {
        if (err?.response?.status === 404) continue;
        throw err;
      }
    }

    if (!reportDate) return { reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] };

    const trialsBySubscriptionAndCountry = new Map<string, { subscriptionId: string; country: string; territory: string | null; count: number }>();
    let trialCount = 0;
    let unpricedTrials = 0;
    for (const row of rows) {
      if ((row["App Apple ID"] ?? "").trim() !== appAppleId) continue;
      const subscriptionId = (row["Subscription Apple ID"] ?? "").trim();
      const count = activeFreeTrials(row);
      if (count <= 0) continue;
      trialCount += count;
      const country = (row["Country"] ?? "").trim().toUpperCase();
      const territory = ALPHA2_TO_ALPHA3[country] ?? null;
      if (!subscriptionId || !territory) {
        unpricedTrials += count;
        continue;
      }
      const key = `${subscriptionId}:${territory}`;
      const current = trialsBySubscriptionAndCountry.get(key);
      trialsBySubscriptionAndCountry.set(key, { subscriptionId, country, territory, count: (current?.count ?? 0) + count });
    }

    const today = fmtDate(new Date());

    // Subscribers who already turned off auto-renew during their trial still
    // count as "active" above (they keep access until the trial ends), but we
    // already know they won't convert - drop them out of the money math.
    const cancellations = await prisma.appStoreTrialCancellation.findMany({
      where: { bundleId, trialEndDate: { gte: new Date(today) } },
      select: { subscriptionId: true, country: true, quantity: true },
    });
    const cancelledByKey = new Map<string, number>();
    for (const c of cancellations) {
      const key = `${c.subscriptionId}:${c.country}`;
      cancelledByKey.set(key, (cancelledByKey.get(key) ?? 0) + c.quantity);
    }

    const asc = new AppStoreConnectClient({
      issuerId: this.settings.ascIssuerId,
      keyId: this.settings.ascKeyId,
      privateKey: this.settings.ascPrivateKey,
    }, { teamId: this.settings.teamId });
    const pricesBySubscription = new Map<string, Awaited<ReturnType<typeof fetchSubscriptionPrices>>>();
    const countryTotals = new Map<string, { country: string; trialCount: number; proceedsUsd: number }>();
    for (const { subscriptionId, country, territory, count: rawCount } of trialsBySubscriptionAndCountry.values()) {
      const alreadyOptedOut = cancelledByKey.get(`${subscriptionId}:${country}`) ?? 0;
      const count = Math.max(0, rawCount - alreadyOptedOut);
      if (count <= 0) continue; // Known non-converters - skip entirely, don't count as "unpriced" either.

      try {
        let prices = pricesBySubscription.get(subscriptionId);
        if (!prices) {
          prices = await fetchSubscriptionPrices(asc, subscriptionId);
          pricesBySubscription.set(subscriptionId, prices);
        }
        const current = prices
          .filter((price) => price.territory === territory && (!price.startDate || price.startDate.slice(0, 10) <= today))
          .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
        const proceedsUsd = current?.proceedsUsd == null ? NaN : Number(current.proceedsUsd);
        if (!Number.isFinite(proceedsUsd)) {
          unpricedTrials += count;
        } else {
          const total = countryTotals.get(country) ?? { country, trialCount: 0, proceedsUsd: 0 };
          total.trialCount += count;
          total.proceedsUsd += count * proceedsUsd;
          countryTotals.set(country, total);
        }
      } catch (err: any) {
        logger.warn(`Fetching prices for subscription ${subscriptionId}: ${err?.message ?? err}`);
        unpricedTrials += count;
      }
    }

    const totals = [...countryTotals.values()].sort((a, b) => b.trialCount - a.trialCount || a.country.localeCompare(b.country));
    const potentialProceedsUsd = totals.reduce((sum, total) => sum + total.proceedsUsd, 0);
    return {
      reportDate,
      trialCount,
      potentialProceedsUsd: unpricedTrials > 0 ? null : Math.round(potentialProceedsUsd * 100) / 100,
      unpricedTrials,
      countryTotals: totals.map((total) => ({ ...total, proceedsUsd: Math.round(total.proceedsUsd * 100) / 100 })),
    };
  }

  async fetchSalesReports(bundleId: string, ascAppId: string, daysBack = 60): Promise<number> {
    if (!this.settings.ascVendorNumber) {
      logger.warn("ASC vendor number not configured - skipping sales reports");
      return 0;
    }

    const headers = this.authHeaders();
    let storedDays = 0;

    for (let i = 1; i <= daysBack; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = fmtDate(date);

      if (i > 2) {
        const existing = await prisma.appStoreAnalytics.findFirst({
          where: {
            bundleId,
            reportDate: new Date(dateStr),
          },
        });
        if (existing) continue;
      }

      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SALES",
            "filter[reportSubType]": "SUMMARY",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": dateStr,
          },
          responseType: "arraybuffer",
        });
        this.logRateLimit(resp.headers);

        const raw = zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8");
        const rows = parseTsv(raw);

        const byCountry: Record<
          string,
          {
            downloads: number;
            updates: number;
            proceeds: number;
          }
        > = {};

        for (const row of rows) {
          const rowAppId = (row["Apple Identifier"] ?? "").trim();
          if (ascAppId && rowAppId && rowAppId !== ascAppId) continue;

          const typeId = row["Product Type Identifier"] ?? "";
          const units = parseInt(row["Units"] ?? "0", 10) || 0;
          const proceeds = parseFloat(row["Developer Proceeds"] ?? "0") || 0;
          const country = (row["Country Code"] ?? "").toUpperCase().trim();
          if (!country) continue;

          if (!byCountry[country]) {
            byCountry[country] = {
              downloads: 0,
              updates: 0,
              proceeds: 0,
            };
          }

          if (typeId === "1" || typeId === "1F") {
            byCountry[country].downloads += units;
            byCountry[country].proceeds += proceeds;
          } else if (typeId === "1T") {
            byCountry[country].updates += units;
          } else if (typeId === "7") {
            byCountry[country].proceeds += proceeds;
          }
        }

        const reportDate = new Date(dateStr);
        const countryEntries = Object.entries(byCountry);

        if (countryEntries.length > 0) {
          await Promise.all(
            countryEntries.map(([country, agg]) =>
              prisma.appStoreAnalytics.upsert({
                where: {
                  bundleId_reportDate_country: { bundleId, reportDate, country },
                },
                create: { bundleId, reportDate, country, ...agg },
                update: agg,
              }),
            ),
          );

          storedDays++;
          logger.debug(`Sales report stored: ${bundleId} ${dateStr} (${countryEntries.length} countries)`);
        }
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 400) {
          logger.debug(`No sales report for ${dateStr}`);
          continue;
        }
        logger.warn(`Sales report fetch failed for ${dateStr}: ${err?.message ?? err}`);
      }
    }

    return storedDays;
  }

  async fetchTrialCancellations(bundleId: string, appAppleId: string, daysBack = 3): Promise<number> {
    if (!this.settings.ascVendorNumber || !appAppleId) return 0;

    const headers = this.authHeaders();
    const cappedDaysBack = Math.min(daysBack, MAX_TRIAL_CANCELLATION_BACKFILL_DAYS);
    let stored = 0;

    for (let i = 1; i <= cappedDaysBack; i++) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - i);
      const dateStr = fmtDate(day);

      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SUBSCRIPTION_EVENT",
            "filter[reportSubType]": "SUMMARY",
            "filter[version]": "1_3",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": dateStr,
          },
          responseType: "arraybuffer",
        });
        this.logRateLimit(resp.headers);

        const raw = zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8");
        const rows = parseTsv(raw);
        const cancelRows = parseTrialCancellationSegment(rows, appAppleId);
        if (cancelRows.length > 0) {
          stored += await storeTrialCancellationSegment(bundleId, cancelRows);
        }
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 400) {
          logger.debug(`No subscription event report for ${dateStr}`);
          continue;
        }
        logger.warn(`Subscription event report fetch failed for ${dateStr}: ${err?.message ?? err}`);
      }
    }

    return stored;
  }

  private async processAnalyticsRequest(
    bundleId: string,
    requestId: string,
    daysBack: number,
    daysBackByKind?: Partial<Record<ReportKind, number>>,
  ): Promise<number> {
    const headers = this.authHeaders();

    let reportItems: Array<{ id: string; kind: ReportKind }> = [];
    try {
      const reportsResp = await axios.get(`${this.BASE}/analyticsReportRequests/${requestId}/reports`, { headers });
      this.logRateLimit(reportsResp.headers);

      const reports: any[] = reportsResp.data?.data ?? [];

      logger.debug(
        `Analytics request ${requestId}: ${reports.length} report(s) – categories: ${reports.map((r) => r.attributes?.category).join(", ")}`,
      );

      reportItems = reports
        .map((r: any) => {
          const match = TRACKED_ANALYTICS_REPORTS.find(
            (t) =>
              t.category === r.attributes?.category &&
              (t.name === r.attributes?.name || t.namePattern?.test(r.attributes?.name ?? "")),
          );
          return match && r.id ? { id: r.id as string, kind: match.kind } : null;
        })
        .filter((r): r is { id: string; kind: ReportKind } => r !== null);

      if (reportItems.length === 0) {
        logger.info(`No standard engagement or session reports available yet for request ${requestId} (${bundleId}).`);
        return 0;
      }
    } catch (err: any) {
      logger.warn(
        `Listing reports for request ${requestId}: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
      );
      return 0;
    }

    let storedRows = 0;

    for (const reportItem of reportItems) {
      const reportId = reportItem.id;
      const kindDaysBack = daysBackByKind?.[reportItem.kind] ?? daysBack;
      const sinceCutoff = new Date();
      sinceCutoff.setDate(sinceCutoff.getDate() - kindDaysBack);
      let instances: any[] = [];

      try {
        const instResp = await axios.get(`${this.BASE}/analyticsReports/${reportId}/instances`, {
          headers,
          params: { "filter[granularity]": "DAILY", limit: 200 },
        });

        this.logRateLimit(instResp.headers);
        const all: any[] = instResp.data?.data ?? [];

        instances = all.filter((inst: any) => {
          const pd: string | undefined = inst.attributes?.processingDate;
          return !pd || new Date(pd) >= sinceCutoff;
        });

        logger.debug(
          `Report ${reportId}: ${all.length} total instances, ${instances.length} within daysBack=${kindDaysBack}`,
        );
      } catch (err: any) {
        logger.warn(
          `Fetching instances for report ${reportId}: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
        );
        continue;
      }

      for (const instance of instances) {
        let segmentUrls: string[] = [];

        try {
          const segResp = await axios.get(`${this.BASE}/analyticsReportInstances/${instance.id}/segments`, {
            headers,
          });

          this.logRateLimit(segResp.headers);
          segmentUrls = (segResp.data?.data ?? []).map((s: any) => s.attributes?.url).filter(Boolean);
        } catch (err: any) {
          logger.warn(`Fetching segments for instance ${instance.id}: ${err?.message ?? err}`);
          continue;
        }

        for (const url of segmentUrls) {
          try {
            const dlResp = await axios.get(url, { responseType: "arraybuffer" });
            const raw = zlib.gunzipSync(Buffer.from(dlResp.data)).toString("utf-8");
            const rows = parseTsv(raw);

            if (rows.length === 0) continue;
            logger.debug(`${reportItem.kind} segment columns: ${Object.keys(rows[0]).join(" | ")}`);

            if (reportItem.kind === "engagement" || reportItem.kind === "usage") {
              const metricsByDayCountry = parseAnalyticsSegment(rows, reportItem.kind);
              storedRows += await storeAnalyticsSegment(bundleId, reportItem.kind, metricsByDayCountry);

              const metricsByDayPlatform = parsePlatformSegment(rows, reportItem.kind);
              await storePlatformSegment(bundleId, reportItem.kind, metricsByDayPlatform);

              if (reportItem.kind === "usage") {
                const cohortRows = parseSessionCohortSegment(rows);
                await storeSessionCohortSegment(bundleId, cohortRows);
              }
            } else if (reportItem.kind === "installDeletion") {
              const installDeletionRows = parseInstallDeletionSegment(rows);
              storedRows += await storeInstallDeletionSegment(bundleId, installDeletionRows);
            } else if (reportItem.kind === "downloads") {
              const downloadRows = parseDownloadsSegment(rows);
              storedRows += await storeDownloadsSegment(bundleId, downloadRows);
            } else if (reportItem.kind === "purchases") {
              const purchaseRows = parsePurchasesSegment(rows);
              storedRows += await storePurchasesSegment(bundleId, purchaseRows);
            }
          } catch (err: any) {
            logger.warn(`Downloading/parsing ${reportItem.kind} segment: ${err?.message ?? err}`);
          }
        }
      }
    }

    return storedRows;
  }

  async fetchEngagementReport(
    ascAppId: string,
    bundleId: string,
    requestId: string | null,
    snapshotRequestId: string | null,
    daysBack = 60,
    daysBackByKind?: Partial<Record<ReportKind, number>>,
  ): Promise<{
    rows: number;
    requestId: string | null;
    snapshotRequestId: string | null;
  }> {
    if (!ascAppId) {
      logger.warn("ASC App ID not configured – skipping engagement report fetch");
      return { rows: 0, requestId: null, snapshotRequestId: null };
    }

    const headers = this.authHeaders();

    if (!requestId) {
      try {
        const createResp = await axios.post(
          `${this.BASE}/analyticsReportRequests`,
          {
            data: {
              type: "analyticsReportRequests",
              attributes: { accessType: "ONGOING" },
              relationships: {
                app: { data: { type: "apps", id: ascAppId } },
              },
            },
          },
          { headers },
        );

        this.logRateLimit(createResp.headers);

        requestId = createResp.data?.data?.id ?? null;
        if (!requestId) throw new Error("No request ID in create response");
        logger.info(`Created ONGOING analytics report request ${requestId} for ${bundleId}.`);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 409) {
          try {
            const listResp = await axios.get(`${this.BASE}/apps/${ascAppId}/analyticsReportRequests`, {
              headers,
              params: { "filter[accessType]": "ONGOING", limit: 10 },
            });

            this.logRateLimit(listResp.headers);
            const existing = (listResp.data?.data ?? []).find((r: any) => r.attributes?.accessType === "ONGOING");
            requestId = existing?.id ?? null;

            if (requestId) {
              logger.info(`Recovered existing ONGOING analytics request ${requestId} for ${bundleId}.`);
            } else {
              logger.warn(`Could not recover existing ONGOING request for ${bundleId}.`);
            }
          } catch (listErr: any) {
            logger.warn(`Listing existing analytics requests failed: ${listErr?.message ?? listErr}`);
          }
        } else {
          logger.warn(
            `Creating ONGOING analytics report request failed: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
          );
        }
      }

      let snapshotRows = 0;
      let resolvedSnapshotId: string | null = null;

      try {
        const snapResp = await axios.post(
          `${this.BASE}/analyticsReportRequests`,
          {
            data: {
              type: "analyticsReportRequests",
              attributes: { accessType: "ONE_TIME_SNAPSHOT" },
              relationships: {
                app: { data: { type: "apps", id: ascAppId } },
              },
            },
          },
          { headers },
        );

        this.logRateLimit(snapResp.headers);
        resolvedSnapshotId = snapResp.data?.data?.id ?? null;

        if (resolvedSnapshotId) {
          logger.info(
            `Created ONE_TIME_SNAPSHOT request ${resolvedSnapshotId} for ${bundleId} – processing historical data now.`,
          );

          snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack, daysBackByKind);
          logger.info(`ONE_TIME_SNAPSHOT processed: ${snapshotRows} rows stored for ${bundleId}.`);
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 409) {
          logger.info(`ONE_TIME_SNAPSHOT already exists for this month (${bundleId}), recovering it.`);
          try {
            const listResp = await axios.get(`${this.BASE}/apps/${ascAppId}/analyticsReportRequests`, {
              headers,
              params: { "filter[accessType]": "ONE_TIME_SNAPSHOT", limit: 10 },
            });

            this.logRateLimit(listResp.headers);
            const existingSnap = (listResp.data?.data ?? []).find(
              (r: any) => r.attributes?.accessType === "ONE_TIME_SNAPSHOT",
            );

            if (existingSnap?.id) {
              resolvedSnapshotId = existingSnap.id as string;
              snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack, daysBackByKind);
              logger.info(`Existing ONE_TIME_SNAPSHOT processed: ${snapshotRows} rows for ${bundleId}.`);
            }
          } catch (snapListErr: any) {
            logger.warn(`Could not process existing snapshot: ${snapListErr?.message ?? snapListErr}`);
          }
        } else {
          logger.info(
            `ONE_TIME_SNAPSHOT request failed (non-fatal): ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
          );
        }
      }

      return {
        rows: snapshotRows,
        requestId,
        snapshotRequestId: resolvedSnapshotId,
      };
    }

    let storedRows = await this.processAnalyticsRequest(bundleId, requestId, daysBack, daysBackByKind);

    if (snapshotRequestId) {
      const snapRows = await this.processAnalyticsRequest(bundleId, snapshotRequestId, daysBack, daysBackByKind);
      storedRows += snapRows;
      if (snapRows > 0) {
        logger.info(`ONE_TIME_SNAPSHOT catch-up: ${snapRows} rows for ${bundleId} (snapshot: ${snapshotRequestId})`);
      }
    }

    logger.info(`Engagement report: stored ${storedRows} rows for ${bundleId} (ongoing: ${requestId})`);
    return { rows: storedRows, requestId, snapshotRequestId };
  }

  async fetchReviews(ascAppId: string, bundleId: string): Promise<number> {
    const headers = this.authHeaders();
    let cursor: string | null = null;
    let total = 0;
    const maxPages = 5;

    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, any> = {
        sort: "-createdDate",
        limit: 200,
        "fields[customerReviews]": "rating,title,body,reviewerNickname,territory,createdDate",
      };
      if (cursor) params["cursor"] = cursor;

      const resp = await axios.get(`${this.BASE}/apps/${ascAppId}/customerReviews`, {
        headers,
        params,
      });

      this.logRateLimit(resp.headers);

      const reviews: any[] = resp.data?.data ?? [];

      await Promise.all(
        reviews.map((r) => {
          const attrs = r.attributes ?? {};
          return prisma.appReview.upsert({
            where: { ascReviewId: r.id },
            create: {
              ascReviewId: r.id,
              bundleId,
              rating: attrs.rating ?? 0,
              title: attrs.title ?? null,
              body: attrs.body ?? null,
              reviewerNickname: attrs.reviewerNickname ?? null,
              territory: attrs.territory ?? null,
              reviewedAt: new Date(attrs.createdDate ?? Date.now()),
            },
            update: {
              rating: attrs.rating ?? 0,
              title: attrs.title ?? null,
              body: attrs.body ?? null,
            },
          });
        }),
      );
      total += reviews.length;

      const nextCursor = resp.data?.links?.next;
      if (!nextCursor || reviews.length === 0) break;
      try {
        const url = new URL(nextCursor);
        cursor = url.searchParams.get("cursor");
      } catch {
        break;
      }
    }

    return total;
  }

  async syncAllAnalytics(bundleId: string, ascAppId: string): Promise<AnalyticsSyncResult> {
    try {
      const latestRecord = await prisma.appStoreAnalytics.findFirst({
        where: { bundleId },
        orderBy: { reportDate: "desc" },
        select: { reportDate: true },
      });

      const isFirstSync = !latestRecord;
      const salesDaysBack = isFirstSync ? 365 : 3;
      const engagementDaysBack = isFirstSync ? 60 : 3;

      logger.info(
        `Analytics sync for ${bundleId}: ${isFirstSync ? "first sync, full backfill" : `incremental, last ${salesDaysBack} days`}`,
      );

      const downloadDays = await this.fetchSalesReports(bundleId, ascAppId, salesDaysBack);

      let reviewsFetched = 0;
      if (ascAppId) {
        reviewsFetched = await this.fetchReviews(ascAppId, bundleId);
      }

      let engagementRows = 0;
      if (ascAppId) {
        try {
          const appRecord = await prisma.app.findUnique({
            where: { bundleId },
            select: {
              analyticsRequestId: true,
              analyticsSnapshotRequestId: true,
            },
          });

          const currentRequestId = appRecord?.analyticsRequestId ?? null;
          const currentSnapshotId = appRecord?.analyticsSnapshotRequestId ?? null;

          // Newly tracked reports need a one-off backfill even on incremental
          // syncs, where daysBack would only cover the last few days.
          const [installDeletionCount, sessionCohortCount] = await Promise.all([
            prisma.appStoreInstallDeletion.count({ where: { bundleId } }),
            prisma.appStoreSessionCohort.count({ where: { bundleId } }),
          ]);
          const overrides: Partial<Record<"installDeletion" | "usage", number>> = {};
          if (installDeletionCount === 0) overrides.installDeletion = 365;
          if (sessionCohortCount === 0) overrides.usage = 365;
          const daysBackByKind = Object.keys(overrides).length > 0 ? overrides : undefined;

          const result = await this.fetchEngagementReport(
            ascAppId,
            bundleId,
            currentRequestId,
            currentSnapshotId,
            engagementDaysBack,
            daysBackByKind,
          );
          engagementRows = result.rows;

          const updates: Record<string, string> = {};
          if (result.requestId && result.requestId !== currentRequestId) {
            updates.analyticsRequestId = result.requestId;
          }

          if (result.snapshotRequestId && result.snapshotRequestId !== currentSnapshotId) {
            updates.analyticsSnapshotRequestId = result.snapshotRequestId;
          }

          if (Object.keys(updates).length > 0) {
            await prisma.app.update({ where: { bundleId }, data: updates });
            logger.info(`Stored analytics IDs for ${bundleId}: ${JSON.stringify(updates)}`);
          }
        } catch (err: any) {
          logger.warn(`Engagement report fetch error (non-fatal): ${err?.message ?? err}`);
        }
      }

      let trialCancellationsFetched = 0;
      if (ascAppId) {
        try {
          const existingCancellations = await prisma.appStoreTrialCancellation.count({ where: { bundleId } });
          const trialCancelDaysBack = existingCancellations === 0 ? MAX_TRIAL_CANCELLATION_BACKFILL_DAYS : 3;
          trialCancellationsFetched = await this.fetchTrialCancellations(bundleId, ascAppId, trialCancelDaysBack);
        } catch (err: any) {
          logger.warn(`Trial cancellation sync error (non-fatal): ${err?.message ?? err}`);
        }
      }

      logger.info(
        `ASC analytics sync done: ${downloadDays} report-days, ${reviewsFetched} reviews, ${engagementRows} engagement rows, ${trialCancellationsFetched} trial cancellations`,
      );

      return { downloadDays, reviewsFetched };
    } catch (err: any) {
      const error = err?.message ?? String(err);
      logger.error("ASC analytics sync failed", { error });
      return { downloadDays: 0, reviewsFetched: 0, error };
    }
  }
}
