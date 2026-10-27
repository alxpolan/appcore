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

export function registerAscSubscriptionGroupTools(server: McpServer, userId: string) {
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
}
