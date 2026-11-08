import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscReviewAnswersTools } from "../src/web/mcp/tools/asc-review-answers-tools";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscReviewAnswersTools(server, "user1");

  return tools;
}

describe("review answers MCP tools", () => {
  it("registers get, update and attach tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      ["attach_app_review_answers", "get_app_review_answers", "update_app_review_answers"].sort(),
    );
  });

  it("accepts an update payload", () => {
    const tools = captureTools();
    const update = tools.get("update_app_review_answers")!;

    assert.ok(update, "update tool is registered");
    const parsed = z.object(update.config.inputSchema).parse({
      bundleId: "com.example.myapp",
      answers: { siriShortcuts: "No", devicesTested: "iPhone 16, iOS 26" },
    }) as any;

    assert.equal(parsed.answers.siriShortcuts, "No");
  });
});
