import type { Job } from "pg-boss";
import { logger } from "../../config";
import { prisma } from "../../config/database";
import { ascClientForTeam } from "../../services/asc-client";

export const QUEUE_NAME = "sync-metadata";

export interface SyncMetadataData {
  teamId: string;
  bundleId: string;
}

export async function handler([job]: Job<SyncMetadataData>[]): Promise<void> {
  const {
    data: { teamId, bundleId },
    id,
  } = job;
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} for ${bundleId}…`);

  const asc = await ascClientForTeam(teamId);
  if (!asc) {
    logger.warn(`[BOSS] ASC credentials not configured for team ${teamId}, skipping`);
    return;
  }

  const ascApp = await asc.getApp(bundleId).catch(() => null);
  const availableLocalizations = ascApp ? await asc.getAppInfoLocalizations(ascApp.id).catch(() => []) : [];
  const locales =
    availableLocalizations.length > 0
      ? availableLocalizations.map((l: any) => l.attributes?.locale ?? l.locale).filter(Boolean)
      : ["en-US"];

  const primaryState = await asc.getCurrentASOState(locales[0], bundleId);
  if (primaryState) {
    await prisma.app.update({
      where: { bundleId },
      data: {
        currentTitle: primaryState.title,
        currentSubtitle: primaryState.subtitle,
        currentKeywords: primaryState.keywords,
        currentDescription: primaryState.description,
      },
    });
    logger.info(`[BOSS] Metadata synced for ${bundleId} (${locales[0]})`);
  }

  logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed`);
}
