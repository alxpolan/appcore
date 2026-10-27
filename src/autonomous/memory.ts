import { prisma, logger } from "../config";
import { AsoExperimentStatus, AsoExperimentType } from "@prisma/client";

const TYPE_MAP: Record<string, AsoExperimentType> = {
  keyword_add: AsoExperimentType.KEYWORD_ADD,
  keyword_remove: AsoExperimentType.KEYWORD_REMOVE,
  keyword_replace: AsoExperimentType.KEYWORD_REPLACE,
  title_change: AsoExperimentType.TITLE_CHANGE,
  subtitle_change: AsoExperimentType.SUBTITLE_CHANGE,
};

export function resolveExperimentType(raw: string): AsoExperimentType {
  const mapped = TYPE_MAP[raw.toLowerCase()];
  if (!mapped) throw new Error(`Unknown experiment type: ${raw}`);
  return mapped;
}

export interface SaveExperimentInput {
  appId: string;
  type: string;
  fromValue?: string;
  toValue?: string;
  reason?: string;
  confidence: number;
}

export interface UpdateOutcomeInput {
  rankBefore?: number;
  rankAfter?: number;
  impressionsDelta?: number;
}

export class ASOMemory {
  async getHistory(appId: string, days = 90) {
    const since = new Date();

    since.setDate(since.getDate() - days);

    const experiments = await prisma.asoExperiment.findMany({
      where: {
        appId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });

    logger.info(
      `[ASOMemory] Loaded ${experiments.length} experiments for app ${appId} (last ${days} days)`,
    );

    return experiments;
  }

  async saveExperiment(input: SaveExperimentInput) {
    const experiment = await prisma.asoExperiment.create({
      data: {
        appId: input.appId,
        type: resolveExperimentType(input.type),
        fromValue: input.fromValue ?? null,
        toValue: input.toValue ?? null,
        reason: input.reason ?? null,
        confidence: input.confidence,
        status: AsoExperimentStatus.PENDING,
      },
    });

    logger.info(
      `[ASOMemory] Saved experiment ${experiment.id}: ${experiment.type} ` +
        `"${experiment.fromValue}" → "${experiment.toValue}" (confidence: ${experiment.confidence})`,
    );

    return experiment;
  }

  async updateOutcome(experimentId: string, outcome: UpdateOutcomeInput) {
    const updated = await prisma.asoExperiment.update({
      where: { id: experimentId },
      data: {
        rankBefore: outcome.rankBefore,
        rankAfter: outcome.rankAfter,
        impressionsDelta: outcome.impressionsDelta,
        status: AsoExperimentStatus.EVALUATED,
        evaluatedAt: new Date(),
      },
    });

    logger.info(
      `[ASOMemory] Updated outcome for experiment ${experimentId}: ` +
        `rank ${outcome.rankBefore} → ${outcome.rankAfter}, impressions Δ${outcome.impressionsDelta}`,
    );

    return updated;
  }
}
