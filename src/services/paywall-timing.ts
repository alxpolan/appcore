import { queryPostHogHogQL } from "./posthog";

export const MATURITY_DAYS = 14;
export const MAX_USERS = 20000;

export interface TimingBucket {
  key: string;
  label: string;
  maxSeconds: number | null;
  users: number;
  subscribed: number;
  trialsStarted: number;
  cancelled: number;
}

export interface PaywallTimingRow extends TimingBucket {
  conversionRate: number | null;
  cancelRate: number | null;
}

const BUCKETS: Array<{ key: string; label: string; maxSeconds: number | null }> = [
  { key: "lt1m", label: "unter 1 Minute", maxSeconds: 60 },
  { key: "m1_5", label: "1–5 Minuten", maxSeconds: 300 },
  { key: "m5_15", label: "5–15 Minuten", maxSeconds: 900 },
  { key: "m15_60", label: "15–60 Minuten", maxSeconds: 3600 },
  { key: "gt60m", label: "über 1 Stunde", maxSeconds: null },
];

export function bucketKey(secondsToPaywall: number | null): string {
  if (secondsToPaywall == null) return "none";

  for (const bucket of BUCKETS) {
    if (bucket.maxSeconds == null || secondsToPaywall < bucket.maxSeconds) return bucket.key;
  }

  return "gt60m";
}

export function bucketLabel(key: string): string {
  if (key === "none") return "Keine Paywall gesehen";

  return BUCKETS.find((b) => b.key === key)?.label ?? key;
}

export interface SubscriptionStatus {
  autoRenewalStatus: string | null;
  givesAccess: boolean;
  currentPeriodEndsAt: Date | null;
  endsAt: Date | null;
}

export interface UserOutcome {
  distinctId: string;
  secondsToPaywall: number | null;
  trialStarted: boolean;
  converted: boolean;
  trialStartAt: Date | null;
  subscription: SubscriptionStatus | null;
}

export function trialCancelled(
  outcome: Pick<UserOutcome, "trialStarted" | "converted" | "trialStartAt" | "subscription">,
  now = new Date(),
  maturityDays: number = MATURITY_DAYS,
): boolean {
  if (!outcome.trialStarted || outcome.converted || !outcome.trialStartAt) return false;

  if (outcome.subscription) {
    if (outcome.subscription.autoRenewalStatus === "will_not_renew") return true;

    const periodEnd = outcome.subscription.currentPeriodEndsAt ?? outcome.subscription.endsAt;

    return !outcome.subscription.givesAccess && periodEnd != null && now.getTime() > periodEnd.getTime();
  }

  const ageMs = now.getTime() - outcome.trialStartAt.getTime();

  return ageMs > maturityDays * 24 * 60 * 60 * 1000;
}

export function summarizeBuckets(
  outcomes: UserOutcome[],
  now = new Date(),
  maturityDays: number = MATURITY_DAYS,
): PaywallTimingRow[] {
  const keys = [...BUCKETS.map((b) => b.key), "none"];
  const rows = new Map<string, TimingBucket>(
    keys.map((key) => [
      key,
      {
        key,
        label: bucketLabel(key),
        maxSeconds: BUCKETS.find((b) => b.key === key)?.maxSeconds ?? null,
        users: 0,
        subscribed: 0,
        trialsStarted: 0,
        cancelled: 0,
      },
    ]),
  );

  for (const outcome of outcomes) {
    const row = rows.get(bucketKey(outcome.secondsToPaywall))!;

    row.users += 1;

    if (outcome.converted) row.subscribed += 1;
    if (outcome.trialStarted) row.trialsStarted += 1;
    if (trialCancelled(outcome, now, maturityDays)) row.cancelled += 1;
  }

  return [...rows.values()]
    .filter((row) => row.users > 0 || row.key === "none")
    .map((row) => ({
      ...row,
      conversionRate: row.users > 0 ? row.subscribed / row.users : null,
      cancelRate: row.trialsStarted > 0 ? row.cancelled / row.trialsStarted : null,
    }));
}

export interface SubscriptionRow {
  customerId: string;
  autoRenewalStatus: string | null;
  givesAccess: boolean;
  currentPeriodEndsAt: Date | null;
  endsAt: Date | null;
  startsAt: Date | null;
}

