import { logger } from "../../config";
import { toReviewScreenshot, uploadReviewScreenshot } from "../../services/asc-review-screenshots";
import {
  fetchSubscriptionPrices,
  fetchSubscriptionPriceEqualizations,
} from "../../services/asc-subscription-prices";
import {
  SMART_PRICING_BASE_TERRITORY,
  ascClientForUser,
  buildSmartPriceRows,
  handle,
} from "./asc-shared";
import { ascRouter } from "./asc-versions";

ascRouter.post(
  "/subscriptions/:id/smart-prices",
  handle("previewSubscriptionSmartPrices", async (req, res) => {
    const { id } = req.params;
    const { basePricePointId } = (req.body ?? {}) as { basePricePointId?: string };
    const asc = await ascClientForUser(req.user!.userId);

    const [catalogResp, currentPrices] = await Promise.all([
      asc.client.get(`/subscriptions/${id}/pricePoints`, {
        params: {
          "fields[subscriptionPricePoints]": "customerPrice",
          "filter[territory]": SMART_PRICING_BASE_TERRITORY,
          limit: 8000,
        },
      }),
      fetchSubscriptionPrices(asc, String(id)),
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
      fetchEqualizations: (pointId) => fetchSubscriptionPriceEqualizations(asc, pointId),
    });

    res.json({ baseTerritory: SMART_PRICING_BASE_TERRITORY, basePricePointId: baseId, rows });
  }),
);

ascRouter.post(
  "/subscriptions/prices/bulk",
  handle("bulkCreateSubscriptionPrices", async (req, res) => {
    const { subscriptionId, items, preserveCurrentPrice, startDate } = req.body as {
      subscriptionId?: string;
      items?: Array<{ territory?: string; pricePointId?: string }>;
      preserveCurrentPrice?: boolean;
      startDate?: string;
    };

    if (!subscriptionId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "subscriptionId and a non-empty items array are required" });

      return;
    }

    if (items.some((i) => !i.territory || !i.pricePointId)) {
      res.status(400).json({ error: "Every item needs territory and pricePointId" });

      return;
    }

    const daysFromNow = (n: number) => {
      const d = new Date();

      d.setUTCDate(d.getUTCDate() + n);

      return d.toISOString().slice(0, 10);
    };

    const defaultStartDate = startDate ?? daysFromNow(2);

    const asc = await ascClientForUser(req.user!.userId);

    const postPrice = (item: { territory?: string; pricePointId?: string }, start: string) =>
      asc.client.post("/subscriptionPrices", {
        data: {
          type: "subscriptionPrices",
          attributes: {
            startDate: start,
            ...(preserveCurrentPrice !== undefined ? { preserveCurrentPrice } : {}),
          },
          relationships: {
            subscription: { data: { type: "subscriptions", id: subscriptionId } },
            subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: item.pricePointId! } },
            territory: { data: { type: "territories", id: item.territory! } },
          },
        },
      });

    const results: Array<{ territory: string; ok: boolean; error?: string }> = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          try {
            await postPrice(item, defaultStartDate);

            return { territory: item.territory!, ok: true };
          } catch (err: any) {
            const detail = err?.response?.data?.errors?.[0]?.detail ?? err?.message ?? "Unknown error";
            const requiredDate = /on or after (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1];

            if (requiredDate && requiredDate !== defaultStartDate) {
              try {
                await postPrice(item, requiredDate);

                return { territory: item.territory!, ok: true };
              } catch (retryErr: any) {
                const retryDetail =
                  retryErr?.response?.data?.errors?.[0]?.detail ?? retryErr?.message ?? "Unknown error";

                logger.error(
                  `ASC bulkCreateSubscriptionPrices retry failed for ${item.territory}`,
                  retryErr?.response?.data?.errors ?? retryErr,
                );

                return { territory: item.territory!, ok: false, error: retryDetail };
              }
            }

            logger.error(
              `ASC bulkCreateSubscriptionPrices failed for ${item.territory}`,
              err?.response?.data?.errors ?? err,
            );

            return { territory: item.territory!, ok: false, error: detail };
          }
        }),
      );

      results.push(...chunkResults);
    }

    const failed = results.filter((r) => !r.ok).length;

    res.json({ ok: failed === 0, applied: results.length - failed, failed, results });
  }),
);

ascRouter.get(
  "/subscriptions/:id/review-screenshot",
  handle("getSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);
    const { data: resp } = await asc.client.get(`/subscriptions/${id}/appStoreReviewScreenshot`, {
      params: {
        "fields[subscriptionAppStoreReviewScreenshots]":
          "fileName,fileSize,sourceFileChecksum,imageAsset,assetToken,assetType,uploadOperations,assetDeliveryState",
      },
    });

    res.json(toReviewScreenshot(resp.data));
  }),
);

ascRouter.post(
  "/subscriptions/:id/review-screenshot",
  handle("createSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const { fileName, fileSize, fileData } = req.body as {
      fileName?: string;
      fileSize?: number;
      fileData?: string;
    };

    if (!fileName || !fileSize || !fileData) {
      res.status(400).json({ error: "fileName, fileSize and fileData are required" });

      return;
    }

    const asc = await ascClientForUser(req.user!.userId);
    const screenshotId = await uploadReviewScreenshot(asc, id, {
      fileName,
      bytes: Buffer.from(fileData, "base64"),
    });

    res.status(201).json({ id: screenshotId, ok: true });
  }),
);

ascRouter.delete(
  "/subscriptions/review-screenshots/:id",
  handle("deleteSubscriptionReviewScreenshot", async (req, res) => {
    const { id } = req.params;
    const asc = await ascClientForUser(req.user!.userId);

    await asc.client.delete(`/subscriptionAppStoreReviewScreenshots/${id}`);

    res.json({ ok: true });
  }),
);
