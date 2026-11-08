import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildRetentionOfferBody,
  buildRetentionOfferUpdateBody,
  toRetentionOffer,
} from "../../../services/asc-retention-offers";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

const retentionDuration = z.enum([
  "THREE_DAYS",
  "ONE_WEEK",
  "TWO_WEEKS",
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
]);

const retentionMode = z.enum(["PAY_AS_YOU_GO", "PAY_UP_FRONT", "FREE_TRIAL"]);

const retentionPlanType = z.enum(["MONTHLY", "UPFRONT"]);

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
        text: `Invalid retention offer: ${err?.message ?? "unknown error"}`,
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

export function registerAscSubscriptionRetentionOfferTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_offers",
    {
      description:
        "List retention offers for a subscription. " +
        "Retention offers are shown to subscribers who try to cancel, giving them a discount or free period to stay subscribed. " +
        "Each entry includes the reference name, offer ID, mode, duration, period count, eligibility rules, and linked price IDs.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/retentionOffers`, {
          params: {
            "fields[retentionOffers]":
              "referenceName,offerId,duration,offerMode,periodCount,customerEligibilityPaidSubscriptionDurationInMonths,customerEligibilityWaitBetweenOffersInMonths,targetSubscriptionPlanType",
            limit: 200,
          },
        });

        return json((resp.data ?? []).map(toRetentionOffer));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_retention_offer",
    {
      description:
        "Create a retention offer for a subscription, shown to subscribers who try to cancel. " +
        "Requires referenceName, offerId, duration, offerMode, periodCount, the minimum paid-subscription duration in months for eligibility, " +
        "and at least one retention offer price ID. " +
        "Optionally set the wait in months between offers and the target subscription plan type (MONTHLY or UPFRONT).",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        referenceName: z.string().describe("Internal reference name, not shown to subscribers."),
        offerId: z.string().describe("Offer identifier used to identify the offer."),
        duration: retentionDuration.describe("Billing period length of the offer."),
        offerMode: retentionMode.describe("How the subscriber pays during the offer."),
        periodCount: z.number().int().min(1).describe("Number of billing periods the offer lasts."),
        customerEligibilityPaidSubscriptionDurationInMonths: z
          .number()
          .int()
          .min(1)
          .describe("Minimum months the subscriber must have paid before qualifying."),
        customerEligibilityWaitBetweenOffersInMonths: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Months to wait before this subscriber can receive another offer."),
        targetSubscriptionPlanType: retentionPlanType
          .optional()
          .describe("Billing plan type this offer applies to."),
        priceIds: z
          .array(z.string())
          .min(1)
          .describe("Retention offer price IDs covering the offer territories."),
      },
    },
    async ({ subscriptionId, ...rest }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let body: ReturnType<typeof buildRetentionOfferBody>;

      try {
        body = buildRetentionOfferBody({ subscriptionId, ...rest });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/retentionOffers", body);

        return json(toRetentionOffer(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_retention_offer",
    {
      description:
        "Update eligibility rules of a retention offer. " +
        "Only the paid-subscription duration and wait-between-offers fields can change; pass null to clear a field. " +
        "Use list_app_subscription_retention_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Retention offer ID from list_app_subscription_retention_offers."),
        customerEligibilityPaidSubscriptionDurationInMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Minimum months the subscriber must have paid before qualifying. Null clears it."),
        customerEligibilityWaitBetweenOffersInMonths: z
          .number()
          .int()
          .min(1)
          .nullable()
          .optional()
          .describe("Months to wait before this subscriber can receive another offer. Null clears it."),
      },
    },
    async ({ offerId, ...rest }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let body: ReturnType<typeof buildRetentionOfferUpdateBody>;

      try {
        body = buildRetentionOfferUpdateBody({ id: offerId, ...rest });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.patch(`/retentionOffers/${offerId}`, body);

        return json(toRetentionOffer(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_retention_offer",
    {
      description:
        "Delete a retention offer. " + "Use list_app_subscription_retention_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Retention offer ID from list_app_subscription_retention_offers."),
      },
    },
    async ({ offerId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/retentionOffers/${offerId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_offer_prices",
    {
      description:
        "List per-territory prices of a retention offer with currency, customer price, proceeds, and price point ID. " +
        "Use list_app_subscription_retention_offers to find the offer ID.",
      inputSchema: {
        offerId: z.string().describe("Retention offer ID from list_app_subscription_retention_offers."),
      },
    },
    async ({ offerId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/retentionOffers/${offerId}/prices`, {
          params: {
            include: "territory,subscriptionPricePoint",
            "fields[retentionOfferPrices]": "territory,subscriptionPricePoint",
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
