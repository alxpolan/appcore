import type { Job } from "pg-boss";
import { logger } from "../../config";
import { AIAnalyzer } from "../../services/ai-analyzer";

export const QUEUE_NAME = "analyze";

export interface AnalyzeData {
  teamId: string;
  bundleId: string;
}

export async function handler([job]: Job<AnalyzeData>[]): Promise<void> {
  const { data: { teamId, bundleId }, id } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for ${bundleId}…`);

  const results = await new AIAnalyzer(bundleId).analyzeAndSuggest();
  let totalSuggestions = 0;

  for (const [locale, analysis] of results) {
    const count =
      analysis.titleSuggestions.length +
      analysis.subtitleSuggestions.length +
      analysis.keywordSuggestions.length +
      analysis.descriptionSuggestions.length;

    totalSuggestions += count;
    logger.info(`[BOSS] ${bundleId} ${locale}: ${count} suggestions`);
  }

  logger.info(`[BOSS] AI analysis for ${bundleId} complete: ${totalSuggestions} suggestions`);
  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
