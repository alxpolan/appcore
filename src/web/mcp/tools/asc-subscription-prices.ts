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

export function registerAscSubscriptionPriceTools(server: McpServer, userId: string) {
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
