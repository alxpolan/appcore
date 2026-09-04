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

const ASC_V2 = "https://api.appstoreconnect.apple.com/v2";

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

async function fetchIapSchedulePrices(
  asc: Awaited<ReturnType<typeof createAscClient>>,
  scheduleId: string,
  relation: "manualPrices" | "automaticPrices",
): Promise<any[]> {
  const { data: resp } = await asc.client.get(`/inAppPurchasePriceSchedules/${scheduleId}/${relation}`, {
    params: {
      include: "territory,inAppPurchasePricePoint",
      "fields[inAppPurchasePrices]": "startDate,territory,inAppPurchasePricePoint",
      "fields[territories]": "currency",
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds",
      limit: 200,
    },
  });

  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>();
  const ppMap = new Map<string, any>();

  for (const item of included) {
    if (item.type === "territories") terrMap.set(item.id, item);
    if (item.type === "inAppPurchasePricePoints") ppMap.set(item.id, item);
  }

  return (resp.data ?? []).map((price: any) => {
    const terrId = price.relationships?.territory?.data?.id;
    const ppId = price.relationships?.inAppPurchasePricePoint?.data?.id;
    const terr = terrId ? terrMap.get(terrId) : null;
    const pp = ppId ? ppMap.get(ppId) : null;

    return {
      id: price.id,
      territory: terrId ?? null,
      currency: terr?.attributes?.currency ?? null,
      customerPrice: pp?.attributes?.customerPrice ?? null,
      proceeds: pp?.attributes?.proceeds ?? null,
      startDate: price.attributes?.startDate ?? null,
      pricePointId: ppId ?? null,
    };
  });
}

function mapProduct(p: any) {
  return {
    id: p.id,
    name: p.attributes?.name ?? "",
    productId: p.attributes?.productId ?? "",
    inAppPurchaseType: p.attributes?.inAppPurchaseType ?? "NON_CONSUMABLE",
    state: p.attributes?.state ?? "",
    reviewNote: p.attributes?.reviewNote ?? null,
  };
}

