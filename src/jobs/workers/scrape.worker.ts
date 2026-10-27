import type { Job } from "pg-boss";
import { logger } from "../../config";
import { AppStoreScraper } from "../../services/appstore-scraper.js";

export const QUEUE_NAME = "scrape";

export interface ScrapeData {
  bundleId: string;
  country: string;
}

export async function handler([job]: Job<ScrapeData>[]): Promise<void> {
  const { data: { bundleId, country }, id } = job;

  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for app ${bundleId}…`);

  await new AppStoreScraper(country, undefined, bundleId).scrapeAndSaveApp(bundleId, true);
  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
