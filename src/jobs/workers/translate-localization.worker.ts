import type { Job } from "pg-boss";
import { logger } from "../../config";
import { prisma } from "../../config/database";
import { ascClientForTeam } from "../../services/asc-client";
import { AIAnalyzer } from "../../services/ai-analyzer";
import * as tracker from "../translation-tracker";

export const QUEUE_NAME = "translate-localization";

export interface TranslateLocalizationData {
  teamId: string;
  bundleId: string;
  versionId: string;
  sourceLocale: string;
  targetLocale: string;
  appInfoLocalizationId?: string | null;
  versionLocalizationId?: string | null;
  sourceFields: Partial<
    Record<"name" | "subtitle" | "keywords" | "description" | "promotionalText" | "whatsNew", string>
  >;
  extraFields?: Partial<Record<"privacyPolicyUrl" | "supportUrl" | "marketingUrl", string>>;
}

const APP_INFO_FIELDS = new Set(["name", "subtitle", "privacyPolicyUrl"]);

export async function handler([job]: Job<TranslateLocalizationData>[]): Promise<void> {
  const {
    data: {
      teamId,
      bundleId,
      versionId,
      sourceLocale,
      targetLocale,
      appInfoLocalizationId,
      versionLocalizationId,
      sourceFields,
      extraFields,
    },
    id,
  } = job;

  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${id} — ${bundleId} ${sourceLocale} → ${targetLocale}`);
  tracker.add(versionId, targetLocale);

  try {
    const asc = await ascClientForTeam(teamId);
    if (!asc) {
      logger.warn(`[BOSS] ASC credentials missing for team ${teamId}, aborting translation`);
      return;
    }

    const translated = await new AIAnalyzer(bundleId).translateLocalization(sourceLocale, targetLocale, sourceFields);
    const appInfoUpdates: Record<string, string> = {};
    const versionUpdates: Record<string, string> = {};

    for (const [field, value] of Object.entries({ ...translated, ...(extraFields ?? {}) })) {
      const trimmed = value?.trim();
      if (!trimmed) continue;
      (APP_INFO_FIELDS.has(field) ? appInfoUpdates : versionUpdates)[field] = trimmed;
    }

    const persistedUpdates: Record<string, string> = {};
    if (appInfoLocalizationId && Object.keys(appInfoUpdates).length > 0) {
      await asc.updateAppInfoLocalization(appInfoLocalizationId, appInfoUpdates);
      Object.assign(persistedUpdates, appInfoUpdates);
    }
    if (versionLocalizationId && Object.keys(versionUpdates).length > 0) {
      await asc.updateVersionLocalization(versionLocalizationId, versionUpdates);
      Object.assign(persistedUpdates, versionUpdates);
    }

    if (Object.keys(persistedUpdates).length > 0) {
      await prisma.appStoreVersionLocalization.upsert({
        where: { versionId_locale: { versionId, locale: targetLocale } },
        create: {
          versionId,
          locale: targetLocale,
          appInfoLocalizationId: appInfoLocalizationId ?? null,
          versionLocalizationId: versionLocalizationId ?? null,
          ...persistedUpdates,
        },
        update: {
          appInfoLocalizationId: appInfoLocalizationId ?? null,
          versionLocalizationId: versionLocalizationId ?? null,
          ...persistedUpdates,
        },
      });
    }

    await prisma.appStoreVersion.update({
      where: { id: versionId },
      data: { syncedAt: new Date(0) },
    });

    logger.info(`[BOSS] "${QUEUE_NAME}" job ${id} completed (${targetLocale})`);
  } finally {
    tracker.remove(versionId, targetLocale);
  }
}
