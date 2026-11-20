import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionRetentionMessageTools } from "../src/web/mcp/tools/asc-subscription-retention-messages";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscSubscriptionRetentionMessageTools(server, "user1");

  return tools;
}

describe("retention message MCP tools", () => {
  it("registers the full message/version/localization/image/assignment tool set", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      [
        "add_app_subscription_retention_message_offers",
        "assign_app_subscription_retention_message",
        "create_app_subscription_retention_message",
        "create_app_subscription_retention_message_localization",
        "create_app_subscription_retention_message_version",
        "delete_app_subscription_retention_message",
        "delete_app_subscription_retention_message_localization",
        "get_app_subscription_retention_message",
        "list_app_subscription_retention_message_localizations",
        "list_app_subscription_retention_message_offers",
        "list_app_subscription_retention_message_versions",
        "list_app_subscription_retention_messages",
        "remove_app_subscription_retention_message_offers",
        "update_app_subscription_retention_message_localization",
        "upload_app_subscription_retention_message_image",
      ].sort(),
    );
  });

  it("enforces header and body length limits on localization creation", () => {
    const tools = captureTools();
    const create = tools.get("create_app_subscription_retention_message_localization")!;
    const schema = z.object(create.config.inputSchema);

    const parsed = schema.parse({
      retentionMessageVersionId: "v1",
      locale: "en-US",
      header: "Wait, don't go!",
    }) as any;

    assert.equal(parsed.locale, "en-US");
    assert.throws(() =>
      schema.parse({ retentionMessageVersionId: "v1", locale: "en-US", header: "x".repeat(67) }),
    );
    assert.throws(() =>
      schema.parse({ retentionMessageVersionId: "v1", locale: "en-US", body: "x".repeat(145) }),
    );
  });

  it("accepts a null header/body on localization update to clear it", () => {
    const tools = captureTools();
    const update = tools.get("update_app_subscription_retention_message_localization")!;
    const schema = z.object(update.config.inputSchema);

    const parsed = schema.parse({ localizationId: "loc1", header: null }) as any;

    assert.equal(parsed.header, null);
  });

  it("requires at least one offer id when linking or unlinking retention offers", () => {
    const tools = captureTools();
    const add = tools.get("add_app_subscription_retention_message_offers")!;
    const schema = z.object(add.config.inputSchema);

    assert.throws(() => schema.parse({ subscriptionId: "sub1", offerIds: [] }));

    const parsed = schema.parse({ subscriptionId: "sub1", offerIds: ["offer1"] }) as any;

    assert.deepEqual(parsed.offerIds, ["offer1"]);
  });

  it("allows assigning or clearing a subscription's retention message", () => {
    const tools = captureTools();
    const assign = tools.get("assign_app_subscription_retention_message")!;
    const schema = z.object(assign.config.inputSchema);

    const assigned = schema.parse({ subscriptionId: "sub1", retentionMessageId: "msg1" }) as any;
    const cleared = schema.parse({ subscriptionId: "sub1" }) as any;

    assert.equal(assigned.retentionMessageId, "msg1");
    assert.equal(cleared.retentionMessageId, undefined);
  });
});
