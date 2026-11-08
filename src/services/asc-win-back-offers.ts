export const WIN_BACK_OFFER_MODES = ["PAY_AS_YOU_GO", "PAY_UP_FRONT", "FREE_TRIAL"] as const;

export type WinBackOfferMode = (typeof WIN_BACK_OFFER_MODES)[number];

export const WIN_BACK_OFFER_DURATIONS = [
  "THREE_DAYS",
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
] as const;

export type WinBackOfferDuration = (typeof WIN_BACK_OFFER_DURATIONS)[number];

export const WIN_BACK_OFFER_PLAN_TYPES = ["MONTHLY", "UPFRONT"] as const;

export type WinBackOfferPlanType = (typeof WIN_BACK_OFFER_PLAN_TYPES)[number];

export const WIN_BACK_OFFER_PRIORITIES = ["HIGH", "NORMAL"] as const;

export type WinBackOfferPriority = (typeof WIN_BACK_OFFER_PRIORITIES)[number];

export const WIN_BACK_OFFER_PROMOTION_INTENTS = ["NOT_PROMOTED", "USE_AUTO_GENERATED_ASSETS"] as const;

export type WinBackOfferPromotionIntent = (typeof WIN_BACK_OFFER_PROMOTION_INTENTS)[number];

export interface WinBackOfferInput {
  subscriptionId: string;
  referenceName: string;
  offerId: string;
  duration: string;
  offerMode: string;
  periodCount: number;
  customerEligibilityPaidSubscriptionDurationInMonths: number;
  customerEligibilityTimeSinceLastSubscribedMinMonths: number;
  customerEligibilityTimeSinceLastSubscribedMaxMonths: number;
  customerEligibilityWaitBetweenOffersInMonths?: number | null;
  targetSubscriptionPlanType?: string | null;
  startDate: string;
  endDate?: string | null;
  priority: string;
  promotionIntent?: string | null;
  priceIds: readonly string[];
}

export interface WinBackOfferUpdateInput {
  id: string;
  customerEligibilityPaidSubscriptionDurationInMonths?: number | null;
  customerEligibilityTimeSinceLastSubscribedMinMonths?: number | null;
  customerEligibilityTimeSinceLastSubscribedMaxMonths?: number | null;
  customerEligibilityWaitBetweenOffersInMonths?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  priority?: string | null;
  promotionIntent?: string | null;
}

export interface WinBackOffer {
  id: string;
  referenceName: string;
  offerId: string;
  duration: string;
  offerMode: string;
  periodCount: number;
  customerEligibilityPaidSubscriptionDurationInMonths: number;
  customerEligibilityTimeSinceLastSubscribedMinMonths: number | null;
  customerEligibilityTimeSinceLastSubscribedMaxMonths: number | null;
  customerEligibilityWaitBetweenOffersInMonths: number | null;
  targetSubscriptionPlanType: string | null;
  startDate: string | null;
  endDate: string | null;
  priority: string | null;
  promotionIntent: string | null;
  priceIds: string[];
}

function isKnownMode(mode: string): mode is WinBackOfferMode {
  return (WIN_BACK_OFFER_MODES as readonly string[]).includes(mode);
}

function isKnownDuration(duration: string): duration is WinBackOfferDuration {
  return (WIN_BACK_OFFER_DURATIONS as readonly string[]).includes(duration);
}

function isKnownPlanType(planType: string): planType is WinBackOfferPlanType {
  return (WIN_BACK_OFFER_PLAN_TYPES as readonly string[]).includes(planType);
}

function isKnownPriority(priority: string): priority is WinBackOfferPriority {
  return (WIN_BACK_OFFER_PRIORITIES as readonly string[]).includes(priority);
}

function isKnownPromotionIntent(intent: string): intent is WinBackOfferPromotionIntent {
  return (WIN_BACK_OFFER_PROMOTION_INTENTS as readonly string[]).includes(intent);
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

function requireDateOnly(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value?.trim() ?? "")) {
    throw new Error(`${field} must be a date like "2026-01-31", got "${value}"`);
  }

  return value.trim();
}

