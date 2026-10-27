import { prisma } from "../config";
import { fmtDate } from "./asc-analytics-core";

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

export const TRIAL_COLUMNS = [
  "Active Free Trial Introductory Offer Subscriptions",
  "Active Free Trial Promotional Offer Subscriptions",
  "Free Trial Offer Code Subscriptions",
  "Free Trial Win-Back Offers",
];

export function activeFreeTrials(row: Record<string, string>): number {
  if (TRIAL_COLUMNS.some((column) => column in row)) {
    return TRIAL_COLUMNS.reduce((sum, column) => sum + (parseInt(row[column] ?? "0", 10) || 0), 0);
  }

  return parseInt(row["Active Free Trials"] ?? "0", 10) || 0;
}

export const MAX_TRIAL_CANCELLATION_BACKFILL_DAYS = 95;

export function parseOfferDurationDays(duration: string): number | null {
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

export interface TrialCancellationRow {
  eventDateStr: string;
  subscriptionId: string;
  country: string;
  originalStartDateStr: string;
  trialEndDateStr: string;
  quantity: number;
}

export function parseTrialCancellationSegment(rows: Record<string, string>[], appAppleId: string): TrialCancellationRow[] {
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
    if (!durationDays) continue;

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

export async function storeTrialCancellationSegment(bundleId: string, rows: TrialCancellationRow[]): Promise<number> {
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
