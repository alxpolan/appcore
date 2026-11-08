export const RETENTION_OFFER_MODES = ["PAY_AS_YOU_GO", "PAY_UP_FRONT", "FREE_TRIAL"] as const;

export type RetentionOfferMode = (typeof RETENTION_OFFER_MODES)[number];

export const RETENTION_OFFER_DURATIONS = [
  "THREE_DAYS",
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
] as const;

export type RetentionOfferDuration = (typeof RETENTION_OFFER_DURATIONS)[number];

export const RETENTION_OFFER_PLAN_TYPES = ["MONTHLY", "UPFRONT"] as const;

export type RetentionOfferPlanType = (typeof RETENTION_OFFER_PLAN_TYPES)[number];

export interface RetentionOfferInput {
  subscriptionId: string;
  referenceName: string;
  offerId: string;
  duration: string;
  offerMode: string;
  periodCount: number;
  customerEligibilityPaidSubscriptionDurationInMonths: number;
  customerEligibilityWaitBetweenOffersInMonths?: number | null;
  targetSubscriptionPlanType?: string | null;
  priceIds: readonly string[];
}

export interface RetentionOfferUpdateInput {
  id: string;
  customerEligibilityPaidSubscriptionDurationInMonths?: number | null;
  customerEligibilityWaitBetweenOffersInMonths?: number | null;
}

export interface RetentionOffer {
  id: string;
  referenceName: string;
  offerId: string;
  duration: string;
  offerMode: string;
  periodCount: number;
  customerEligibilityPaidSubscriptionDurationInMonths: number;
  customerEligibilityWaitBetweenOffersInMonths: number | null;
  targetSubscriptionPlanType: string | null;
  priceIds: string[];
}

function isKnownMode(mode: string): mode is RetentionOfferMode {
  return (RETENTION_OFFER_MODES as readonly string[]).includes(mode);
}

function isKnownDuration(duration: string): duration is RetentionOfferDuration {
  return (RETENTION_OFFER_DURATIONS as readonly string[]).includes(duration);
}

function isKnownPlanType(planType: string): planType is RetentionOfferPlanType {
  return (RETENTION_OFFER_PLAN_TYPES as readonly string[]).includes(planType);
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer, got "${value}"`);
  }

  return value;
}

function requireNonEmptyTrimmed(value: string, field: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${field} is required and must not be blank`);
  }

  return trimmed;
}

export function buildRetentionOfferBody(input: RetentionOfferInput) {
  const referenceName = requireNonEmptyTrimmed(input.referenceName, "referenceName");
  const offerId = requireNonEmptyTrimmed(input.offerId, "offerId");

  if (!isKnownMode(input.offerMode)) {
    throw new Error(`Unknown offerMode "${input.offerMode}". Expected one of: ${RETENTION_OFFER_MODES.join(", ")}`);
  }

  if (!isKnownDuration(input.duration)) {
    throw new Error(`Unknown duration "${input.duration}". Expected one of: ${RETENTION_OFFER_DURATIONS.join(", ")}`);
  }

  requirePositiveInteger(input.periodCount, "periodCount");
  requirePositiveInteger(
    input.customerEligibilityPaidSubscriptionDurationInMonths,
    "customerEligibilityPaidSubscriptionDurationInMonths",
  );

  if (
    input.customerEligibilityWaitBetweenOffersInMonths !== undefined &&
    input.customerEligibilityWaitBetweenOffersInMonths !== null
  ) {
    requirePositiveInteger(
      input.customerEligibilityWaitBetweenOffersInMonths,
      "customerEligibilityWaitBetweenOffersInMonths",
    );
  }

  if (
    input.targetSubscriptionPlanType !== undefined &&
    input.targetSubscriptionPlanType !== null &&
    !isKnownPlanType(input.targetSubscriptionPlanType)
  ) {
    throw new Error(
      `Unknown targetSubscriptionPlanType "${input.targetSubscriptionPlanType}". Expected one of: ${RETENTION_OFFER_PLAN_TYPES.join(", ")}`,
    );
  }

  const priceIds = (input.priceIds ?? []).filter((id) => id?.trim());

  if (priceIds.length === 0) {
    throw new Error("priceIds must contain at least one retention offer price id");
  }

  return {
    data: {
      type: "retentionOffers",
      attributes: {
        referenceName,
        offerId,
        duration: input.duration,
        offerMode: input.offerMode,
        periodCount: input.periodCount,
        customerEligibilityPaidSubscriptionDurationInMonths:
          input.customerEligibilityPaidSubscriptionDurationInMonths,
        ...(input.customerEligibilityWaitBetweenOffersInMonths !== undefined
          ? { customerEligibilityWaitBetweenOffersInMonths: input.customerEligibilityWaitBetweenOffersInMonths }
          : {}),
        ...(input.targetSubscriptionPlanType !== undefined
          ? { targetSubscriptionPlanType: input.targetSubscriptionPlanType }
          : {}),
      },
      relationships: {
        subscription: {
          data: { type: "subscriptions", id: input.subscriptionId },
        },
        prices: {
          data: priceIds.map((id) => ({ type: "retentionOfferPrices", id })),
        },
      },
    },
  };
}

