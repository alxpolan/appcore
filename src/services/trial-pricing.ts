// Prices free-trial starts as potential proceeds so trial volume is directly
// comparable with ad spend (both money, same axis).
//
// A trial's value is the average paid proceeds of the same product observed in
// RevenueCat data. Trials for a product without any paid reference stay
// unpriced (0) instead of being guessed.

export interface PaidPriceSample {
  bundleId: string;
  productId: string;
  avgProceedsUsd: number;
}

export function buildTrialPriceMap(samples: PaidPriceSample[]): Map<string, number> {
  const prices = new Map<string, number>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.avgProceedsUsd) || sample.avgProceedsUsd <= 0) continue;
    prices.set(`${sample.bundleId}\0${sample.productId}`, Math.round(sample.avgProceedsUsd * 100) / 100);
  }
  return prices;
}

export function trialPotentialFor(
  prices: Map<string, number>,
  bundleId: string,
  productId: string,
  isTrial: boolean,
): number {
  if (!isTrial) return 0;
  return prices.get(`${bundleId}\0${productId}`) ?? 0;
}

// Cohort attribution: a trial conversion's proceeds belong to the day the
// trial started (the spend that caused it), not the conversion day.

export interface CohortEvent {
  bundleId: string;
  customerId: string;
  productId: string;
  occurredAt: Date;
}

/** Latest trial start at or before the conversion — same product preferred, same customer as fallback. */
export function findCohortStart(starts: CohortEvent[], conversion: CohortEvent): Date | null {
  let fallback: Date | null = null;
  let match: Date | null = null;
  for (const start of starts) {
    if (start.bundleId !== conversion.bundleId || start.customerId !== conversion.customerId) continue;
    if (start.occurredAt.getTime() > conversion.occurredAt.getTime()) continue;
    if (start.productId === conversion.productId) {
      if (!match || start.occurredAt > match) match = start.occurredAt;
    } else if (!fallback || start.occurredAt > fallback) {
      fallback = start.occurredAt;
    }
  }
  return match ?? fallback;
}

/** Whether a conversion exists for the same customer + product at or after the trial start. */
export function isTrialConverted(conversions: CohortEvent[], trial: CohortEvent): boolean {
  return conversions.some(
    (conversion) =>
      conversion.bundleId === trial.bundleId &&
      conversion.customerId === trial.customerId &&
      conversion.productId === trial.productId &&
      conversion.occurredAt.getTime() >= trial.occurredAt.getTime(),
  );
}
