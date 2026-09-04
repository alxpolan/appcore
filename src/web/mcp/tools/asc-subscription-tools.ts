import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  couldNotResolveAscAppId,
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

export function registerAscSubscriptionTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_subscription_groups",
    {
      description:
        "List all App Store Connect subscription groups for an app along with their subscriptions. " +
        "Returns group IDs, reference names, and nested subscriptions (id, name, productId, state, subscriptionPeriod, familySharable, groupLevel, reviewNote). " +
        "Use this to discover subscriptionGroupId and subscriptionId values for other subscription tools.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
      },
    },
    async ({ bundleId }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(resolvedBundleId);

        if (!app) {
          return {
            content: [{ type: "text", text: couldNotResolveAscAppId(resolvedBundleId) }],
          };
        }

        const { data: resp } = await asc.client.get(`/apps/${app.id}/subscriptionGroups`, {
          params: {
            include: "subscriptions",
            "fields[subscriptionGroups]": "referenceName,subscriptions",
            "fields[subscriptions]": "name,productId,familySharable,state,subscriptionPeriod,reviewNote,groupLevel",
            "limit[subscriptions]": 50,
            limit: 200,
          },
        });

        const included: any[] = resp.included ?? [];
        const subMap = new Map<string, any>(included.map((s: any) => [s.id, s]));

        const groups = (resp.data ?? []).map((g: any) => ({
          id: g.id,
          referenceName: g.attributes?.referenceName ?? "",
          subscriptions: (g.relationships?.subscriptions?.data ?? [])
            .map((ref: any) => {
              const s = subMap.get(ref.id);
              if (!s) return null;
              return {
                id: s.id,
                name: s.attributes?.name ?? "",
                productId: s.attributes?.productId ?? "",
                familySharable: s.attributes?.familySharable ?? false,
                state: s.attributes?.state ?? "",
                subscriptionPeriod: s.attributes?.subscriptionPeriod ?? null,
                reviewNote: s.attributes?.reviewNote ?? null,
                groupLevel: s.attributes?.groupLevel ?? null,
              };
            })
            .filter(Boolean),
        }));

        return json(groups);
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_group",
    {
      description:
        "Create a new App Store Connect subscription group for an app. " +
        "Subscriptions are organized into groups; a user can only be subscribed to one subscription per group at a time.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        referenceName: z.string().describe("Internal reference name for the subscription group."),
      },
    },
    async ({ bundleId, referenceName }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(resolvedBundleId);
        if (!app) {
          return {
            content: [{ type: "text", text: couldNotResolveAscAppId(resolvedBundleId) }],
          };
        }

        const { data: resp } = await asc.client.post("/subscriptionGroups", {
          data: {
            type: "subscriptionGroups",
            attributes: { referenceName },
            relationships: {
              app: { data: { type: "apps", id: app.id } },
            },
          },
        });

        return json({
          id: resp.data.id,
          referenceName: resp.data.attributes?.referenceName ?? referenceName,
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_group",
    {
      description: "Update the reference name of an existing App Store Connect subscription group.",
      inputSchema: {
        groupId: z.string().describe("Subscription group ID from list_app_subscription_groups."),
        referenceName: z.string().describe("New internal reference name for the group."),
      },
    },
    async ({ groupId, referenceName }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.patch(`/subscriptionGroups/${groupId}`, {
          data: {
            type: "subscriptionGroups",
            id: groupId,
            attributes: { referenceName },
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
    "delete_app_subscription_group",
    {
      description: "Delete an App Store Connect subscription group. The group must be empty (no subscriptions).",
      inputSchema: {
        groupId: z.string().describe("Subscription group ID from list_app_subscription_groups."),
      },
    },
    async ({ groupId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/subscriptionGroups/${groupId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_group_localizations",
    {
      description:
        "List all localizations for a subscription group. Each localization has a display name (shown to users, e.g. on the subscription management page) " +
        "and an optional custom app name per locale. Note: subscription groups do not have a 'description' field in App Store Connect, only name and customAppName. " +
        "Use this to get localization IDs for update/delete operations.",
      inputSchema: {
        groupId: z.string().describe("Subscription group ID from list_app_subscription_groups."),
      },
    },
    async ({ groupId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptionGroups/${groupId}/subscriptionGroupLocalizations`, {
          params: {
            "fields[subscriptionGroupLocalizations]": "name,customAppName,locale,state",
            limit: 50,
          },
        });
        return json(
          (resp.data ?? []).map((l: any) => ({
            id: l.id,
            locale: l.attributes?.locale ?? "",
            name: l.attributes?.name ?? "",
            customAppName: l.attributes?.customAppName ?? null,
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
    "create_app_subscription_group_localization",
    {
      description:
        "Create a new localization for a subscription group with a display name (shown to users) and an optional custom app name for that locale.",
      inputSchema: {
        groupId: z.string().describe("Subscription group ID from list_app_subscription_groups."),
        locale: z.string().describe("Locale code (e.g. 'en-US', 'de-DE', 'fr-FR')."),
        name: z.string().describe("Display name shown to users in this locale."),
        customAppName: z
          .string()
          .optional()
          .describe("Optional custom app name to show for this locale instead of the app's default name."),
      },
    },
    async ({ groupId, locale, name, customAppName }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/subscriptionGroupLocalizations", {
          data: {
            type: "subscriptionGroupLocalizations",
            attributes: {
              locale,
              name,
              ...(customAppName ? { customAppName } : {}),
            },
            relationships: {
              subscriptionGroup: {
                data: { type: "subscriptionGroups", id: groupId },
              },
            },
          },
        });
        return json({
          id: resp.data.id,
          locale: resp.data.attributes?.locale ?? locale,
          name: resp.data.attributes?.name ?? name,
          customAppName: resp.data.attributes?.customAppName ?? customAppName ?? null,
          state: resp.data.attributes?.state ?? "",
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_group_localization",
    {
      description:
        "Update the display name or custom app name of an existing subscription group localization. Only pass the fields you want to change.",
      inputSchema: {
        localizationId: z
          .string()
          .describe("Subscription group localization ID from list_app_subscription_group_localizations."),
        name: z.string().optional().describe("New display name."),
        customAppName: z.string().optional().describe("New custom app name."),
      },
    },
    async ({ localizationId, name, customAppName }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attributes: Record<string, any> = {};
        if (name !== undefined) attributes.name = name;
        if (customAppName !== undefined) attributes.customAppName = customAppName;

        await asc.client.patch(`/subscriptionGroupLocalizations/${localizationId}`, {
          data: {
            type: "subscriptionGroupLocalizations",
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
    "delete_app_subscription_group_localization",
    {
      description: "Delete a subscription group localization.",
      inputSchema: {
        localizationId: z
          .string()
          .describe("Subscription group localization ID from list_app_subscription_group_localizations."),
      },
    },
    async ({ localizationId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/subscriptionGroupLocalizations/${localizationId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

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

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_price_points",
    {
      description:
        "List available price points (tier catalog) for a subscription. " +
        "Each price point has an ID, customer price, proceeds, territory, and currency. " +
        "Use these IDs when calling create_app_subscription_price. Filter by territory to limit results.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        territory: z
          .string()
          .optional()
          .describe("Optional territory code (e.g. 'USA', 'DEU') to filter price points."),
      },
    },
    async ({ subscriptionId, territory }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/pricePoints`, {
          params: {
            include: "territory",
            "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
            "fields[territories]": "currency",
            ...(territory ? { "filter[territory]": territory } : {}),
            limit: 8000,
          },
        });

        const included: any[] = resp.included ?? [];
        const terrMap = new Map<string, any>(included.map((t: any) => [t.id, t]));

        return json(
          (resp.data ?? []).map((pp: any) => {
            const terrId = pp.relationships?.territory?.data?.id ?? null;
            const terr = terrId ? terrMap.get(terrId) : null;
            return {
              id: pp.id,
              customerPrice: pp.attributes?.customerPrice ?? null,
              proceeds: pp.attributes?.proceeds ?? null,
              territory: terrId,
              currency: terr?.attributes?.currency ?? null,
            };
          }),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_prices",
    {
      description:
        "List the current prices configured for a subscription across all territories. " +
        "Each entry includes the price ID (for deletion), territory, currency, customer price, proceeds, price point ID, start date, and whether it is preserved.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/subscriptions/${subscriptionId}/prices`, {
          params: {
            include: "territory,subscriptionPricePoint",
            "fields[subscriptionPrices]": "startDate,preserved,territory,subscriptionPricePoint",
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
              startDate: p.attributes?.startDate ?? null,
              preserved: p.attributes?.preserved ?? false,
            };
          }),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_price",
    {
      description:
        "Set a new price for a subscription. " +
        "Provide a pricePointId from list_app_subscription_price_points. " +
        "Optionally set a startDate (ISO 8601) to schedule the price change, or preserveCurrentPrice to keep existing subscribers at their current price.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        pricePointId: z.string().describe("Price point ID from list_app_subscription_price_points."),
        territory: z
          .string()
          .optional()
          .describe("Territory code (e.g. 'USA', 'DEU'). Inferred from the price point if omitted."),
        startDate: z
          .string()
          .optional()
          .describe("ISO 8601 date when the price should take effect. Applies immediately if omitted."),
        preserveCurrentPrice: z
          .boolean()
          .optional()
          .describe(
            "If true, existing subscribers keep their current price and only new subscribers get the new price.",
          ),
      },
    },
    async ({ subscriptionId, pricePointId, territory, startDate, preserveCurrentPrice }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/subscriptionPrices", {
          data: {
            type: "subscriptionPrices",
            attributes: {
              ...(startDate !== undefined ? { startDate } : {}),
              ...(preserveCurrentPrice !== undefined ? { preserveCurrentPrice } : {}),
            },
            relationships: {
              subscription: {
                data: { type: "subscriptions", id: subscriptionId },
              },
              subscriptionPricePoint: {
                data: {
                  type: "subscriptionPricePoints",
                  id: pricePointId,
                },
              },
              ...(territory
                ? {
                    territory: {
                      data: { type: "territories", id: territory },
                    },
                  }
                : {}),
            },
          },
        });
        return json({ id: resp.data.id, ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_price",
    {
      description:
        "Delete a scheduled or current subscription price. " + "Use list_app_subscription_prices to find the price ID.",
      inputSchema: {
        priceId: z.string().describe("Subscription price ID from list_app_subscription_prices."),
      },
    },
    async ({ priceId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/subscriptionPrices/${priceId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