export function buildRetentionOfferUpdateBody(input: RetentionOfferUpdateInput) {
  const attributes: Record<string, number | null> = {};

  if (input.customerEligibilityPaidSubscriptionDurationInMonths !== undefined) {
    const value = input.customerEligibilityPaidSubscriptionDurationInMonths;

    if (value !== null) {
      requirePositiveInteger(value, "customerEligibilityPaidSubscriptionDurationInMonths");
    }

    attributes.customerEligibilityPaidSubscriptionDurationInMonths = value;
  }

  if (input.customerEligibilityWaitBetweenOffersInMonths !== undefined) {
    const value = input.customerEligibilityWaitBetweenOffersInMonths;

    if (value !== null) {
      requirePositiveInteger(value, "customerEligibilityWaitBetweenOffersInMonths");
    }

    attributes.customerEligibilityWaitBetweenOffersInMonths = value;
  }

  return {
    data: {
      type: "retentionOffers",
      id: input.id,
      attributes,
    },
  };
}

export function toRetentionOffer(raw: any): RetentionOffer {
  const attributes = raw?.attributes;

  if (!attributes) {
    throw new Error("ASC retentionOffers response missing required attributes");
  }

  if (typeof raw?.id !== "string" || typeof attributes.referenceName !== "string") {
    throw new Error("ASC retentionOffers response missing required id or referenceName");
  }

  if (typeof attributes.offerId !== "string") {
    throw new Error("ASC retentionOffers response missing required offerId");
  }

  if (typeof attributes.duration !== "string" || typeof attributes.offerMode !== "string") {
    throw new Error("ASC retentionOffers response missing required duration or offerMode");
  }

  if (typeof attributes.periodCount !== "number") {
    throw new Error("ASC retentionOffers response missing required periodCount");
  }

  if (typeof attributes.customerEligibilityPaidSubscriptionDurationInMonths !== "number") {
    throw new Error("ASC retentionOffers response missing required customerEligibilityPaidSubscriptionDurationInMonths");
  }

  const priceLinks = raw.relationships?.prices?.data;
  const priceIds = Array.isArray(priceLinks) ? priceLinks.map((price: any) => price.id) : [];

  return {
    id: raw.id,
    referenceName: attributes.referenceName,
    offerId: attributes.offerId,
    duration: attributes.duration,
    offerMode: attributes.offerMode,
    periodCount: attributes.periodCount,
    customerEligibilityPaidSubscriptionDurationInMonths: attributes.customerEligibilityPaidSubscriptionDurationInMonths,
    customerEligibilityWaitBetweenOffersInMonths: attributes.customerEligibilityWaitBetweenOffersInMonths ?? null,
    targetSubscriptionPlanType: attributes.targetSubscriptionPlanType ?? null,
    priceIds,
  };
}