export function latestSubscriptionByUser(rows: SubscriptionRow[]): Map<string, SubscriptionStatus> {
  const latestByUser = new Map<string, SubscriptionRow>();

  for (const row of rows) {
    const existing = latestByUser.get(row.customerId);

    if (!existing || (row.startsAt?.getTime() ?? 0) > (existing.startsAt?.getTime() ?? 0)) {
      latestByUser.set(row.customerId, row);
    }
  }

  return new Map(
    [...latestByUser.entries()].map(([customerId, row]) => [
      customerId,
      {
        autoRenewalStatus: row.autoRenewalStatus,
        givesAccess: row.givesAccess,
        currentPeriodEndsAt: row.currentPeriodEndsAt,
        endsAt: row.endsAt,
      },
    ]),
  );
}

export interface CustomerTx {
  customerId: string;
  eventType: string;
  periodType: string;
  proceedsUsd: number;
  isTrialConversion: boolean;
  occurredAt: Date;
}

export function buildUserOutcomes(
  anchorByUser: Map<string, Date | null>,
  firstPaywallByUser: Map<string, Date | null>,
  transactionsByUser: Map<string, CustomerTx[]>,
  subscriptionByUser: Map<string, SubscriptionStatus> = new Map(),
): UserOutcome[] {
  const outcomes: UserOutcome[] = [];

  for (const [distinctId, anchorAt] of anchorByUser) {
    if (!anchorAt) continue;

    const firstPaywall = firstPaywallByUser.get(distinctId) ?? null;
    const secondsToPaywall =
      firstPaywall && firstPaywall.getTime() >= anchorAt.getTime()
        ? (firstPaywall.getTime() - anchorAt.getTime()) / 1000
        : null;
    const txs = transactionsByUser.get(distinctId) ?? [];
    const trialTxs = txs.filter((t) => t.eventType === "INITIAL_PURCHASE" && t.periodType === "TRIAL");
    const converted = txs.some((t) => t.isTrialConversion || t.proceedsUsd > 0);
    const trialStartAt = trialTxs.length > 0 ? new Date(Math.min(...trialTxs.map((t) => t.occurredAt.getTime()))) : null;
    const subscription = subscriptionByUser.get(distinctId) ?? null;

    outcomes.push({
      distinctId,
      secondsToPaywall,
      trialStarted: trialTxs.length > 0,
      converted,
      trialStartAt,
      subscription,
    });
  }

  return outcomes;
}

export async function computePaywallTiming(
  host: string,
  apiKey: string,
  projectId: string,
  distinctIds: string[],
  anchorEvent?: string | null,
): Promise<Array<{ distinctId: string; firstSeen: Date | null; firstPaywall: Date | null; anchorAt: Date | null }>> {
  const { results } = await queryPostHogHogQL(
    host,
    apiKey,
    projectId,
    "SELECT distinct_id, min(timestamp) AS first_seen, minIf(timestamp, event = 'paywall_shown') AS first_paywall, minIf(timestamp, event = {anchorEvent}) AS anchor_at FROM events WHERE distinct_id IN {distinctIds} GROUP BY distinct_id HAVING countIf(NOT startsWith(event, 'rc_')) > 0 LIMIT 100000",
    { distinctIds, anchorEvent: anchorEvent ?? "" },
  );

  const useFirstSeenAsAnchor = !anchorEvent || anchorEvent === "$first_event";

  return results.map((row) => {
    const [distinctId, firstSeen, firstPaywall, anchorAt] = row as [string, string | null, string | null, string | null];
    const seen = firstSeen ? new Date(firstSeen) : null;
    const paywallTime = firstPaywall ? new Date(firstPaywall).getTime() : NaN;
    const paywall = !Number.isNaN(paywallTime) && paywallTime > 0 ? new Date(paywallTime) : null;
    const anchorTime = anchorAt ? new Date(anchorAt).getTime() : NaN;
    const anchorEventTime = !Number.isNaN(anchorTime) && anchorTime > 0 ? new Date(anchorTime) : null;
    const anchor = useFirstSeenAsAnchor ? seen : anchorEventTime;

    return { distinctId, firstSeen: seen, firstPaywall: paywall, anchorAt: anchor };
  });
}
