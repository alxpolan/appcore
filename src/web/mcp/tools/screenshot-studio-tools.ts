import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScreenshotStudioReadTools } from "./screenshot-studio-tools-reads";
import { registerScreenshotStudioEditTools } from "./screenshot-studio-tools-edit";

export function registerScreenshotStudioTools(server: McpServer, userId: string) {
  registerScreenshotStudioReadTools(server, userId);
  registerScreenshotStudioEditTools(server, userId);
}
