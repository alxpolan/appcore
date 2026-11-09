import { describe, it } from "node:test";
import assert from "node:assert/strict";
import axios, { RequestConfig } from "../src/services/utils/http";
import { prisma } from "../src/config";
import { AscAnalyticsService } from "../src/services/asc-analytics-service";
import { allReviewTerritories, storefrontCount } from "../src/services/utils/asc-storefronts";

describe("reviews sync: all-storefront territory coverage", () => {
  it("returns one territory per storefront", () => {
    assert.equal(allReviewTerritories().length, storefrontCount());
  });

  it("uses Apple alpha-3 territory codes", () => {
    const territories = allReviewTerritories();

    for (const territory of territories) {
      assert.match(territory, /^[A-Z]{3}$/);
    }
  });

  it("covers major storefronts beyond the US", () => {
    const territories = allReviewTerritories();

    for (const expected of ["USA", "GBR", "DEU", "FRA", "JPN", "AUS", "CAN", "BRA", "KOR", "CHN"]) {
      assert.ok(territories.includes(expected), `missing ${expected}`);
    }
  });

  it("returns sorted unique codes", () => {
    const territories = allReviewTerritories();

    assert.deepEqual(territories, [...new Set(territories)].sort());
  });
});

describe("reviews sync: stubbed multi-storefront customerReviews", () => {
  it("requests every territory and persists USA and non-USA reviews with ratings", async () => {
    const expectedTerritories = allReviewTerritories();
    const probeTerritories = ["AUS", "BRA", "CAN", "DEU", "USA"];
    const expectedRatings: Record<string, number> = {
      AUS: 4,
      BRA: 3,
      CAN: 2,
      DEU: 1,
      USA: 5,
    };
    const requestedTerritories: string[] = [];
    const persistedReviews: any[] = [];
    const service = new AscAnalyticsService({
      teamId: "team-test",
      ascIssuerId: "issuer-test",
      ascKeyId: "key-test",
      ascPrivateKey: "private-key-test",
      ascVendorNumber: "vendor-test",
    });
    const serviceInternals = service as unknown as { authHeaders: () => Record<string, string> };
    const originalAuthHeaders = serviceInternals.authHeaders;
    const httpClient = axios as unknown as { get: typeof axios.get };
    const originalHttpGet = httpClient.get;
    const reviewStore = prisma.appReview as unknown as { upsert: typeof prisma.appReview.upsert };
    const originalUpsert = reviewStore.upsert;

    for (const probeTerritory of probeTerritories) {
      assert.ok(expectedTerritories.includes(probeTerritory));
    }

    serviceInternals.authHeaders = () => ({ Authorization: "Bearer test-token" });
    httpClient.get = (async (url: string, config: RequestConfig = {}) => {
      const territory = config.params?.["filter[territory]"];

      if (typeof territory !== "string" || territory.length === 0) {
        throw new Error("customerReviews stub received no territory filter");
      }

      requestedTerritories.push(territory);

      const rating = expectedRatings[territory];
      const reviews = rating === undefined
        ? []
        : [
          {
            id: `review-${territory}`,
            attributes: {
              rating,
              title: `${territory} review`,
              body: `${territory} body`,
              reviewerNickname: `${territory} reviewer`,
              territory,
              createdDate: "2026-11-02T00:00:00.000Z",
            },
          },
        ];

      return {
        data: { data: reviews, links: {} },
        status: 200,
        statusText: "OK",
        headers: {},
        config: { ...config, method: "GET", url },
      };
    }) as typeof axios.get;
    reviewStore.upsert = (async (args: Parameters<typeof prisma.appReview.upsert>[0]) => {
      const persisted = { ...args.create, id: `persisted-${persistedReviews.length}`, createdAt: new Date("2026-11-02T00:00:00.000Z") };

      persistedReviews.push(persisted);

      return persisted;
    }) as typeof prisma.appReview.upsert;

    try {
      const fetched = await service.fetchReviews("app-test", "com.example.app");
      const persistedRatings: Record<string, number> = {};

      for (const persisted of persistedReviews) {
        persistedRatings[persisted.territory] = persisted.rating;
      }

      assert.equal(fetched, probeTerritories.length);
      assert.deepEqual(requestedTerritories, expectedTerritories);
      assert.equal(persistedReviews.length, probeTerritories.length);
      assert.deepEqual(
        persistedReviews.map((persisted) => persisted.territory),
        probeTerritories,
      );
      assert.deepEqual(persistedRatings, expectedRatings);

      for (const persisted of persistedReviews) {
        assert.equal(persisted.bundleId, "com.example.app");
        assert.equal(persisted.title, `${persisted.territory} review`);
        assert.equal(persisted.body, `${persisted.territory} body`);
      }

      console.log(JSON.stringify({
        event: "customerReviews stub requests",
        requestCount: requestedTerritories.length,
        territories: requestedTerritories,
      }));
      console.log(JSON.stringify({
        event: "persisted customer reviews",
        persistedCount: persistedReviews.length,
        persisted: persistedReviews.map((persisted) => ({
          territory: persisted.territory,
          rating: persisted.rating,
          ascReviewId: persisted.ascReviewId,
        })),
      }));
    } finally {
      serviceInternals.authHeaders = originalAuthHeaders;
      httpClient.get = originalHttpGet;
      reviewStore.upsert = originalUpsert;
    }
  });
});
