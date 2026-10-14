import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGoogleAdsCampaignTools } from "./google-ads-tools-campaigns";
import { registerGoogleAdsAdGroupTools } from "./google-ads-tools-adgroups";
import { registerGoogleAdsAppleMappingTools } from "./google-ads-tools-apple-mapping";

export function registerGoogleAdsTools(server: McpServer, userId: string) {
  registerGoogleAdsCampaignTools(server, userId);
  registerGoogleAdsAdGroupTools(server, userId);
  registerGoogleAdsAppleMappingTools(server, userId);
}
