import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscAgeRatingTools } from "../src/web/mcp/tools/asc-age-rating-tools";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscAgeRatingTools(server, "user1");

  return tools;
}

describe("age rating MCP tools", () => {
  it("registers get and update tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      ["get_app_age_rating", "update_app_age_rating"].sort(),
    );
  });

  it("accepts an update payload with mixed field kinds", () => {
    const tools = captureTools();
    const update = tools.get("update_app_age_rating")!;

    assert.ok(update, "update tool is registered");
    const parsed = z.object(update.config.inputSchema).parse({
      bundleId: "com.example.myapp",
      attributes: { gambling: true, contests: "NONE", kidsAgeBand: null },
    }) as any;

    assert.equal(parsed.attributes.gambling, true);
    assert.equal(parsed.attributes.kidsAgeBand, null);
  });

  it("rejects non-record attributes", () => {
    const tools = captureTools();
    const update = tools.get("update_app_age_rating")!;
    const schema = z.object(update.config.inputSchema);

    assert.throws(() => schema.parse({ bundleId: "com.example.myapp", attributes: "gambling" }));
  });
});
