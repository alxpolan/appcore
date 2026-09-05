import type { Job } from "pg-boss";
import { logger } from "../../config";
import { CompetitorIntelService } from "../../services/competitor-intel";

export const QUEUE_NAME = "competitor-intel";

export interface CompetitorIntelData {
  teamId: string;
  bundleId: string;
  competitorAppIds?: string[];
}

export async function handler([job]: Job<CompetitorIntelData>[]): Promise<void> {
  const {
    data: { bundleId, competitorAppIds },
    id,
  } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for ${bundleId}…`);

  const result = await new CompetitorIntelService().runFullIntelJob(bundleId, competitorAppIds);

  logger.info(`[BOSS] Competitor intel for ${bundleId} complete`, result);
  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
