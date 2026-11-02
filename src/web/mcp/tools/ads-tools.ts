import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppleAdsCampaignTools } from "./ads-tools-campaigns";
import { registerAppleAdsAdGroupTools } from "./ads-tools-adgroups";
import { registerAppleAdsGroupTools } from "./ads-tools-groups";
import { registerAppleAdsCppTools } from "./ads-tools-cpp";

export function registerAdsTools(server: McpServer, userId: string) {
  registerAppleAdsCampaignTools(server, userId);
  registerAppleAdsAdGroupTools(server, userId);
  registerAppleAdsGroupTools(server, userId);
  registerAppleAdsCppTools(server, userId);
}
