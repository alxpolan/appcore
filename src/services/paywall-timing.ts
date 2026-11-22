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

export interface UserOutcome {
  distinctId: string;
  secondsToPaywall: number | null;
  trialStarted: boolean;
  converted: boolean;
  trialStartAt: Date | null;
}

export function trialCancelled(
  outcome: Pick<UserOutcome, "trialStarted" | "converted" | "trialStartAt">,
  now = new Date(),
): boolean {
  if (!outcome.trialStarted || outcome.converted || !outcome.trialStartAt) return false;

  const ageMs = now.getTime() - outcome.trialStartAt.getTime();

  return ageMs > MATURITY_DAYS * 24 * 60 * 60 * 1000;
}

export function summarizeBuckets(outcomes: UserOutcome[], now = new Date()): PaywallTimingRow[] {
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
    if (trialCancelled(outcome, now)) row.cancelled += 1;
  }

  return [...rows.values()]
    .filter((row) => row.users > 0 || row.key === "none")
    .map((row) => ({
      ...row,
      conversionRate: row.users > 0 ? row.subscribed / row.users : null,
      cancelRate: row.trialsStarted > 0 ? row.cancelled / row.trialsStarted : null,
    }));
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
  firstSeenByUser: Map<string, Date | null>,
  firstPaywallByUser: Map<string, Date | null>,
  transactionsByUser: Map<string, CustomerTx[]>,
): UserOutcome[] {
  const outcomes: UserOutcome[] = [];

  for (const [distinctId, firstSeen] of firstSeenByUser) {
    if (!firstSeen) continue;

    const firstPaywall = firstPaywallByUser.get(distinctId) ?? null;
    const secondsToPaywall =
      firstPaywall && firstPaywall.getTime() >= firstSeen.getTime()
        ? (firstPaywall.getTime() - firstSeen.getTime()) / 1000
        : null;
    const txs = transactionsByUser.get(distinctId) ?? [];
    const trialTxs = txs.filter((t) => t.eventType === "INITIAL_PURCHASE" && t.periodType === "TRIAL");
    const converted = txs.some((t) => t.isTrialConversion || t.proceedsUsd > 0);
    const trialStartAt = trialTxs.length > 0 ? new Date(Math.min(...trialTxs.map((t) => t.occurredAt.getTime()))) : null;

    outcomes.push({ distinctId, secondsToPaywall, trialStarted: trialTxs.length > 0, converted, trialStartAt });
  }

  return outcomes;
}

export async function computePaywallTiming(
  host: string,
  apiKey: string,
  projectId: string,
  distinctIds: string[],
): Promise<Array<{ distinctId: string; firstSeen: Date | null; firstPaywall: Date | null }>> {
  const { results } = await queryPostHogHogQL(
    host,
    apiKey,
    projectId,
    "SELECT distinct_id, min(timestamp) AS first_seen, minIf(timestamp, event = 'paywall_shown') AS first_paywall FROM events WHERE distinct_id IN {distinctIds} GROUP BY distinct_id LIMIT 100000",
    { distinctIds },
  );

  return results.map((row) => {
    const [distinctId, firstSeen, firstPaywall] = row as [string, string | null, string | null];
    const seen = firstSeen ? new Date(firstSeen) : null;
    const paywallTime = firstPaywall ? new Date(firstPaywall).getTime() : NaN;
    const paywall = !Number.isNaN(paywallTime) && paywallTime > 0 ? new Date(paywallTime) : null;

    return { distinctId, firstSeen: seen, firstPaywall: paywall };
  });
}
