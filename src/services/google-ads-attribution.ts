import { prisma } from "../config";
import {
  listGoogleAdsClicks,
  type GoogleAdsClick,
  type GoogleAdsCredentials,
  type GoogleAdsReportRange,
} from "./google-ads";

export interface InstallCandidate {
  customerId: string;
  bundleId: string;
  firstSeenAt: Date;
  country: string | null;
}

export type MatchConfidence = "high" | "medium";

export interface ClickMatch {
  customerId: string;
  bundleId: string;
  firstSeenAt: string;
  gclid: string;
  clickDate: string;
  clickHour: number | null;
  criterionId: string | null;
  keywordText: string | null;
  adGroupId: string | null;
  gapMinutes: number;
  confidence: MatchConfidence;
}

/** Matches beyond 24h are noise at real install densities — those installs are organic. */
const MATCH_WINDOW_MIN = 24 * 60;
const HIGH_CONFIDENCE_GAP_MIN = 120;

/** Earliest possible click time. With hour precision the click happened
 * somewhere within that hour, so the true gap can only be smaller. */
function clickStart(click: GoogleAdsClick): number {
  const hour = click.hour ?? 0;
  return Date.parse(`${click.date}T${String(hour).padStart(2, "0")}:00:00Z`);
}

/** Greedy 1:1 match, oldest install first. Pure function (no DB, no API). */
export function matchClicksToInstalls(
  clicks: GoogleAdsClick[],
  customers: InstallCandidate[],
): { matches: ClickMatch[]; organic: InstallCandidate[] } {
  const pool = [...clicks].sort((a, b) => clickStart(a) - clickStart(b));
  const ordered = [...customers].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
  const matches: ClickMatch[] = [];
  const organic: InstallCandidate[] = [];

  for (const customer of ordered) {
    const seen = customer.firstSeenAt.getTime();
    const candidates = pool
      .map((click) => ({ click, gapMinutes: (seen - clickStart(click)) / 60000 }))
      .filter(({ gapMinutes }) => gapMinutes >= 0 && gapMinutes <= MATCH_WINDOW_MIN);
    if (candidates.length === 0) {
      organic.push(customer);
      continue;
    }

    const customerCountry = (customer.country ?? "").toUpperCase();
    const scored = candidates.map((c) => {
      const clickCountry = (c.click.countryCode ?? "").toUpperCase();
      const countryBonus = customerCountry && clickCountry && customerCountry === clickCountry ? 30 : 0;
      return { ...c, score: c.gapMinutes - countryBonus };
    });
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];

    const poolIndex = pool.indexOf(best.click);
    pool.splice(poolIndex, 1);

    // Uniqueness ignores candidates whose known country contradicts the install's.
    const nearby = candidates.filter((c) => {
      if (Math.abs(c.gapMinutes - best.gapMinutes) > HIGH_CONFIDENCE_GAP_MIN) return false;
      const cc = (c.click.countryCode ?? "").toUpperCase();
      if (customerCountry && cc && cc !== customerCountry) return false;
      return true;
    });
    const confidence: MatchConfidence =
      best.gapMinutes <= HIGH_CONFIDENCE_GAP_MIN && nearby.length === 1 ? "high" : "medium";

    matches.push({
      customerId: customer.customerId,
      bundleId: customer.bundleId,
      firstSeenAt: customer.firstSeenAt.toISOString(),
      gclid: best.click.gclid,
      clickDate: best.click.date,
      clickHour: best.click.hour,
      criterionId: best.click.criterionId,
      keywordText: best.click.keywordText,
      adGroupId: best.click.adGroupId,
      gapMinutes: Math.round(best.gapMinutes),
      confidence,
    });
  }

  return { matches, organic };
}

export interface GoogleAdsAttributionKeyword {
  criterionId: string;
  keywordText: string | null;
  installs: number;
  highConfidenceInstalls: number;
  trials: number;
  proceedsUsd: number;
}

export interface GoogleAdsAttributionGapBucket {
  label: string;
  maxMinutes: number;
  count: number;
}

export interface GoogleAdsAttribution {
  range: GoogleAdsReportRange;
  clicks: number;
  hourPrecision: boolean;
  installsMatched: number;
  highConfidenceInstalls: number;
  installsOrganic: number;
  installsUnknownDate: number;
  trials: number;
  proceedsUsd: number;
  gapBuckets: GoogleAdsAttributionGapBucket[];
  byKeyword: GoogleAdsAttributionKeyword[];
  matches: ClickMatch[];
}

