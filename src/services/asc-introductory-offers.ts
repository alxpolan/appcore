export const INTRODUCTORY_OFFER_MODES = ["FREE_TRIAL", "PAY_AS_YOU_GO", "PAY_UP_FRONT"] as const;

export type IntroductoryOfferMode = (typeof INTRODUCTORY_OFFER_MODES)[number];

export const INTRODUCTORY_OFFER_DURATIONS = [
  "ONE_DAY",
  "THREE_DAYS",
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
] as const;

export type IntroductoryOfferDuration = (typeof INTRODUCTORY_OFFER_DURATIONS)[number];

export interface IntroductoryOfferInput {
  subscriptionId: string;
  offerMode?: string;
  duration?: string;
  numberOfPeriods?: number;
  territory?: string;
  pricePointId?: string;
  startDate?: string;
  endDate?: string;
}

export interface IntroductoryOffer {
  id: string;
  offerMode: string;
  duration: string;
  numberOfPeriods: number;
  territory: string | null;
  startDate: string | null;
  endDate: string | null;
}

function isKnownMode(mode: string): mode is IntroductoryOfferMode {
  return (INTRODUCTORY_OFFER_MODES as readonly string[]).includes(mode);
}

function isKnownDuration(duration: string): duration is IntroductoryOfferDuration {
  return (INTRODUCTORY_OFFER_DURATIONS as readonly string[]).includes(duration);
}

export function buildIntroductoryOfferBody(input: IntroductoryOfferInput) {
  const mode = input.offerMode ?? "FREE_TRIAL";

  if (!isKnownMode(mode)) {
    throw new Error(`Unknown offerMode "${mode}". Expected one of: ${INTRODUCTORY_OFFER_MODES.join(", ")}`);
  }

  if (!input.duration || !isKnownDuration(input.duration)) {
    throw new Error(
      `Unknown duration "${input.duration ?? ""}". Expected one of: ${INTRODUCTORY_OFFER_DURATIONS.join(", ")}`,
    );
  }

  const periods = input.numberOfPeriods ?? 1;

  if (!Number.isInteger(periods) || periods < 1) {
    throw new Error(`numberOfPeriods must be a positive integer, got "${input.numberOfPeriods}"`);
  }

  if (mode !== "FREE_TRIAL" && !input.pricePointId) {
    throw new Error(`pricePointId is required for offerMode "${mode}"`);
  }

  const territory = input.territory?.trim() ? input.territory.trim().toUpperCase() : undefined;

  return {
    data: {
      type: "subscriptionIntroductoryOffers",
      attributes: {
        offerMode: mode,
        duration: input.duration,
        numberOfPeriods: periods,
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
      },
      relationships: {
        subscription: {
          data: { type: "subscriptions", id: input.subscriptionId },
        },
        ...(mode !== "FREE_TRIAL" && input.pricePointId
          ? { subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: input.pricePointId } } }
          : {}),
        ...(territory ? { territory: { data: { type: "territories", id: territory } } } : {}),
      },
    },
  };
}

export function toIntroductoryOffer(raw: any): IntroductoryOffer {
  const attributes = raw?.attributes ?? {};
  const territory = raw?.relationships?.territory?.data?.id ?? null;

  return {
    id: raw?.id ?? "",
    offerMode: attributes.offerMode ?? "",
    duration: attributes.duration ?? "",
    numberOfPeriods: attributes.numberOfPeriods ?? 1,
    territory,
    startDate: attributes.startDate ?? null,
    endDate: attributes.endDate ?? null,
  };
}
