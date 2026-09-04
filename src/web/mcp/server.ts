import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTools } from "./tools/app-tools";
import { registerAscTools } from "./tools/asc-tools";
import { registerAscSubscriptionTools } from "./tools/asc-subscription-tools";
import { registerAscProductTools } from "./tools/asc-product-tools";
import { registerAscGameCenterTools } from "./tools/asc-gamecenter-tools";
import { registerSuggestionTools } from "./tools/suggestion-tools";

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "Marteso",
    version: "1.0.0",
  });

  registerAppTools(server, userId);
  registerAscTools(server, userId);
  registerAscSubscriptionTools(server, userId);
  registerAscProductTools(server, userId);
  registerAscGameCenterTools(server, userId);
  registerSuggestionTools(server, userId);

  return server;
}