function optionalMonthRange(
  min: number | null | undefined,
  max: number | null | undefined,
  minField: string,
  maxField: string,
): { minimum: number; maximum: number } | null | undefined {
  if (min === undefined && max === undefined) return undefined;

  if (min === null || max === null) return null;

  requirePositiveInteger(min!, minField);
  requirePositiveInteger(max!, maxField);

  if (min! > max!) {
    throw new Error(`${minField} must not exceed ${maxField}, got ${min} > ${max}`);
  }

  return { minimum: min!, maximum: max! };
}

export function buildWinBackOfferBody(input: WinBackOfferInput) {
  const referenceName = requireNonEmptyTrimmed(input.referenceName, "referenceName");
  const offerId = requireNonEmptyTrimmed(input.offerId, "offerId");

  if (!isKnownMode(input.offerMode)) {
    throw new Error(`Unknown offerMode "${input.offerMode}". Expected one of: ${WIN_BACK_OFFER_MODES.join(", ")}`);
  }

  if (!isKnownDuration(input.duration)) {
    throw new Error(`Unknown duration "${input.duration}". Expected one of: ${WIN_BACK_OFFER_DURATIONS.join(", ")}`);
  }

  requirePositiveInteger(input.periodCount, "periodCount");
  requirePositiveInteger(
    input.customerEligibilityPaidSubscriptionDurationInMonths,
    "customerEligibilityPaidSubscriptionDurationInMonths",
  );

  const timeSinceLastSubscribed = optionalMonthRange(
    input.customerEligibilityTimeSinceLastSubscribedMinMonths,
    input.customerEligibilityTimeSinceLastSubscribedMaxMonths,
    "customerEligibilityTimeSinceLastSubscribedMinMonths",
    "customerEligibilityTimeSinceLastSubscribedMaxMonths",
  );

  if (!timeSinceLastSubscribed) {
    throw new Error("customerEligibilityTimeSinceLastSubscribed range (min and max months) is required");
  }

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
      `Unknown targetSubscriptionPlanType "${input.targetSubscriptionPlanType}". Expected one of: ${WIN_BACK_OFFER_PLAN_TYPES.join(", ")}`,
    );
  }

  const startDate = requireDateOnly(input.startDate, "startDate");

  if (input.endDate !== undefined && input.endDate !== null) {
    requireDateOnly(input.endDate, "endDate");
  }

  if (!isKnownPriority(input.priority)) {
    throw new Error(`Unknown priority "${input.priority}". Expected one of: ${WIN_BACK_OFFER_PRIORITIES.join(", ")}`);
  }

  if (
    input.promotionIntent !== undefined &&
    input.promotionIntent !== null &&
    !isKnownPromotionIntent(input.promotionIntent)
  ) {
    throw new Error(
      `Unknown promotionIntent "${input.promotionIntent}". Expected one of: ${WIN_BACK_OFFER_PROMOTION_INTENTS.join(", ")}`,
    );
  }

  const priceIds = (input.priceIds ?? []).filter((id) => id?.trim());

  if (priceIds.length === 0) {
    throw new Error("priceIds must contain at least one win-back offer price id");
  }

  return {
    data: {
      type: "winBackOffers",
      attributes: {
        referenceName,
        offerId,
        duration: input.duration,
        offerMode: input.offerMode,
        periodCount: input.periodCount,
        customerEligibilityPaidSubscriptionDurationInMonths:
          input.customerEligibilityPaidSubscriptionDurationInMonths,
        customerEligibilityTimeSinceLastSubscribedInMonths: timeSinceLastSubscribed,
        ...(input.customerEligibilityWaitBetweenOffersInMonths !== undefined
          ? { customerEligibilityWaitBetweenOffersInMonths: input.customerEligibilityWaitBetweenOffersInMonths }
          : {}),
        ...(input.targetSubscriptionPlanType !== undefined
          ? { targetSubscriptionPlanType: input.targetSubscriptionPlanType }
          : {}),
        startDate,
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        priority: input.priority,
        ...(input.promotionIntent !== undefined ? { promotionIntent: input.promotionIntent } : {}),
      },
      relationships: {
        subscription: {
          data: { type: "subscriptions", id: input.subscriptionId },
        },
        prices: {
          data: priceIds.map((id) => ({ type: "winBackOfferPrices", id })),
        },
      },
    },
  };
}

