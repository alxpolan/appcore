import { z } from "zod/v3";
import { logger, prisma } from "../../../config";
import { decryptNullable } from "../../../config/encryption";
import { getMcpUserTeamId, textResult } from "./shared";
import { googleAdsErrorMessage, type GoogleAdsCredentials } from "../../../services/google-ads";

export const rangeSchema = {
  days: z
    .number()
    .int()
    .min(1)
    .max(730)
    .optional()
    .describe("Evaluate the last N days (e.g. 7, 30). Defaults to 30 when no range is given."),
  startDate: z
    .string()
    .optional()
    .describe("Explicit range start, YYYY-MM-DD. Overrides days."),
  endDate: z.string().optional().describe("Explicit range end, YYYY-MM-DD. Defaults to today."),
};

export const googleNegativeKeywordSchema = z.object({
  text: z.string().describe("Negative keyword text, e.g. 'free'."),
  matchType: z
    .enum(["EXACT", "PHRASE", "BROAD"])
    .describe("EXACT blocks the precise term, PHRASE blocks the phrase, BROAD blocks close variants."),
});

export const googleTargetingKeywordSchema = z.object({
  text: z.string().describe("Keyword text, e.g. 'habit tracker app'."),
  matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).describe("EXACT for precise matches, PHRASE for phrases, BROAD for discovery."),
  bidAmount: z
    .number()
    .positive()
    .optional()
    .describe("Keyword-level max CPC bid. Falls back to the ad group default bid when omitted."),
});

export interface GoogleAdsMcpContext {
  teamId: string;
  creds: GoogleAdsCredentials;
}

export async function getGoogleAdsContext(userId: string): Promise<GoogleAdsMcpContext | { error: string }> {
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return { error: "No team found for this user." };
  const settings = await prisma.teamSettings.findUnique({ where: { teamId } });
  if (
    !settings?.googleAdsConnectedAt ||
    !settings.googleAdsClientId ||
    !settings.googleAdsClientSecret ||
    !settings.googleAdsRefreshToken ||
    !settings.googleAdsCustomerId
  ) {
    return { error: "Google Ads is not connected. Connect it in Marteso Integrations first." };
  }

  const clientSecret = decryptNullable(settings.googleAdsClientSecret);
  const refreshToken = decryptNullable(settings.googleAdsRefreshToken);

  if (!clientSecret || !refreshToken) {
    return { error: "Google Ads credentials are unreadable. Reconnect them in Marteso Integrations." };
  }

  return {
    teamId,
    creds: {
      customerId: settings.googleAdsCustomerId,
      clientId: settings.googleAdsClientId,
      clientSecret,
      refreshToken,
    },
  };
}

export function googleAdsError(tool: string, err: unknown) {
  const message = googleAdsErrorMessage(err, "request");
  logger.error(`[mcp] ${tool} error`, { err: message });

  return textResult(message);
}
