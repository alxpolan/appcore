import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscReviewAttachmentTools } from "../src/web/mcp/tools/asc-review-attachments-tools";

function captureTools() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
  } as unknown as McpServer;

  registerAscReviewAttachmentTools(server, "user1");

  return tools;
}

describe("review attachment MCP tools", () => {
  it("registers list, upload and delete tools", () => {
    const tools = captureTools();

    assert.deepEqual(
      [...tools.keys()].sort(),
      ["delete_app_review_attachment", "list_app_review_attachments", "upload_app_review_attachment"].sort(),
    );
  });

  it("accepts an upload payload with a file URL", () => {
    const tools = captureTools();
    const upload = tools.get("upload_app_review_attachment")!;

    assert.ok(upload, "upload tool is registered");
    const parsed = z.object(upload.config.inputSchema).parse({
      bundleId: "com.example.myapp",
      fileUrl: "https://example.com/screen-recording.mp4",
    }) as any;

    assert.equal(parsed.fileUrl, "https://example.com/screen-recording.mp4");
    assert.equal(parsed.fileDataUrl, undefined);
  });
});
