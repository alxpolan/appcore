import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppleAdsCampaignTools } from "./ads-tools-campaigns";
import { registerAppleAdsAdGroupTools } from "./ads-tools-adgroups";
import { registerAppleAdsGroupTools } from "./ads-tools-groups";

export function registerAdsTools(server: McpServer, userId: string) {
  registerAppleAdsCampaignTools(server, userId);
  registerAppleAdsAdGroupTools(server, userId);
  registerAppleAdsGroupTools(server, userId);
}
