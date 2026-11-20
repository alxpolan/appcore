import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildRetentionMessagePlacementCreateBody,
  resolveRetentionMessageImageFile,
  toRetentionMessage,
  uploadRetentionMessageImage,
} from "../../../services/asc-retention-messages";
import { couldNotResolveAscAppId, createAscClient, getSettingsWithBundleId, hasAscCredentials } from "./shared";
import { ascError, credentialsMissing, invalidInput, json } from "./asc-subscription-retention-messages-core";

export function registerAscSubscriptionRetentionMessageAssignmentTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "upload_app_subscription_retention_message_image",
    {
      description:
        "Upload and attach an image to a retention message version. The image is only shown to subscribers " +
        "when the message has no eligible offer. Provide exactly one of imageDataUrl or imageUrl. " +
        "Image must be a PNG, without transparency, at exactly 3840x2160 or 5244x2950 pixels.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        retentionMessageVersionId: z
          .string()
          .describe("Retention message version ID from create_app_subscription_retention_message_version."),
        imageDataUrl: z.string().optional().describe("PNG image as a data URL (data:image/png;base64,...)."),
        imageUrl: z.string().optional().describe("HTTP(S) URL serving a PNG image."),
        fileName: z.string().optional().describe("Optional file name to use for the upload."),
      },
    },
    async ({ bundleId, retentionMessageVersionId, imageDataUrl, imageUrl, fileName }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(resolvedBundleId);

        if (!app) {
          return { content: [{ type: "text" as const, text: couldNotResolveAscAppId(resolvedBundleId) }] };
        }

        const file = await resolveRetentionMessageImageFile({ imageDataUrl, imageUrl, fileName });
        const imageId = await uploadRetentionMessageImage(asc, app.id, file);

        const { data: placementResp } = await asc.client.post(
          "/appAssetLibraryPlacements",
          buildRetentionMessagePlacementCreateBody({ imageId, retentionMessageVersionId }),
        );

        return json({ imageId, placementId: placementResp.data.id });
      } catch (err: any) {
        if (err?.response?.data?.errors) return ascError(err);

        return invalidInput(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_app_subscription_retention_message",
    {
      description: "Get the retention message currently assigned to a subscription, if any.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/retentionMessage`, {
          params: { "fields[retentionMessages]": "referenceName" },
        });

        return json(resp.data ? toRetentionMessage(resp.data) : null);
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "assign_app_subscription_retention_message",
    {
      description:
        "Assign a retention message to a subscription, or clear it by omitting retentionMessageId. " +
        "A subscription can have only one active retention message; assigning a new one replaces the previous one.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        retentionMessageId: z
          .string()
          .optional()
          .describe("Retention message ID to assign. Omit to clear the subscription's retention message."),
      },
    },
    async ({ subscriptionId, retentionMessageId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.patch(`/subscriptions/${subscriptionId}/relationships/retentionMessage`, {
          data: retentionMessageId ? { type: "retentionMessages", id: retentionMessageId } : null,
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_message_offers",
    {
      description: "List the retention offers currently linked to a subscription's retention message (up to 10).",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/retentionMessageOffers`, {
          params: {
            "fields[retentionOffers]":
              "referenceName,offerId,duration,offerMode,periodCount,customerEligibilityPaidSubscriptionDurationInMonths,customerEligibilityWaitBetweenOffersInMonths,targetSubscriptionPlanType",
            limit: 10,
          },
        });

        const { toRetentionOffer } = await import("../../../services/asc-retention-offers");

        return json((resp.data ?? []).map(toRetentionOffer));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "add_app_subscription_retention_message_offers",
    {
      description:
        "Link retention offers to a subscription's retention message, so it shows the offer instead of the " +
        "message's image. A subscription can have up to 10 linked retention offers.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        offerIds: z
          .array(z.string())
          .min(1)
          .describe("Retention offer IDs from list_app_subscription_retention_offers."),
      },
    },
    async ({ subscriptionId, offerIds }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.post(`/subscriptions/${subscriptionId}/relationships/retentionMessageOffers`, {
          data: offerIds.map((id: string) => ({ type: "retentionOffers", id })),
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "remove_app_subscription_retention_message_offers",
    {
      description: "Unlink retention offers from a subscription's retention message.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        offerIds: z
          .array(z.string())
          .min(1)
          .describe("Retention offer IDs from list_app_subscription_retention_message_offers."),
      },
    },
    async ({ subscriptionId, offerIds }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/subscriptions/${subscriptionId}/relationships/retentionMessageOffers`, {
          data: { data: offerIds.map((id: string) => ({ type: "retentionOffers", id })) },
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
