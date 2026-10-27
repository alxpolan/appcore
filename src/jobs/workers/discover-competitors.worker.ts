import type { Job } from "pg-boss";
import { logger, prisma } from "../../config";
import { AppStoreScraper } from "../../services/appstore-scraper";

export const QUEUE_NAME = "discover-competitors";

export interface DiscoverCompetitorsData {
  bundleId: string;
  country: string;
}

export async function handler([job]: Job<DiscoverCompetitorsData>[]): Promise<void> {
  const { data: { bundleId, country }, id } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for ${bundleId}…`);

  const keywords = await prisma.keyword.findMany({
    orderBy: { popularity: "desc" },
    take: 5,
  });

  if (keywords.length === 0) {
    logger.info(`[BOSS] No keywords available for competitor discovery (${bundleId})`);

    return;
  }

  const searchTerms = keywords.map((k) => k.term);
  const ids = await new AppStoreScraper(country, undefined, bundleId).discoverCompetitors(searchTerms, bundleId, 4);

  logger.info(
    `[BOSS] Competitor discovery for ${bundleId} complete: ${ids.length} new competitors found`,
  );

  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
