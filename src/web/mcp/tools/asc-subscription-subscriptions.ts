import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

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

export function registerAscSubscriptionsTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "create_app_subscription",
    {
      description:
        "Create a new auto-renewable subscription in a subscription group. " +
        "The productId must be unique across all your apps and cannot be changed later.",
      inputSchema: {
        groupId: z.string().describe("Subscription group ID from list_app_subscription_groups."),
        name: z.string().describe("Internal reference name for the subscription."),
        productId: z
          .string()
          .describe(
            "Product identifier (e.g. 'com.example.myapp.pro.monthly'). Must be globally unique and cannot be changed.",
          ),
        subscriptionPeriod: z
          .enum(["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"])
          .describe("Duration of the subscription period."),
        familySharable: z
          .boolean()
          .optional()
          .describe("Whether the subscription supports Family Sharing. Defaults to false."),
        groupLevel: z
          .number()
          .int()
          .optional()
          .describe("Level within the group for upgrade/downgrade ordering (1 = highest tier)."),
        reviewNote: z.string().optional().describe("Notes for App Review."),
      },
    },
    async ({ groupId, name, productId, subscriptionPeriod, familySharable, groupLevel, reviewNote }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/subscriptions", {
          data: {
            type: "subscriptions",
            attributes: {
              name,
              productId,
              familySharable: familySharable ?? false,
              subscriptionPeriod,
              ...(groupLevel != null ? { groupLevel } : {}),
              ...(reviewNote ? { reviewNote } : {}),
            },
            relationships: {
              group: {
                data: { type: "subscriptionGroups", id: groupId },
              },
            },
          },
        });

        return json({
          id: resp.data.id,
          name: resp.data.attributes?.name ?? name,
          productId: resp.data.attributes?.productId ?? productId,
          familySharable: resp.data.attributes?.familySharable ?? false,
          state: resp.data.attributes?.state ?? "",
          subscriptionPeriod: resp.data.attributes?.subscriptionPeriod ?? subscriptionPeriod,
          reviewNote: resp.data.attributes?.reviewNote ?? null,
          groupLevel: resp.data.attributes?.groupLevel ?? null,
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription",
    {
      description:
        "Update an existing subscription's mutable attributes. " +
        "productId cannot be changed after creation. Only pass the fields you want to change.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        name: z.string().optional().describe("New internal reference name."),
        familySharable: z.boolean().optional().describe("Whether the subscription supports Family Sharing."),
        subscriptionPeriod: z
          .enum(["ONE_WEEK", "ONE_MONTH", "TWO_MONTHS", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR"])
          .optional()
          .describe("Duration of the subscription period."),
        groupLevel: z.number().int().optional().describe("Level within the group for upgrade/downgrade ordering."),
        reviewNote: z.string().optional().describe("Notes for App Review."),
      },
    },
    async ({ subscriptionId, name, familySharable, subscriptionPeriod, groupLevel, reviewNote }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attributes: Record<string, any> = {};

        if (name !== undefined) attributes.name = name;
        if (familySharable !== undefined) attributes.familySharable = familySharable;
        if (subscriptionPeriod !== undefined) attributes.subscriptionPeriod = subscriptionPeriod;
        if (groupLevel !== undefined) attributes.groupLevel = groupLevel;
        if (reviewNote !== undefined) attributes.reviewNote = reviewNote;

        await asc.client.patch(`/subscriptions/${subscriptionId}`, {
          data: { type: "subscriptions", id: subscriptionId, attributes },
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription",
    {
      description:
        "Delete a subscription. Only possible for subscriptions that have never been approved (state MISSING_METADATA, READY_TO_SUBMIT, or WAITING_FOR_REVIEW).",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/subscriptions/${subscriptionId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_localizations",
    {
      description:
        "List all localizations (display name and description per locale) for a subscription. " +
        "Use this to get localization IDs for update/delete operations.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/subscriptionLocalizations`, {
          params: {
            "fields[subscriptionLocalizations]": "name,locale,description,state",
            limit: 200,
          },
        });

        return json(
          (resp.data ?? []).map((l: any) => ({
            id: l.id,
            locale: l.attributes?.locale ?? "",
            name: l.attributes?.name ?? "",
            description: l.attributes?.description ?? "",
            state: l.attributes?.state ?? "",
          })),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_localization",
    {
      description:
        "Create a new localization for a subscription with a display name (shown to users) and optional description.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        locale: z.string().describe("Locale code (e.g. 'en-US', 'de-DE', 'fr-FR')."),
        name: z.string().describe("Display name shown to users in this locale."),
        description: z.string().optional().describe("Optional description shown to users in this locale."),
      },
    },
    async ({ subscriptionId, locale, name, description }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/subscriptionLocalizations", {
          data: {
            type: "subscriptionLocalizations",
            attributes: {
              locale,
              name,
              ...(description ? { description } : {}),
            },
            relationships: {
              subscription: {
                data: { type: "subscriptions", id: subscriptionId },
              },
            },
          },
        });

        return json({
          id: resp.data.id,
          locale: resp.data.attributes?.locale ?? locale,
          name: resp.data.attributes?.name ?? name,
          description: resp.data.attributes?.description ?? description ?? "",
          state: resp.data.attributes?.state ?? "",
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_localization",
    {
      description:
        "Update the display name or description of an existing subscription localization. Only pass the fields you want to change.",
      inputSchema: {
        localizationId: z.string().describe("Subscription localization ID from list_app_subscription_localizations."),
        name: z.string().optional().describe("New display name."),
        description: z.string().optional().describe("New description."),
      },
    },
    async ({ localizationId, name, description }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attributes: Record<string, any> = {};

        if (name !== undefined) attributes.name = name;
        if (description !== undefined) attributes.description = description;

        await asc.client.patch(`/subscriptionLocalizations/${localizationId}`, {
          data: {
            type: "subscriptionLocalizations",
            id: localizationId,
            attributes,
          },
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_localization",
    {
      description: "Delete a subscription localization.",
      inputSchema: {
        localizationId: z.string().describe("Subscription localization ID from list_app_subscription_localizations."),
      },
    },
    async ({ localizationId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/subscriptionLocalizations/${localizationId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
