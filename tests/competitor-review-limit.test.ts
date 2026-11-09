import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "../src/web/api/apps-detail";
import { appsRouter } from "../src/web/api/apps-list";
import { prisma } from "../src/config";
import { registerAppCompetitorsTools } from "../src/web/mcp/tools/app-tools-competitors";

function competitorDetailHandler() {
  const layer = (appsRouter.stack as any[]).find(
    (candidate) => candidate.route?.path === "/:id/competitor-detail" && candidate.route?.methods?.get,
  );

  if (!layer) throw new Error("Competitor detail route is not registered");

  const handler = layer.route.stack[layer.route.stack.length - 1]?.handle;

  if (!handler) throw new Error("Competitor detail handler is not registered");

  return handler;
}

function competitorReviewFixtures(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `review-${index}`,
    rating: (index % 5) + 1,
    title: `Review ${index}`,
    body: `Body ${index}`,
    author: `Author ${index}`,
    territory: "US",
    reviewedAt: new Date(Date.now() - index * 60000),
  }));
}

describe("competitor reviews: detail loading limit", () => {
  it("returns the latest 200 stored reviews", async () => {
    const stored = competitorReviewFixtures(250);
    let take: unknown;
    let body: any;
    const restores: Array<() => void> = [];
    const stub = (target: any, key: string, implementation: any) => {
      const original = target[key];
      target[key] = implementation;
      restores.push(() => {
        target[key] = original;
      });
    };
    const app = {
      id: "competitor-app",
      bundleId: "com.example.competitor",
      name: "Competitor",
      trackId: BigInt(123),
      country: "US",
      currentTitle: "Competitor",
      currentSubtitle: "Subtitle",
      currentDescription: "Description",
      supportedLanguages: ["en-US"],
      snapshots: [{}],
    };

    stub(prisma.app, "findUnique", async () => app);
    stub(prisma.competitorRelation, "findFirst", async () => ({}));
    stub(prisma.competitorReview, "findMany", async (args: any) => {
      take = args.take;

      return stored.slice(0, args.take);
    });
    stub(prisma.competitorReviewSummary, "findFirst", async () => null);
    stub(prisma.appMetadataChange, "findMany", async () => []);
    stub(prisma.appInAppPurchase, "findMany", async () => []);
    stub(prisma.keyword, "findMany", async () => []);
    stub(prisma.keywordRanking, "findMany", async () => []);

    try {
      const req = { bundleApp: { id: "own-app" }, params: { id: "competitor-app" } };
      const res = {
        status: () => res,
        json: (value: any) => {
          body = value;
        },
      };

      await competitorDetailHandler()(req, res);
      assert.equal(take, 200);
      assert.equal(body.reviews.length, 200);
      assert.equal(body.reviews[0].id, "review-0");
      assert.equal(body.reviews[199].id, "review-199");
    } finally {
      for (const restore of restores) restore();
    }
  });

  it("allows an explicit 200-review request through the MCP tool", () => {
    const tools = new Map<string, { config: any; handler: any }>();
    const server = {
      registerTool: (name: string, config: any, handler: any) => {
        tools.set(name, { config, handler });
      },
    } as unknown as McpServer;

    registerAppCompetitorsTools(server, "user-test");

    const detail = tools.get("get_competitor_detail");
    assert.ok(detail);
    assert.equal(detail.config.inputSchema.reviewLimit.safeParse(200).success, true);
    assert.equal(detail.config.inputSchema.reviewLimit.safeParse(201).success, false);
  });
});
