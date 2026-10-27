import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppCatalogTools } from "./app-tools-catalog";
import { registerAppCompetitorsTools } from "./app-tools-competitors";
import { registerAppInsightsTools } from "./app-tools-insights";

export function registerAppTools(server: McpServer, userId: string) {
  registerAppCatalogTools(server, userId);
  registerAppCompetitorsTools(server, userId);
  registerAppInsightsTools(server, userId);
}
