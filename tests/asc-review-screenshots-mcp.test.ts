import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionReviewTools } from "../src/web/mcp/tools/asc-subscription-review";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscSubscriptionReviewTools(server, "user1");

  return tools;
}

describe("subscription review MCP tools", () => {
  it("registers get, update-note, upload and delete tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      [
        "delete_app_subscription_review_screenshot",
        "get_app_subscription_review",
        "update_app_subscription_review_note",
        "upload_app_subscription_review_screenshot",
      ].sort(),
    );
  });

  it("accepts an upload payload with an image URL", () => {
    const tools = captureTools();
    const upload = tools.get("upload_app_subscription_review_screenshot")!;

    assert.ok(upload, "upload tool is registered");
    const parsed = z.object(upload.config.inputSchema).parse({
      subscriptionId: "sub1",
      imageUrl: "https://example.com/review.png",
    }) as any;

    assert.equal(parsed.imageUrl, "https://example.com/review.png");
    assert.equal(parsed.imageDataUrl, undefined);
  });

  it("accepts an update-note payload", () => {
    const tools = captureTools();
    const update = tools.get("update_app_subscription_review_note")!;

    assert.ok(update, "update tool is registered");
    const parsed = z.object(update.config.inputSchema).parse({
      subscriptionId: "sub1",
      reviewNote: "Test account: user@example.com / secret",
    }) as any;

    assert.equal(parsed.subscriptionId, "sub1");
  });
});
