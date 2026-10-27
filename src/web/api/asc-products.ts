import type { EqualizedPricePoint } from "../../services/asc-subscription-prices";
import type { AppStoreConnectClient } from "../../services/appstore-connect";
import { bundleAccess } from "../auth";
import {
  SMART_PRICING_BASE_TERRITORY,
  ascClientForUser,
  buildSmartPriceRows,
  handle,
} from "./asc-shared";
import { ascRouter } from "./asc-versions";

const ASC_V2 = "https://api.appstoreconnect.apple.com/v2";

function mapProduct(p: any) {
  return {
    id: p.id,
    name: p.attributes?.name ?? "",
    productId: p.attributes?.productId ?? "",
    inAppPurchaseType: p.attributes?.inAppPurchaseType ?? "CONSUMABLE",
    state: p.attributes?.state ?? "",
    reviewNote: p.attributes?.reviewNote ?? null,
  };
}

ascRouter.get(
  "/products",
  bundleAccess("query"),
  handle("listProducts", async (req, res) => {
    const bundleId = req.query.bundleId as string;
    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });

      return;
    }

    const { data: resp } = await asc.client.get(`/apps/${app.id}/inAppPurchasesV2`, {
      params: {
        "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state,reviewNote",
        limit: 200,
      },
    });

    res.json((resp.data ?? []).map(mapProduct));
  }),
);

ascRouter.post(
  "/products",
  bundleAccess("body"),
  handle("createProduct", async (req, res) => {
    const { name, productId, inAppPurchaseType, reviewNote } = req.body as {
      name: string;
      productId: string;
      inAppPurchaseType: string;
      reviewNote?: string;
    };

    if (!name || !productId || !inAppPurchaseType) {
      res.status(400).json({ error: "name, productId, inAppPurchaseType are required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(req.bundleApp!.bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found" });

      return;
    }

    const attrs: Record<string, any> = { name, productId, inAppPurchaseType };
    if (reviewNote) attrs.reviewNote = reviewNote;

    const { data: resp } = await asc.client.post(`${ASC_V2}/inAppPurchases`, {
      data: {
        type: "inAppPurchases",
        attributes: attrs,
        relationships: { app: { data: { type: "apps", id: app.id } } },
      },
    });

    res.status(201).json(mapProduct(resp.data));
  }),
);

