import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionRetentionOfferTools } from "../src/web/mcp/tools/asc-subscription-retention-offers";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscSubscriptionRetentionOfferTools(server, "user1");

  return tools;
}

describe("retention offer MCP tools", () => {
  it("registers list, create, update, delete and prices tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      [
        "create_app_subscription_retention_offer",
        "delete_app_subscription_retention_offer",
        "list_app_subscription_retention_offer_prices",
        "list_app_subscription_retention_offers",
        "update_app_subscription_retention_offer",
      ].sort(),
    );
  });

  it("accepts a spec-derived create payload", () => {
    const tools = captureTools();
    const create = tools.get("create_app_subscription_retention_offer")!;

    assert.ok(create, "create tool is registered");
    const parsed = z
      .object(create.config.inputSchema)
      .parse({
        subscriptionId: "sub1",
        referenceName: "Cancel save 20 percent",
        offerId: "retention_save_20",
        duration: "ONE_MONTH",
        offerMode: "PAY_AS_YOU_GO",
        periodCount: 3,
        customerEligibilityPaidSubscriptionDurationInMonths: 2,
        customerEligibilityWaitBetweenOffersInMonths: 6,
        targetSubscriptionPlanType: "MONTHLY",
        priceIds: ["price1"],
      }) as any;

    assert.equal(parsed.duration, "ONE_MONTH");
    assert.deepEqual(parsed.priceIds, ["price1"]);
  });

  it("rejects unknown durations and empty price lists", () => {
    const tools = captureTools();
    const create = tools.get("create_app_subscription_retention_offer")!;
    const schema = z.object(create.config.inputSchema);
    const base = {
      subscriptionId: "sub1",
      referenceName: "Save offer",
      offerId: "save_offer",
      duration: "ONE_MONTH",
      offerMode: "PAY_AS_YOU_GO",
      periodCount: 1,
      customerEligibilityPaidSubscriptionDurationInMonths: 1,
      priceIds: ["price1"],
    };

    assert.throws(() => schema.parse({ ...base, duration: "ONE_DAY" }));
    assert.throws(() => schema.parse({ ...base, priceIds: [] }));
  });

  it("accepts null-cleared eligibility on update", () => {
    const tools = captureTools();
    const update = tools.get("update_app_subscription_retention_offer")!;

    assert.ok(update, "update tool is registered");
    const parsed = z.object(update.config.inputSchema).parse({
      offerId: "o1",
      customerEligibilityPaidSubscriptionDurationInMonths: 3,
      customerEligibilityWaitBetweenOffersInMonths: null,
    }) as any;

    assert.equal(parsed.customerEligibilityWaitBetweenOffersInMonths, null);
  });
});
