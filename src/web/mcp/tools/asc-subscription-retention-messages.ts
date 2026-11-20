import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionRetentionMessageAssignmentTools } from "./asc-subscription-retention-messages-assignment";
import { registerAscSubscriptionRetentionMessageCoreTools } from "./asc-subscription-retention-messages-core";

export function registerAscSubscriptionRetentionMessageTools(server: McpServer, userId: string) {
  registerAscSubscriptionRetentionMessageCoreTools(server, userId);
  registerAscSubscriptionRetentionMessageAssignmentTools(server, userId);
}
