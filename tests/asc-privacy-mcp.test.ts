import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscPrivacyTools } from "../src/web/mcp/tools/asc-privacy-tools";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscPrivacyTools(server, "user1");

  return tools;
}

describe("privacy MCP tools", () => {
  it("registers list, catalogs, create and delete tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      [
        "create_app_data_usage",
        "delete_app_data_usage",
        "get_privacy_catalogs",
        "list_app_data_usages",
      ].sort(),
    );
  });

  it("accepts a create payload", () => {
    const tools = captureTools();
    const create = tools.get("create_app_data_usage")!;

    assert.ok(create, "create tool is registered");
    const parsed = z.object(create.config.inputSchema).parse({
      bundleId: "com.example.myapp",
      categoryId: "USER_ID",
      purposeId: "ANALYTICS",
      dataProtectionId: "DATA_NOT_LINKED_TO_YOU",
    }) as any;

    assert.equal(parsed.categoryId, "USER_ID");
  });
});