ascRouter.patch(
  "/products/:id",
  handle("updateProduct", async (req, res) => {
    const { id } = req.params;
    const { name, reviewNote } = req.body as { name?: string; reviewNote?: string | null };
    const asc = await ascClientForUser(req.user!.userId);
    const attrs: Record<string, any> = {};

    if (name !== undefined) attrs.name = name;
    if (reviewNote !== undefined) attrs.reviewNote = reviewNote;

    await asc.client.patch(`${ASC_V2}/inAppPurchases/${id}`, {
      data: { type: "inAppPurchases", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/products/:id",
  handle("deleteProduct", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`${ASC_V2}/inAppPurchases/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/products/:id/localizations",
  handle("listProductLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`${ASC_V2}/inAppPurchases/${id}/inAppPurchaseLocalizations`, {
      params: {
        "fields[inAppPurchaseLocalizations]": "locale,name,description,state",
        limit: 50,
      },
    });

    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        description: l.attributes?.description ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/products/localizations",
  handle("createProductLocalization", async (req, res) => {
    const {
      productId: iapId,
      locale,
      name,
      description,
    } = req.body as {
      productId: string;
      locale: string;
      name: string;
      description?: string;
    };

    if (!iapId || !locale || !name) {
      res.status(400).json({ error: "productId, locale, name required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/inAppPurchaseLocalizations", {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: { locale, name, description: description ?? "" },
        relationships: {
          inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      description: resp.data.attributes?.description ?? "",
    });
  }),
);

ascRouter.patch(
  "/products/localizations/:id",
  handle("updateProductLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body as { name?: string; description?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const attrs: Record<string, any> = {};

    if (name !== undefined) attrs.name = name;
    if (description !== undefined) attrs.description = description;

    await asc.client.patch(`/inAppPurchaseLocalizations/${id}`, {
      data: { type: "inAppPurchaseLocalizations", id, attributes: attrs },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/products/localizations/:id",
  handle("deleteProductLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/inAppPurchaseLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/products/:id/price-points",
  handle("listProductPricePoints", async (req, res) => {
    const { id } = req.params;
    const territory = req.query.territory as string | undefined;
    const asc = await ascClientForUser(req.user!.userId);
    const params: Record<string, any> = {
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds,territory",
      limit: 8000,
    };

    if (territory) params["filter[territory]"] = territory;

    const { data: resp } = await asc.client.get(`${ASC_V2}/inAppPurchases/${id}/pricePoints`, { params });

    res.json(
      (resp.data ?? []).map((p: any) => ({
        id: p.id,
        customerPrice: p.attributes?.customerPrice ?? null,
        proceeds: p.attributes?.proceeds ?? null,
        territory: p.attributes?.territory ?? null,
        currency: null,
      })),
    );
  }),
);

async function fetchIapSchedulePrices(
  asc: AppStoreConnectClient,
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

async function getIapScheduleId(asc: AppStoreConnectClient, iapId: string): Promise<string | null> {
  try {
    const { data: sched } = await asc.client.get(`${ASC_V2}/inAppPurchases/${iapId}/iapPriceSchedule`);

    return sched.data?.id ?? null;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

async function fetchProductPrices(asc: AppStoreConnectClient, iapId: string): Promise<any[]> {
  const scheduleId = await getIapScheduleId(asc, iapId);
  if (!scheduleId) return [];

  const [manual, automatic] = await Promise.all([
    fetchIapSchedulePrices(asc, scheduleId, "manualPrices"),
    fetchIapSchedulePrices(asc, scheduleId, "automaticPrices"),
  ]);

  const byTerritory = new Map<string, any>();
  for (const p of [...automatic, ...manual]) {
    if (p.territory) byTerritory.set(p.territory, p);
  }

  return [...byTerritory.values()].sort((a, b) => (a.territory ?? "").localeCompare(b.territory ?? ""));
}

ascRouter.get(
  "/products/:id/prices",
  handle("listProductPrices", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    res.json(await fetchProductPrices(asc, String(id)));
  }),
);

ascRouter.post(
  "/products/prices",
  handle("setProductPrice", async (req, res) => {
    const {
      productId: iapId,
      pricePointId,
      territory,
    } = req.body as {
      productId: string;
      pricePointId: string;
      territory: string;
    };

    if (!iapId || !pricePointId || !territory) {
      res.status(400).json({ error: "productId, pricePointId, territory required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.post("/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
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
            inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
            territory: { data: { type: "territories", id: territory } },
          },
        },
      ],
    });

    res.json({ ok: true });
  }),
);

async function fetchProductEqualizations(
  asc: AppStoreConnectClient,
  pricePointId: string,
): Promise<EqualizedPricePoint[]> {
  const { data: resp } = await asc.client.get(`/inAppPurchasePricePoints/${pricePointId}/equalizations`, {
    params: {
      include: "territory",
      "fields[inAppPurchasePricePoints]": "customerPrice,proceeds,territory",
      "fields[territories]": "currency",
      limit: 8000,
    },
  });

  const included: any[] = resp.included ?? [];
  const terrMap = new Map<string, any>(
    included.filter((i: any) => i.type === "territories").map((t: any) => [t.id, t]),
  );

  return (resp.data ?? []).map((pp: any) => {
    const terrId = pp.relationships?.territory?.data?.id ?? null;

    return {
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
      proceeds: pp.attributes?.proceeds ?? null,
      territory: terrId,
      currency: terrId ? (terrMap.get(terrId)?.attributes?.currency ?? null) : null,
    };
  });
}

ascRouter.post(
  "/products/:id/smart-prices",
  handle("previewProductSmartPrices", async (req, res) => {
    const { id } = req.params;
    const { basePricePointId } = (req.body ?? {}) as { basePricePointId?: string };
    const asc = await ascClientForUser(req.user!.userId);

    const [catalogResp, currentPrices] = await Promise.all([
      asc.client.get(`${ASC_V2}/inAppPurchases/${id}/pricePoints`, {
        params: {
          "fields[inAppPurchasePricePoints]": "customerPrice",
          "filter[territory]": SMART_PRICING_BASE_TERRITORY,
          limit: 8000,
        },
      }),
      fetchProductPrices(asc, String(id)),
    ]);

    const baseCatalog = (catalogResp.data.data ?? []).map((pp: any) => ({
      id: pp.id,
      customerPrice: pp.attributes?.customerPrice ?? null,
    }));

    const currentByTerritory = new Map<string, any>(
      currentPrices.filter((p: any) => p.territory).map((p: any) => [p.territory, p]),
    );

    const baseId = basePricePointId ?? currentByTerritory.get(SMART_PRICING_BASE_TERRITORY)?.pricePointId;

    if (!baseId) {
      res.status(400).json({ error: "No USA price set. Pick a US base price first." });
      return;
    }

    const rows = await buildSmartPriceRows({
      basePricePointId: baseId,
      baseCatalog,
      currentByTerritory,
      fetchEqualizations: (pointId) => fetchProductEqualizations(asc, pointId),
    });

    res.json({ baseTerritory: SMART_PRICING_BASE_TERRITORY, basePricePointId: baseId, rows });
  }),
);

ascRouter.post(
  "/products/prices/bulk",
  handle("bulkSetProductPrices", async (req, res) => {
    const { productId: iapId, items } = req.body as {
      productId?: string;
      items?: Array<{ territory?: string; pricePointId?: string }>;
    };

    if (!iapId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "productId and a non-empty items array are required" });
      return;
    }

    if (items.some((i) => !i.territory || !i.pricePointId)) {
      res.status(400).json({ error: "Every item needs territory and pricePointId" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    const scheduleId = await getIapScheduleId(asc, iapId);
    let baseTerritory = SMART_PRICING_BASE_TERRITORY;
    const merged = new Map<string, string>();

    if (scheduleId) {
      try {
        const { data: bt } = await asc.client.get(`/inAppPurchasePriceSchedules/${scheduleId}/baseTerritory`);

        baseTerritory = bt.data?.id ?? SMART_PRICING_BASE_TERRITORY;
      } catch {
      }

      const existingManual = await fetchIapSchedulePrices(asc, scheduleId, "manualPrices");
      for (const p of existingManual) {
        if (p.territory && p.pricePointId) merged.set(p.territory, p.pricePointId);
      }
    }

    for (const item of items) merged.set(item.territory!, item.pricePointId!);

    if (!merged.has(baseTerritory)) {
      res
        .status(400)
        .json({ error: `The base territory (${baseTerritory}) needs a price. Include it in the selection.` });
      return;
    }

    const entries = [...merged.entries()];

    await asc.client.post("/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          baseTerritory: { data: { type: "territories", id: baseTerritory } },
          manualPrices: {
            data: entries.map((_, i) => ({ type: "inAppPurchasePrices", id: `\${manualPrice${i + 1}}` })),
          },
        },
      },
      included: entries.map(([territory, pricePointId], i) => ({
        type: "inAppPurchasePrices",
        id: `\${manualPrice${i + 1}}`,
        attributes: { startDate: null },
        relationships: {
          inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
          territory: { data: { type: "territories", id: territory } },
        },
      })),
    });

    res.json({
      ok: true,
      applied: items.length,
      failed: 0,
      results: items.map((i) => ({ territory: i.territory!, ok: true })),
    });
  }),
);