function eachDay(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  for (
    let t = Date.parse(`${startIso}T00:00:00Z`);
    t <= Date.parse(`${endIso}T00:00:00Z`);
    t += 86_400_000
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export async function getGoogleAdsAttribution(
  creds: GoogleAdsCredentials,
  bundleIds: string[],
  campaignId: string,
  range: GoogleAdsReportRange,
): Promise<GoogleAdsAttribution> {
  // click_view only goes 90 days back; clamp the click window.
  const minDay = new Date();
  minDay.setUTCDate(minDay.getUTCDate() - 89);
  minDay.setUTCHours(0, 0, 0, 0);
  const clickStartDay = range.startDate < minDay.toISOString().slice(0, 10) ? minDay.toISOString().slice(0, 10) : range.startDate;
  const days = eachDay(clickStartDay, range.endDate);

  const perDay = await Promise.all(days.map((day) => listGoogleAdsClicks(creds, campaignId, day)));
  const clicks = perDay.flatMap((d) => d.clicks);
  const hourPrecision = perDay.every((d) => d.hourPrecision);

  const installLookback = new Date(`${clickStartDay}T00:00:00Z`);
  const installEnd = new Date(`${range.endDate}T00:00:00Z`);
  installEnd.setUTCDate(installEnd.getUTCDate() + 1);
  const customers =
    bundleIds.length === 0
      ? []
      : await prisma.revenueCatCustomer.findMany({
          where: {
            bundleId: { in: bundleIds },
            firstSeenAt: { gte: installLookback, lt: installEnd },
          },
          select: { bundleId: true, customerId: true, country: true, firstSeenAt: true },
        });
  const unknownDate = customers.filter((c) => c.firstSeenAt == null).length;
  const candidates: InstallCandidate[] = customers
    .filter((c) => c.firstSeenAt != null)
    .map((c) => ({
      customerId: c.customerId,
      bundleId: c.bundleId,
      firstSeenAt: c.firstSeenAt!,
      country: c.country,
    }));

  const { matches, organic } = matchClicksToInstalls(clicks, candidates);

  const matchedKeys = new Set(matches.map((m) => `${m.bundleId}\0${m.customerId}`));
  const rangeStart = new Date(`${range.startDate}T00:00:00Z`);
  const rangeEnd = new Date(`${range.endDate}T00:00:00Z`);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
  const transactions =
    matchedKeys.size === 0
      ? []
      : await prisma.revenueCatTransaction.findMany({
          where: {
            bundleId: { in: bundleIds },
            occurredAt: { gte: rangeStart, lt: rangeEnd },
            environment: "production",
          },
          select: { bundleId: true, customerId: true, eventType: true, periodType: true, proceedsUsd: true },
        });

  const trialsByCustomer = new Map<string, number>();
  const proceedsByCustomer = new Map<string, number>();
  for (const t of transactions) {
    const key = `${t.bundleId}\0${t.customerId}`;
    if (!matchedKeys.has(key)) continue;
    if (t.eventType === "INITIAL_PURCHASE" && t.periodType === "TRIAL") {
      trialsByCustomer.set(key, (trialsByCustomer.get(key) ?? 0) + 1);
    }
    proceedsByCustomer.set(key, (proceedsByCustomer.get(key) ?? 0) + (t.proceedsUsd ?? 0));
  }

  const byKeywordMap = new Map<string, GoogleAdsAttributionKeyword>();
  let trials = 0;
  let proceedsUsd = 0;
  for (const m of matches) {
    const key = `${m.bundleId}\0${m.customerId}`;
    const t = trialsByCustomer.get(key) ?? 0;
    const p = proceedsByCustomer.get(key) ?? 0;
    trials += t;
    proceedsUsd += p;
    const ck = m.criterionId ?? "unknown";
    const bucket = byKeywordMap.get(ck) ?? {
      criterionId: ck,
      keywordText: m.keywordText,
      installs: 0,
      highConfidenceInstalls: 0,
      trials: 0,
      proceedsUsd: 0,
    };
    bucket.installs += 1;
    if (m.confidence === "high") bucket.highConfidenceInstalls += 1;
    if (bucket.keywordText == null) bucket.keywordText = m.keywordText;
    bucket.trials += t;
    bucket.proceedsUsd += p;
    byKeywordMap.set(ck, bucket);
  }

  const gapBuckets: GoogleAdsAttributionGapBucket[] = [
    { label: "≤1h", maxMinutes: 60, count: 0 },
    { label: "≤2h", maxMinutes: 120, count: 0 },
    { label: "≤6h", maxMinutes: 360, count: 0 },
    { label: "≤24h", maxMinutes: 1440, count: 0 },
  ];
  for (const m of matches) {
    const bucket = gapBuckets.find((b) => m.gapMinutes <= b.maxMinutes);
    if (bucket) bucket.count += 1;
  }

  return {
    range,
    clicks: clicks.length,
    hourPrecision,
    installsMatched: matches.length,
    highConfidenceInstalls: matches.filter((m) => m.confidence === "high").length,
    installsOrganic: organic.length,
    installsUnknownDate: unknownDate,
    trials,
    proceedsUsd,
    gapBuckets,
    byKeyword: [...byKeywordMap.values()].sort((a, b) => b.installs - a.installs),
    matches: matches.slice(0, 200),
  };
}
