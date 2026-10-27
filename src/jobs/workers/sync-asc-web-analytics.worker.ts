import type { Job } from "pg-boss";
import { logger } from "../../config";
import { syncWebCampaignMetrics, WebSessionExpiredError } from "../../services/asc-web-analytics";

export const QUEUE_NAME = "sync-asc-web-analytics";

export async function handler([job]: Job<Record<string, never>>[]): Promise<void> {
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${job.id}…`);
  try {
    const { tokens, rows } = await syncWebCampaignMetrics();

    logger.info(`[BOSS] "${QUEUE_NAME}" job ${job.id} completed: ${tokens} tokens, ${rows} rows`);
  } catch (err) {
    if (err instanceof WebSessionExpiredError) {
      logger.warn(`[BOSS] "${QUEUE_NAME}" skipped — ASC web session expired, refresh ASC_ANALYTICS_COOKIES`);

      return;
    }

    throw err;
  }
}
