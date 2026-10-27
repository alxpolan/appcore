import { prisma, logger } from "../config";
import { AsoExperimentStatus } from "@prisma/client";
import { ASOMemory } from "./memory";

export class ASOEvaluator {
  private memory: ASOMemory;
  private static readonly MATURITY_DAYS = 21;

  constructor(memory?: ASOMemory) {
    this.memory = memory ?? new ASOMemory();
  }

  async evaluatePendingExperiments(appId: string) {
    const cutoff = new Date();

    cutoff.setDate(cutoff.getDate() - ASOEvaluator.MATURITY_DAYS);

    const experiments = await prisma.asoExperiment.findMany({
      where: {
        appId,
        status: AsoExperimentStatus.DEPLOYED,
        deployedAt: { lte: cutoff },
      },
      include: { app: true },
    });

    if (experiments.length === 0) {
      logger.info(
        `[ASOEvaluator] No mature deployed experiments for app ${appId}`,
      );
      return [];
    }

    logger.info(
      `[ASOEvaluator] Evaluating ${experiments.length} mature experiments for app ${appId}`,
    );

    const results: {
      experimentId: string;
      success: boolean;
      rankBefore: number | null;
      rankAfter: number | null;
      impressionsDelta: number | null;
    }[] = [];

    for (const exp of experiments) {
      try {
        const evaluation = await this.evaluateSingle(exp);

        results.push(evaluation);
      } catch (err) {
        logger.error(
          `[ASOEvaluator] Failed to evaluate experiment ${exp.id}: ${(err as Error).message}`,
        );
      }
    }

    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).length;

    logger.info(
      `[ASOEvaluator] Evaluation complete for app ${appId}: ${successes} successes, ${failures} failures`,
    );

    return results;
  }

  private async evaluateSingle(
    exp: Awaited<ReturnType<typeof prisma.asoExperiment.findFirst>> & {
      app: { id: string };
    },
  ) {
    if (!exp) throw new Error("Experiment is null");

    const keywordTerm = exp.toValue ?? exp.fromValue;
    const experimentId = exp.id;

    let rankBefore = exp.rankBefore;
    let rankAfter: number | null = null;
    let impressionsDelta: number | null = null;

    if (keywordTerm) {
      const keyword = await prisma.keyword.findFirst({
        where: { term: { equals: keywordTerm, mode: "insensitive" } },
      });

      if (keyword) {
        if (rankBefore == null && exp.deployedAt) {
          const beforeRanking = await prisma.keywordRanking.findFirst({
            where: {
              keywordId: keyword.id,
              appId: exp.appId,
              trackedAt: { lte: exp.deployedAt },
            },
            orderBy: { trackedAt: "desc" },
          });

          rankBefore = beforeRanking?.rank ?? null;
        }

        const afterRanking = await prisma.keywordRanking.findFirst({
          where: {
            keywordId: keyword.id,
            appId: exp.appId,
          },
          orderBy: { trackedAt: "desc" },
        });

        rankAfter = afterRanking?.rank ?? null;
      }
    }

    if (exp.deployedAt) {
      const app = await prisma.app.findUnique({ where: { id: exp.appId } });

      if (app) {
        const beforeImpressions = await prisma.appStoreAnalytics.aggregate({
          where: {
            bundleId: app.bundleId,
            reportDate: {
              gte: new Date(exp.deployedAt.getTime() - 21 * 86400000),
              lt: exp.deployedAt,
            },
          },
          _avg: { impressions: true },
        });

        const afterImpressions = await prisma.appStoreAnalytics.aggregate({
          where: {
            bundleId: app.bundleId,
            reportDate: { gte: exp.deployedAt },
          },
          _avg: { impressions: true },
        });

        const avgBefore = beforeImpressions._avg.impressions ?? 0;
        const avgAfter = afterImpressions._avg.impressions ?? 0;

        impressionsDelta = Math.round(avgAfter - avgBefore);
      }
    }

    const success =
      rankBefore != null && rankAfter != null ? rankAfter < rankBefore : false;

    await this.memory.updateOutcome(experimentId, {
      rankBefore: rankBefore ?? undefined,
      rankAfter: rankAfter ?? undefined,
      impressionsDelta: impressionsDelta ?? undefined,
    });

    const icon = success ? "✓ SUCCESS" : "✗ FAILED";

    logger.info(
      `[ASOEvaluator] ${icon} Experiment ${experimentId} (${exp.type}): ` +
        `rank ${rankBefore ?? "?"} → ${rankAfter ?? "?"}, impressions Δ${impressionsDelta ?? "?"}`,
    );

    return { experimentId, success, rankBefore, rankAfter, impressionsDelta };
  }
}
