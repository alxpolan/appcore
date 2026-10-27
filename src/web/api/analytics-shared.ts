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
