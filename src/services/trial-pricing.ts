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

export interface CohortEvent {
  bundleId: string;
  customerId: string;
  productId: string;
  occurredAt: Date;
}

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

export function isTrialConverted(conversions: CohortEvent[], trial: CohortEvent): boolean {
  return conversions.some(
    (conversion) =>
      conversion.bundleId === trial.bundleId &&
      conversion.customerId === trial.customerId &&
      conversion.productId === trial.productId &&
      conversion.occurredAt.getTime() >= trial.occurredAt.getTime(),
  );
}
