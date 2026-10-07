import type { AppStoreConnectClient } from "./appstore-connect";

const USD_TERRITORY = "USA";

export interface SubscriptionPrice {
  id: string;
  territory: string | null;
  currency: string | null;
  customerPrice: string | null;
  proceeds: string | null;
  proceedsUsd: string | null;
  pricePointId: string | null;
  startDate: string | null;
  preserved: boolean;
}

export interface EqualizedPricePoint {
  id: string;
  customerPrice: string | null;
  proceeds: string | null;
  territory: string | null;
  currency: string | null;
}

// Price points carry proceeds in their own territory's currency, so a German
// price point's "proceeds" is in EUR, not USD. Equalizations map one price
// point to its equivalent in every other territory (same Apple price tier,
// converted at Apple's FX+tax rates) - the USA entry in that set is the only
// place to read the USD-denominated proceeds for a given price.
export async function fetchSubscriptionPriceEqualizations(
  asc: AppStoreConnectClient,
  pricePointId: string,
): Promise<EqualizedPricePoint[]> {
  const { data: resp } = await asc.client.get(`/subscriptionPricePoints/${pricePointId}/equalizations`, {
    params: {
      include: "territory",
      "fields[subscriptionPricePoints]": "customerPrice,proceeds,territory",
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

async function fetchUsdProceeds(asc: AppStoreConnectClient, pricePointId: string): Promise<string | null> {
  const equalizations = await fetchSubscriptionPriceEqualizations(asc, pricePointId);
  return equalizations.find((p) => p.territory === USD_TERRITORY)?.proceeds ?? null;
}

export async function fetchSubscriptionPrices(asc: AppStoreConnectClient, subscriptionId: string): Promise<SubscriptionPrice[]> {
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
  const prices = (resp.data ?? []).map((p: any) => {
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
  });

  const usdByPricePointId = new Map<string, string | null>();
  const pricePointIdsNeedingUsd = [...new Set(prices.filter((p) => p.territory !== USD_TERRITORY && p.pricePointId).map((p) => p.pricePointId as string))];
  await Promise.all(
    pricePointIdsNeedingUsd.map(async (ppId) => {
      try {
        usdByPricePointId.set(ppId, await fetchUsdProceeds(asc, ppId));
      } catch {
        usdByPricePointId.set(ppId, null);
      }
    }),
  );

  return prices.map((p) => ({
    ...p,
    proceedsUsd: p.territory === USD_TERRITORY ? p.proceeds : (p.pricePointId ? usdByPricePointId.get(p.pricePointId) ?? null : null),
  }));
}
