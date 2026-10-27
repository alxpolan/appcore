import type { Job } from "pg-boss";
import { logger, getEffectiveSettingsForTeam } from "../../config";
import { AIAnalyzer } from "../../services/ai-analyzer";
import { KeywordTracker } from "../../services/keyword-tracker";

export const QUEUE_NAME = "extract-keywords";

export interface ExtractKeywordsData {
  teamId: string;
  bundleId: string;
  country: string;
}

export async function handler([job]: Job<ExtractKeywordsData>[]): Promise<void> {
  const { data: { teamId, bundleId, country }, id } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for ${bundleId}…`);

  const settings = await getEffectiveSettingsForTeam(teamId);
  const keywords = await new AIAnalyzer(bundleId).extractKeywordsFromCompetitors();

  if (keywords.length > 0) {
    const terms = keywords.map((k) => k.keyword);

    await new KeywordTracker(bundleId, country, settings).addKeywords(terms);
    logger.info(`[BOSS] Extracted and added ${terms.length} keywords for ${bundleId}`);
  } else {
    logger.info(`[BOSS] No new competitor keywords found for ${bundleId}`);
  }

  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
