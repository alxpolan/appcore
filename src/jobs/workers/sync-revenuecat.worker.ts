import type { Job } from "pg-boss";
import { logger, prisma } from "../../config";
import { decryptNullable } from "../../config/encryption";
import { syncRevenueCatTransactions } from "../../services/revenuecat";

export const QUEUE_NAME = "sync-revenuecat";

export interface SyncRevenueCatData {
  bundleId: string;
}

export async function handler([job]: Job<SyncRevenueCatData>[]): Promise<void> {
  const { data: { bundleId }, id } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for app ${bundleId}…`);

  const app = await prisma.app.findUnique({ where: { bundleId } });
  if (!app?.revenueCatConnectedAt || !app.revenueCatProjectId || !app.revenueCatApiKey) {
    logger.warn(`[BOSS] RevenueCat not connected for app ${bundleId} — skipping`);
    return;
  }

  const result = await syncRevenueCatTransactions(
    decryptNullable(app.revenueCatApiKey)!,
    app.revenueCatProjectId,
    bundleId,
  );
  logger.info(
    `[BOSS] "${QUEUE_NAME}" job ${id} completed — ${result.customers} customers, ${result.events} revenue events`,
  );
}
