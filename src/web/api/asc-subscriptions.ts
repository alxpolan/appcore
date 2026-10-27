import { ascClientForUser, handle } from "./asc-shared";
import { fetchSubscriptionPrices } from "../../services/asc-subscription-prices";
import { buildIntroductoryOfferBody, toIntroductoryOffer } from "../../services/asc-introductory-offers";
import { ascRouter } from "./asc-versions";

ascRouter.post(
  "/subscriptions/groups",
  handle("createSubscriptionGroup", async (req, res) => {
    const { bundleId, referenceName } = req.body as {
      bundleId?: string;
      referenceName?: string;
    };

    if (!referenceName) {
      res.status(400).json({ error: "referenceName is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const app = await asc.getApp(bundleId);

    if (!app) {
      res.status(404).json({ error: "App not found in App Store Connect" });
      return;
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

    res.status(201).json({
      id: resp.data.id,
      referenceName: resp.data.attributes?.referenceName ?? referenceName,
      subscriptions: [],
    });
  }),
);

ascRouter.patch(
  "/subscriptions/groups/:id",
  handle("updateSubscriptionGroup", async (req, res) => {
    const { id } = req.params;
    const { referenceName } = req.body as { referenceName?: string };

    if (!referenceName) {
      res.status(400).json({ error: "referenceName is required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.patch(`/subscriptionGroups/${id}`, {
      data: {
        type: "subscriptionGroups",
        id,
        attributes: { referenceName },
      },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/groups/:id",
  handle("deleteSubscriptionGroup", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionGroups/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/groups/:id/localizations",
  handle("listSubscriptionGroupLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptionGroups/${id}/subscriptionGroupLocalizations`, {
      params: {
        "fields[subscriptionGroupLocalizations]": "name,customAppName,locale,state",
        limit: 50,
      },
    });

    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        customAppName: l.attributes?.customAppName ?? null,
        state: l.attributes?.state ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/subscriptions/groups/localizations",
  handle("createSubscriptionGroupLocalization", async (req, res) => {
    const { groupId, locale, name, customAppName } = req.body as {
      groupId?: string;
      locale?: string;
      name?: string;
      customAppName?: string;
    };

    if (!groupId || !locale || !name) {
      res.status(400).json({ error: "groupId, locale and name are required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionGroupLocalizations", {
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: { locale, name, ...(customAppName ? { customAppName } : {}) },
        relationships: {
          subscriptionGroup: {
            data: { type: "subscriptionGroups", id: groupId },
          },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      customAppName: resp.data.attributes?.customAppName ?? customAppName ?? null,
      state: resp.data.attributes?.state ?? "",
    });
  }),
);

ascRouter.patch(
  "/subscriptions/groups/localizations/:id",
  handle("updateSubscriptionGroupLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, customAppName } = req.body as {
      name?: string;
      customAppName?: string;
    };

    const attributes: Record<string, any> = {};

    if (name !== undefined) attributes.name = name;
    if (customAppName !== undefined) attributes.customAppName = customAppName;

    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.patch(`/subscriptionGroupLocalizations/${id}`, {
      data: { type: "subscriptionGroupLocalizations", id, attributes },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/groups/localizations/:id",
  handle("deleteSubscriptionGroupLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionGroupLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.post(
  "/subscriptions",
  handle("createSubscription", async (req, res) => {
    const { groupId, name, productId, familySharable, subscriptionPeriod, groupLevel, reviewNote } = req.body as {
      groupId?: string;
      name?: string;
      productId?: string;
      familySharable?: boolean;
      subscriptionPeriod?: string;
      groupLevel?: number;
      reviewNote?: string;
    };

    if (!groupId || !name || !productId || !subscriptionPeriod) {
      res.status(400).json({
        error: "groupId, name, productId and subscriptionPeriod are required",
      });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
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
          group: { data: { type: "subscriptionGroups", id: groupId } },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      name: resp.data.attributes?.name ?? name,
      productId: resp.data.attributes?.productId ?? productId,
      familySharable: resp.data.attributes?.familySharable ?? false,
      state: resp.data.attributes?.state ?? "",
      subscriptionPeriod: resp.data.attributes?.subscriptionPeriod ?? subscriptionPeriod,
      reviewNote: resp.data.attributes?.reviewNote ?? null,
      groupLevel: resp.data.attributes?.groupLevel ?? null,
    });
  }),
);

ascRouter.patch(
  "/subscriptions/:id",
  handle("updateSubscription", async (req, res) => {
    const { id } = req.params;
    const { name, familySharable, subscriptionPeriod, reviewNote, groupLevel } = req.body as {
      name?: string;
      familySharable?: boolean;
      subscriptionPeriod?: string;
      reviewNote?: string;
      groupLevel?: number;
    };

    const attributes: Record<string, any> = {};

    if (name !== undefined) attributes.name = name;
    if (familySharable !== undefined) attributes.familySharable = familySharable;
    if (subscriptionPeriod !== undefined) attributes.subscriptionPeriod = subscriptionPeriod;
    if (reviewNote !== undefined) attributes.reviewNote = reviewNote;
    if (groupLevel !== undefined) attributes.groupLevel = groupLevel;

    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.patch(`/subscriptions/${id}`, {
      data: { type: "subscriptions", id, attributes },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/:id",
  handle("deleteSubscription", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptions/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/:id/localizations",
  handle("listSubscriptionLocalizations", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/subscriptionLocalizations`, {
      params: {
        "fields[subscriptionLocalizations]": "name,locale,description,state",
        limit: 200,
      },
    });

    res.json(
      (resp.data ?? []).map((l: any) => ({
        id: l.id,
        locale: l.attributes?.locale ?? "",
        name: l.attributes?.name ?? "",
        description: l.attributes?.description ?? "",
        state: l.attributes?.state ?? "",
      })),
    );
  }),
);

ascRouter.post(
  "/subscriptions/localizations",
  handle("createSubscriptionLocalization", async (req, res) => {
    const { subscriptionId, locale, name, description } = req.body as {
      subscriptionId?: string;
      locale?: string;
      name?: string;
      description?: string;
    };

    if (!subscriptionId || !locale || !name) {
      res.status(400).json({ error: "subscriptionId, locale and name are required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionLocalizations", {
      data: {
        type: "subscriptionLocalizations",
        attributes: { locale, name, ...(description ? { description } : {}) },
        relationships: {
          subscription: {
            data: { type: "subscriptions", id: subscriptionId },
          },
        },
      },
    });

    res.status(201).json({
      id: resp.data.id,
      locale: resp.data.attributes?.locale ?? locale,
      name: resp.data.attributes?.name ?? name,
      description: resp.data.attributes?.description ?? "",
      state: resp.data.attributes?.state ?? "",
    });
  }),
);

ascRouter.patch(
  "/subscriptions/localizations/:id",
  handle("updateSubscriptionLocalization", async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body as { name?: string; description?: string };
    const asc = await ascClientForUser(req.user!.userId);
    const attributes: Record<string, any> = {};

    if (name !== undefined) attributes.name = name;
    if (description !== undefined) attributes.description = description;

    await asc.client.patch(`/subscriptionLocalizations/${id}`, {
      data: { type: "subscriptionLocalizations", id, attributes },
    });

    res.json({ ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/localizations/:id",
  handle("deleteSubscriptionLocalization", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionLocalizations/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/:id/price-points",
  handle("listSubscriptionPricePoints", async (req, res) => {
    const { id } = req.params;
    const territory = (req.query.territory as string) || undefined;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/pricePoints`, {
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

    res.json(
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
  }),
);

ascRouter.get(
  "/subscriptions/:id/prices",
  handle("listSubscriptionPrices", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    res.json(await fetchSubscriptionPrices(asc, String(id)));
  }),
);

ascRouter.post(
  "/subscriptions/prices",
  handle("createSubscriptionPrice", async (req, res) => {
    const { subscriptionId, pricePointId, territory, startDate, preserveCurrentPrice } = req.body as {
      subscriptionId?: string;
      pricePointId?: string;
      territory?: string;
      startDate?: string | null;
      preserveCurrentPrice?: boolean;
    };

    if (!subscriptionId || !pricePointId) {
      res.status(400).json({ error: "subscriptionId and pricePointId are required" });
      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
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
            data: { type: "subscriptionPricePoints", id: pricePointId },
          },
          ...(territory ? { territory: { data: { type: "territories", id: territory } } } : {}),
        },
      },
    });

    res.status(201).json({ id: resp.data.id, ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/prices/:id",
  handle("deleteSubscriptionPrice", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionPrices/${id}`);

    res.json({ ok: true });
  }),
);

ascRouter.get(
  "/subscriptions/:id/introductory-offers",
  handle("listIntroductoryOffers", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/introductoryOffers`, {
      params: {
        "fields[subscriptionIntroductoryOffers]": "offerMode,duration,numberOfPeriods,startDate,endDate",
        limit: 200,
      },
    });

    res.json((resp.data ?? []).map(toIntroductoryOffer));
  }),
);

ascRouter.post(
  "/subscriptions/introductory-offers",
  handle("createIntroductoryOffer", async (req, res) => {
    const { subscriptionId, offerMode, duration, numberOfPeriods, territory, pricePointId, startDate, endDate } =
      req.body as {
        subscriptionId?: string;
        offerMode?: string;
        duration?: string;
        numberOfPeriods?: number;
        territory?: string;
        pricePointId?: string;
        startDate?: string;
        endDate?: string;
      };

    if (!subscriptionId) {
      res.status(400).json({ error: "subscriptionId is required" });
      return;
    }

    let body: ReturnType<typeof buildIntroductoryOfferBody>;
    try {
      body = buildIntroductoryOfferBody({
        subscriptionId,
        offerMode,
        duration,
        numberOfPeriods,
        territory,
        pricePointId,
        startDate,
        endDate,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Invalid introductory offer" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.post("/subscriptionIntroductoryOffers", body);

    res.status(201).json(toIntroductoryOffer(resp.data));
  }),
);

ascRouter.delete(
  "/subscriptions/introductory-offers/:id",
  handle("deleteIntroductoryOffer", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionIntroductoryOffers/${id}`);

    res.json({ ok: true });
  }),
);
