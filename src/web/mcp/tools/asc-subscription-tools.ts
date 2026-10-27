import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAscSubscriptionGroupTools } from "./asc-subscription-groups";
import { registerAscSubscriptionsTools } from "./asc-subscription-subscriptions";
import { registerAscSubscriptionPriceTools } from "./asc-subscription-prices";

export function registerAscSubscriptionTools(server: McpServer, userId: string) {
  registerAscSubscriptionGroupTools(server, userId);
  registerAscSubscriptionsTools(server, userId);
  registerAscSubscriptionPriceTools(server, userId);
}