export function buildWinBackOfferUpdateBody(input: WinBackOfferUpdateInput) {
  const attributes: Record<string, number | string | { minimum: number; maximum: number } | null> = {};

  if (input.customerEligibilityPaidSubscriptionDurationInMonths !== undefined) {
    const value = input.customerEligibilityPaidSubscriptionDurationInMonths;

    if (value !== null) {
      requirePositiveInteger(value, "customerEligibilityPaidSubscriptionDurationInMonths");
    }

    attributes.customerEligibilityPaidSubscriptionDurationInMonths = value;
  }

  const timeSinceLastSubscribed = optionalMonthRange(
    input.customerEligibilityTimeSinceLastSubscribedMinMonths,
    input.customerEligibilityTimeSinceLastSubscribedMaxMonths,
    "customerEligibilityTimeSinceLastSubscribedMinMonths",
    "customerEligibilityTimeSinceLastSubscribedMaxMonths",
  );

  if (timeSinceLastSubscribed !== undefined) {
    attributes.customerEligibilityTimeSinceLastSubscribedInMonths = timeSinceLastSubscribed;
  }

  if (input.customerEligibilityWaitBetweenOffersInMonths !== undefined) {
    const value = input.customerEligibilityWaitBetweenOffersInMonths;

    if (value !== null) {
      requirePositiveInteger(value, "customerEligibilityWaitBetweenOffersInMonths");
    }

    attributes.customerEligibilityWaitBetweenOffersInMonths = value;
  }

  for (const [field, value] of [
    ["startDate", input.startDate],
    ["endDate", input.endDate],
  ] as const) {
    if (value !== undefined) {
      attributes[field] = value === null ? null : requireDateOnly(value, field);
    }
  }

  if (input.priority !== undefined) {
    if (input.priority !== null && !isKnownPriority(input.priority)) {
      throw new Error(
        `Unknown priority "${input.priority}". Expected one of: ${WIN_BACK_OFFER_PRIORITIES.join(", ")}`,
      );
    }

    attributes.priority = input.priority;
  }

  if (input.promotionIntent !== undefined) {
    if (input.promotionIntent !== null && !isKnownPromotionIntent(input.promotionIntent)) {
      throw new Error(
        `Unknown promotionIntent "${input.promotionIntent}". Expected one of: ${WIN_BACK_OFFER_PROMOTION_INTENTS.join(", ")}`,
      );
    }

    attributes.promotionIntent = input.promotionIntent;
  }

  return {
    data: {
      type: "winBackOffers",
      id: input.id,
      attributes,
    },
  };
}

export function toWinBackOffer(raw: any): WinBackOffer {
  const attributes = raw?.attributes;

  if (!attributes) {
    throw new Error("ASC winBackOffers response missing required attributes");
  }

  if (typeof raw?.id !== "string" || typeof attributes.referenceName !== "string") {
    throw new Error("ASC winBackOffers response missing required id or referenceName");
  }

  if (typeof attributes.offerId !== "string") {
    throw new Error("ASC winBackOffers response missing required offerId");
  }

  if (typeof attributes.duration !== "string" || typeof attributes.offerMode !== "string") {
    throw new Error("ASC winBackOffers response missing required duration or offerMode");
  }

  if (typeof attributes.periodCount !== "number") {
    throw new Error("ASC winBackOffers response missing required periodCount");
  }

  if (typeof attributes.customerEligibilityPaidSubscriptionDurationInMonths !== "number") {
    throw new Error("ASC winBackOffers response missing required customerEligibilityPaidSubscriptionDurationInMonths");
  }

  const range = attributes.customerEligibilityTimeSinceLastSubscribedInMonths ?? null;

  if (range !== null && (typeof range?.minimum !== "number" || typeof range?.maximum !== "number")) {
    throw new Error("ASC winBackOffers response has an invalid customerEligibilityTimeSinceLastSubscribedInMonths range");
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
    customerEligibilityTimeSinceLastSubscribedMinMonths: range?.minimum ?? null,
    customerEligibilityTimeSinceLastSubscribedMaxMonths: range?.maximum ?? null,
    customerEligibilityWaitBetweenOffersInMonths: attributes.customerEligibilityWaitBetweenOffersInMonths ?? null,
    targetSubscriptionPlanType: attributes.targetSubscriptionPlanType ?? null,
    startDate: attributes.startDate ?? null,
    endDate: attributes.endDate ?? null,
    priority: attributes.priority ?? null,
    promotionIntent: attributes.promotionIntent ?? null,
    priceIds,
  };
}
