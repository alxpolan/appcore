import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildWinBackOfferBody,
  buildWinBackOfferUpdateBody,
  toWinBackOffer,
} from "../../../services/asc-win-back-offers";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

const winBackDuration = z.enum([
  "THREE_DAYS",
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
]);

const winBackMode = z.enum(["PAY_AS_YOU_GO", "PAY_UP_FRONT", "FREE_TRIAL"]);

const winBackPlanType = z.enum(["MONTHLY", "UPFRONT"]);

const winBackPriority = z.enum(["HIGH", "NORMAL"]);

const winBackPromotionIntent = z.enum(["NOT_PROMOTED", "USE_AUTO_GENERATED_ASSETS"]);

function ascError(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `ASC error: ${formatAscError(err)}`,
      },
    ],
  };
}

function invalidInput(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Invalid win-back offer: ${err?.message ?? "unknown error"}`,
      },
    ],
  };
}

function credentialsMissing() {
  return {
    content: [
      {
        type: "text" as const,
        text: mcpToolMessages.appStoreConnectCredentialsNotConfigured,
      },
    ],
  };
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerAscSubscriptionWinBackOfferTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_subscription_win_back_offers",
    {
      description:
        "List win-back offers for a subscription. " +
        "Win-back offers target former subscribers with a discount or free period to make them resubscribe. " +
        "Each entry includes the reference name, offer ID, mode, duration, period count, eligibility rules, schedule, priority, and linked price IDs.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/winBackOffers`, {
          params: {
            "fields[winBackOffers]":
              "referenceName,offerId,duration,offerMode,periodCount,customerEligibilityPaidSubscriptionDurationInMonths,customerEligibilityTimeSinceLastSubscribedInMonths,customerEligibilityWaitBetweenOffersInMonths,targetSubscriptionPlanType,startDate,endDate,priority,promotionIntent",
            limit: 200,
          },
        });

        return json((resp.data ?? []).map(toWinBackOffer));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_win_back_offer",
    {
      description:
        "Create a win-back offer for a subscription to lure back former subscribers. " +
        "Requires referenceName, offerId, duration, offerMode, periodCount, the minimum paid-subscription duration in months, " +
        "the lapsed range in months since the subscription ended (min and max), a start date (YYYY-MM-DD), a priority, " +
        "and at least one win-back offer price ID. " +
        "Optionally set an end date, the wait in months between offers, the target plan type, and the promotion intent.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        referenceName: z.string().describe("Internal reference name, not shown to subscribers."),
        offerId: z.string().describe("Offer identifier used to identify the offer."),
        duration: winBackDuration.describe("Billing period length of the offer."),
        offerMode: winBackMode.describe("How the subscriber pays during the offer."),
        periodCount: z.number().int().min(1).describe("Number of billing periods the offer lasts."),
        customerEligibilityPaidSubscriptionDurationInMonths: z
          .number()
          .int()
          .min(1)
          .describe("Minimum months the subscriber must have paid before qualifying."),
        customerEligibilityTimeSinceLastSubscribedMinMonths: z
          .number()
          .int()
          .min(1)
          .describe("Minimum months since the subscription ended for the subscriber to qualify."),
        customerEligibilityTimeSinceLastSubscribedMaxMonths: z
          .number()
          .int()
          .min(1)
          .describe("Maximum months since the subscription ended for the subscriber to qualify."),
        customerEligibilityWaitBetweenOffersInMonths: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Months to wait before this subscriber can receive another offer."),
        targetSubscriptionPlanType: winBackPlanType.optional().describe("Billing plan type this offer applies to."),
        startDate: z.string().describe("First day the offer is available, as YYYY-MM-DD."),
        endDate: z.string().nullish().describe("Last day the offer is available, as YYYY-MM-DD."),
        priority: winBackPriority.describe("Offer priority when several offers could apply."),
        promotionIntent: winBackPromotionIntent.optional().describe("Whether Apple may promote the offer."),
        priceIds: z.array(z.string()).min(1).describe("Win-back offer price IDs covering the offer territories."),
      },
    },
    async ({ subscriptionId, ...rest }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let body: ReturnType<typeof buildWinBackOfferBody>;

      try {
        body = buildWinBackOfferBody({ subscriptionId, ...rest });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/winBackOffers", body);

        return json(toWinBackOffer(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_win_back_offer",
    {
      description:
        "Update a win-back offer. " +
        "Updatable: paid-subscription duration, lapsed range (min/max months, null clears the range), wait between offers, " +
        "start and end dates (YYYY-MM-DD, null clears), priority and promotion intent. " +
        "Use list_app_subscription_win_back_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Win-back offer ID from list_app_subscription_win_back_offers."),
        customerEligibilityPaidSubscriptionDurationInMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Minimum months the subscriber must have paid before qualifying. Null clears it."),
        customerEligibilityTimeSinceLastSubscribedMinMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Minimum months since the subscription ended. Null (with null max) clears the range."),
        customerEligibilityTimeSinceLastSubscribedMaxMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Maximum months since the subscription ended. Null (with null min) clears the range."),
        customerEligibilityWaitBetweenOffersInMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Months to wait before this subscriber can receive another offer. Null clears it."),
        startDate: z
          .string()
          .nullable()
          .optional()
          .describe("First day the offer is available, as YYYY-MM-DD. Null clears it."),
        endDate: z
          .string()
          .nullable()
          .optional()
          .describe("Last day the offer is available, as YYYY-MM-DD. Null clears it."),
        priority: winBackPriority.nullable().optional().describe("Offer priority. Null clears it."),
        promotionIntent: winBackPromotionIntent
          .nullable()
          .optional()
          .describe("Whether Apple may promote the offer. Null clears it."),
      },
    },
    async ({ offerId, ...rest }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let body: ReturnType<typeof buildWinBackOfferUpdateBody>;

      try {
        body = buildWinBackOfferUpdateBody({ id: offerId, ...rest });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.patch(`/winBackOffers/${offerId}`, body);

        return json(toWinBackOffer(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_win_back_offer",
    {
      description:
        "Delete a win-back offer. " + "Use list_app_subscription_win_back_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Win-back offer ID from list_app_subscription_win_back_offers."),
      },
    },
    async ({ offerId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/winBackOffers/${offerId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_win_back_offer_prices",
    {
      description:
        "List per-territory prices of a win-back offer with currency, customer price, proceeds, and price point ID. " +
        "Use list_app_subscription_win_back_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Win-back offer ID from list_app_subscription_win_back_offers."),
      },
    },
    async ({ offerId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/winBackOffers/${offerId}/prices`, {
          params: {
            include: "territory,subscriptionPricePoint",
            "fields[winBackOfferPrices]": "territory,subscriptionPricePoint",
            "fields[territories]": "currency",
            "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
            limit: 200,
          },
        });

        const included: any[] = resp.included ?? [];
        const terrMap = new Map<string, any>(
          included.filter((i: any) => i.type === "territories").map((t: any) => [t.id, t]),
        );

        const ppMap = new Map<string, any>(
          included.filter((i: any) => i.type === "subscriptionPricePoints").map((pp: any) => [pp.id, pp]),
        );

        return json(
          (resp.data ?? []).map((p: any) => {
            const terrId = p.relationships?.territory?.data?.id ?? null;
            const ppId = p.relationships?.subscriptionPricePoint?.data?.id ?? null;
            const terr = terrId ? terrMap.get(terrId) : null;
            const pp = ppId ? ppMap.get(ppId) : null;

            return {
              id: p.id,
              territory: terrId,
              currency: terr?.attributes?.currency ?? null,
              customerPrice: pp?.attributes?.customerPrice ?? null,
              proceeds: pp?.attributes?.proceeds ?? null,
              pricePointId: ppId,
            };
          }),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
