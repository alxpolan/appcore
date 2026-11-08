import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdsTools } from "./tools/ads-tools";
import { registerGoogleAdsTools } from "./tools/google-ads-tools";
import { registerAppTools } from "./tools/app-tools";
import { registerAscTools } from "./tools/asc-tools";
import { registerAscSubscriptionTools } from "./tools/asc-subscription-tools";
import { registerAscAgeRatingTools } from "./tools/asc-age-rating-tools";
import { registerAscReviewAnswersTools } from "./tools/asc-review-answers-tools";
import { registerAscReviewAttachmentTools } from "./tools/asc-review-attachments-tools";
import { registerAscPrivacyTools } from "./tools/asc-privacy-tools";
import { registerAscProductTools } from "./tools/asc-product-tools";
import { registerAscGameCenterTools } from "./tools/asc-gamecenter-tools";
import { registerSuggestionTools } from "./tools/suggestion-tools";
import { registerScreenshotStudioTools } from "./tools/screenshot-studio-tools";
import { registerCppTools } from "./tools/cpp-tools";

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "Marteso",
    version: "1.0.0",
  });

  registerAdsTools(server, userId);
  registerGoogleAdsTools(server, userId);
  registerAppTools(server, userId);
  registerAscTools(server, userId);
  registerAscSubscriptionTools(server, userId);
  registerAscAgeRatingTools(server, userId);
  registerAscReviewAnswersTools(server, userId);
  registerAscReviewAttachmentTools(server, userId);
  registerAscPrivacyTools(server, userId);
  registerAscProductTools(server, userId);
  registerAscGameCenterTools(server, userId);
  registerSuggestionTools(server, userId);
  registerScreenshotStudioTools(server, userId);
  registerCppTools(server, userId);

  return server;
}
