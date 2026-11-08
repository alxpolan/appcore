import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionWinBackOfferTools } from "../src/web/mcp/tools/asc-subscription-win-back-offers";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscSubscriptionWinBackOfferTools(server, "user1");

  return tools;
}

describe("win-back offer MCP tools", () => {
  it("registers list, create, update, delete and prices tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      [
        "create_app_subscription_win_back_offer",
        "delete_app_subscription_win_back_offer",
        "list_app_subscription_win_back_offer_prices",
        "list_app_subscription_win_back_offers",
        "update_app_subscription_win_back_offer",
      ].sort(),
    );
  });

  it("accepts a spec-derived create payload", () => {
    const tools = captureTools();
    const create = tools.get("create_app_subscription_win_back_offer")!;

    assert.ok(create, "create tool is registered");
    const parsed = z
      .object(create.config.inputSchema)
      .parse({
        subscriptionId: "sub1",
        referenceName: "Come back 50 percent",
        offerId: "winback_50",
        duration: "ONE_MONTH",
        offerMode: "PAY_AS_YOU_GO",
        periodCount: 2,
        customerEligibilityPaidSubscriptionDurationInMonths: 3,
        customerEligibilityTimeSinceLastSubscribedMinMonths: 1,
        customerEligibilityTimeSinceLastSubscribedMaxMonths: 12,
        startDate: "2026-12-01",
        priority: "HIGH",
        priceIds: ["price1"],
      }) as any;

    assert.equal(parsed.priority, "HIGH");
    assert.deepEqual(parsed.priceIds, ["price1"]);
  });

  it("rejects bad priorities and empty price lists", () => {
    const tools = captureTools();
    const create = tools.get("create_app_subscription_win_back_offer")!;
    const schema = z.object(create.config.inputSchema);
    const base = {
      subscriptionId: "sub1",
      referenceName: "Come back",
      offerId: "come_back",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      periodCount: 1,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      customerEligibilityTimeSinceLastSubscribedMinMonths: 1,
      customerEligibilityTimeSinceLastSubscribedMaxMonths: 6,
      startDate: "2026-12-01",
      priority: "HIGH",
      priceIds: ["price1"],
    };

    assert.throws(() => schema.parse({ ...base, priority: "LOW" }));
    assert.throws(() => schema.parse({ ...base, priceIds: [] }));
  });
});