export function registerAscProductTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_asc_products",
    {
      description:
        "List all App Store Connect in-app purchase products (non-consumable and consumable one-time purchases) for an app. " +
        "Returns product IDs, names, productId, inAppPurchaseType, state, and reviewNote. " +
        "Use this to discover product IDs for other product tools.",
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

        const { data: resp } = await asc.client.get(`/apps/${app.id}/inAppPurchasesV2`, {
          params: {
            "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state,reviewNote",
            limit: 200,
          },
        });

        return json((resp.data ?? []).map(mapProduct));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_asc_product",
    {
      description:
        "Create a new App Store Connect in-app purchase product, defaulting to a non-consumable (one-time purchase that unlocks permanently). " +
        "The productId must be unique across all your apps and cannot be changed later.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        name: z.string().describe("Internal reference name for the product."),
        productId: z
          .string()
          .describe(
            "Product identifier (e.g. 'com.example.myapp.pro_unlock'). Must be globally unique and cannot be changed.",
          ),
        inAppPurchaseType: z
          .enum(["NON_CONSUMABLE", "CONSUMABLE"])
          .optional()
          .describe(
            "Type of one-time purchase. Defaults to NON_CONSUMABLE (permanent unlock). Use CONSUMABLE for items that can be repurchased.",
          ),
        reviewNote: z.string().optional().describe("Notes for App Review."),
      },
    },
    async ({ bundleId, name, productId, inAppPurchaseType, reviewNote }) => {
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

        const attrs: Record<string, any> = {
          name,
          productId,
          inAppPurchaseType: inAppPurchaseType ?? "NON_CONSUMABLE",
        };

        if (reviewNote) attrs.reviewNote = reviewNote;

        const { data: resp } = await asc.client.post(`${ASC_V2}/inAppPurchases`, {
          data: {
            type: "inAppPurchases",
            attributes: attrs,
            relationships: {
              app: { data: { type: "apps", id: app.id } },
            },
          },
        });

        return json(mapProduct(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_asc_product",
    {
      description:
        "Update an existing in-app purchase product's mutable attributes. " +
        "productId and inAppPurchaseType cannot be changed after creation. Only pass the fields you want to change.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
        name: z.string().optional().describe("New internal reference name."),
        reviewNote: z.string().optional().describe("Notes for App Review."),
      },
    },
    async ({ productDbId, name, reviewNote }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attributes: Record<string, any> = {};

        if (name !== undefined) attributes.name = name;
        if (reviewNote !== undefined) attributes.reviewNote = reviewNote;

        await asc.client.patch(`${ASC_V2}/inAppPurchases/${productDbId}`, {
          data: {
            type: "inAppPurchases",
            id: productDbId,
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
    "delete_asc_product",
    {
      description:
        "Delete an in-app purchase product. Only possible for products that have never been approved (state MISSING_METADATA, READY_TO_SUBMIT, or WAITING_FOR_REVIEW).",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
      },
    },
    async ({ productDbId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`${ASC_V2}/inAppPurchases/${productDbId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_asc_product_localizations",
    {
      description:
        "List all localizations (display name and description per locale) for an in-app purchase product. " +
        "Use this to get localization IDs for update/delete operations.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
      },
    },
    async ({ productDbId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(
          `${ASC_V2}/inAppPurchases/${productDbId}/inAppPurchaseLocalizations`,
          {
            params: {
              "fields[inAppPurchaseLocalizations]": "locale,name,description,state",
              limit: 50,
            },
          },
        );

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
    "create_asc_product_localization",
    {
      description:
        "Create a new localization for an in-app purchase product with a display name (shown to users) and optional description.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
        locale: z.string().describe("Locale code (e.g. 'en-US', 'de-DE', 'fr-FR')."),
        name: z.string().describe("Display name shown to users in this locale."),
        description: z.string().optional().describe("Optional description shown to users in this locale."),
      },
    },
    async ({ productDbId, locale, name, description }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/inAppPurchaseLocalizations", {
          data: {
            type: "inAppPurchaseLocalizations",
            attributes: {
              locale,
              name,
              description: description ?? "",
            },
            relationships: {
              inAppPurchaseV2: {
                data: { type: "inAppPurchases", id: productDbId },
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
    "update_asc_product_localization",
    {
      description:
        "Update the display name or description of an existing product localization. Only pass the fields you want to change.",
      inputSchema: {
        localizationId: z.string().describe("Product localization ID from list_asc_product_localizations."),
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

        await asc.client.patch(`/inAppPurchaseLocalizations/${localizationId}`, {
          data: {
            type: "inAppPurchaseLocalizations",
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
    "delete_asc_product_localization",
    {
      description: "Delete an in-app purchase product localization.",
      inputSchema: {
        localizationId: z.string().describe("Product localization ID from list_asc_product_localizations."),
      },
    },
    async ({ localizationId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/inAppPurchaseLocalizations/${localizationId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_asc_product_price_points",
    {
      description:
        "List available price points (tier catalog) for an in-app purchase product. " +
        "Each price point has an ID, customer price, proceeds, and territory. " +
        "Use these IDs when calling create_asc_product_price. Filter by territory to limit results.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
        territory: z
          .string()
          .optional()
          .describe("Optional territory code (e.g. 'USA', 'DEU') to filter price points."),
      },
    },
    async ({ productDbId, territory }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const params: Record<string, any> = {
          "fields[inAppPurchasePricePoints]": "customerPrice,proceeds,territory",
          limit: 200,
        };
        if (territory) params["filter[territory]"] = territory;

        const { data: resp } = await asc.client.get(`${ASC_V2}/inAppPurchases/${productDbId}/pricePoints`, { params });
        return json(
          (resp.data ?? []).map((pp: any) => ({
            id: pp.id,
            customerPrice: pp.attributes?.customerPrice ?? null,
            proceeds: pp.attributes?.proceeds ?? null,
            territory: pp.attributes?.territory ?? null,
          })),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_asc_product_prices",
    {
      description:
        "List the current prices configured for an in-app purchase product across all territories. " +
        "Each entry includes the price entry ID, territory, currency, customer price, proceeds, price point ID, and start date.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
      },
    },
    async ({ productDbId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        let scheduleId: string | undefined;
        try {
          const { data: sched } = await asc.client.get(`${ASC_V2}/inAppPurchases/${productDbId}/iapPriceSchedule`);
          scheduleId = sched.data?.id;
        } catch (err: any) {
          if (err?.response?.status === 404) return json([]);
          throw err;
        }
        if (!scheduleId) return json([]);

        const [manual, automatic] = await Promise.all([
          fetchIapSchedulePrices(asc, scheduleId, "manualPrices"),
          fetchIapSchedulePrices(asc, scheduleId, "automaticPrices"),
        ]);

        const byTerritory = new Map<string, any>();
        for (const p of [...automatic, ...manual]) {
          if (p.territory) byTerritory.set(p.territory, p);
        }

        return json([...byTerritory.values()].sort((a, b) => (a.territory ?? "").localeCompare(b.territory ?? "")));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_asc_product_price",
    {
      description:
        "Set the price for an in-app purchase product in a given territory. " +
        "Provide a pricePointId from list_asc_product_price_points. This sets the base territory and schedules the price immediately.",
      inputSchema: {
        productDbId: z.string().describe("Product ID from list_asc_products."),
        pricePointId: z.string().describe("Price point ID from list_asc_product_price_points."),
        territory: z.string().describe("Base territory code (e.g. 'USA', 'DEU')."),
      },
    },
    async ({ productDbId, pricePointId, territory }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.post("/inAppPurchasePriceSchedules", {
          data: {
            type: "inAppPurchasePriceSchedules",
            relationships: {
              inAppPurchase: {
                data: { type: "inAppPurchases", id: productDbId },
              },
              baseTerritory: { data: { type: "territories", id: territory } },
              manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${manualPrice1}" }] },
            },
          },
          included: [
            {
              type: "inAppPurchasePrices",
              id: "${manualPrice1}",
              attributes: { startDate: null },
              relationships: {
                inAppPurchasePricePoint: {
                  data: { type: "inAppPurchasePricePoints", id: pricePointId },
                },
                territory: { data: { type: "territories", id: territory } },
              },
            },
          ],
        });
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
