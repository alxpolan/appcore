import cron from "node-cron";
import { prisma, logger } from "../config";
import { AsoExperimentStatus } from "@prisma/client";
import { expireStaleAdminGrants } from "../services/pro-grants";
import { ASOBrain } from "./brain";
import { ASOEvaluator } from "./evaluator";
import { ASOMemory } from "./memory";

const memory = new ASOMemory();
const brain = new ASOBrain(memory);
const evaluator = new ASOEvaluator(memory);

async function getSystemUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });

  if (!admin) {
    throw new Error(
      "[ASOScheduler] No admin user found. Cannot run autonomous analysis without user context.",
    );
  }
  return admin.id;
}

async function getActiveApps() {
  return prisma.app.findMany({
    where: { isOwnApp: true },
    select: { id: true, name: true, bundleId: true },
  });
}

export function initScheduler() {
  cron.schedule("0 3 * * *", async () => {
    logger.info("[ASOScheduler] ⏰ Starting daily AI analysis run (03:00)");
    try {
      const userId = await getSystemUserId();
      const apps = await getActiveApps();

      logger.info(`[ASOScheduler] Processing ${apps.length} active apps`);

      for (const app of apps) {
        try {
          logger.info(
            `[ASOScheduler] Analyzing app "${app.name}" (${app.bundleId})`,
          );
          const experiments = await brain.analyze(app.id, userId);

          logger.info(
            `[ASOScheduler] App "${app.name}": ${experiments.length} new experiments created`,
          );
        } catch (err) {
          logger.error(
            `[ASOScheduler] Failed to analyze app "${app.name}" (${app.id}): ${(err as Error).message}`,
          );
        }
      }

      logger.info("[ASOScheduler] ✅ Daily analysis run complete");
    } catch (err) {
      logger.error(
        `[ASOScheduler] Critical error in daily analysis: ${(err as Error).message}`,
      );
    }
  });

  cron.schedule("0 4 * * *", async () => {
    logger.info(
      "[ASOScheduler] ⏰ Starting daily experiment evaluation (04:00)",
    );
    try {
      const apps = await getActiveApps();

      for (const app of apps) {
        try {
          logger.info(
            `[ASOScheduler] Evaluating experiments for "${app.name}"`,
          );
          const results = await evaluator.evaluatePendingExperiments(app.id);
          const successes = results.filter((r) => r.success).length;

          logger.info(
            `[ASOScheduler] App "${app.name}": ${results.length} evaluated, ${successes} successful`,
          );
        } catch (err) {
          logger.error(
            `[ASOScheduler] Failed to evaluate app "${app.name}" (${app.id}): ${(err as Error).message}`,
          );
        }
      }

      logger.info("[ASOScheduler] ✅ Daily evaluation run complete");
    } catch (err) {
      logger.error(
        `[ASOScheduler] Critical error in daily evaluation: ${(err as Error).message}`,
      );
    }
  });

  cron.schedule("0 6 * * 1", async () => {
    logger.info(
      "[ASOScheduler] ⏰ Generating weekly ASO report (Monday 06:00)",
    );
    try {
      const apps = await getActiveApps();

      for (const app of apps) {
        try {
          const report = await generateWeeklyReport(app.id);

          logger.info(
            `[ASOScheduler] Weekly Report for "${app.name}":\n` +
              JSON.stringify(report, null, 2),
          );
        } catch (err) {
          logger.error(
            `[ASOScheduler] Failed to generate report for "${app.name}": ${(err as Error).message}`,
          );
        }
      }

      logger.info("[ASOScheduler] ✅ Weekly report generation complete");
    } catch (err) {
      logger.error(
        `[ASOScheduler] Critical error in weekly report: ${(err as Error).message}`,
      );
    }
  });

  cron.schedule("30 0 * * *", async () => {
    try {
      const expired = await expireStaleAdminGrants();

      if (expired > 0) {
        logger.info(`[GrantScheduler] Expired ${expired} admin Pro grant(s) past their end date`);
      }

    } catch (err) {
      logger.error(`[GrantScheduler] Failed to expire admin grants: ${(err as Error).message}`);
    }
  });

  logger.info(
    "[ASOScheduler] Autonomous ASO schedules registered:\n" +
      "  • Daily  00:30 — Expire admin Pro grants\n" +
      "  • Daily  03:00 — AI Analysis\n" +
      "  • Daily  04:00 — Experiment Evaluation\n" +
      "  • Weekly Mon 06:00 — Weekly Report",
  );
}

export async function generateWeeklyReport(appId: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [total, pending, deployed, evaluated] = await Promise.all([
    prisma.asoExperiment.count({
      where: { appId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.asoExperiment.count({
      where: {
        appId,
        status: AsoExperimentStatus.PENDING,
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.asoExperiment.count({
      where: {
        appId,
        status: AsoExperimentStatus.DEPLOYED,
        createdAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.asoExperiment.count({
      where: {
        appId,
        status: AsoExperimentStatus.EVALUATED,
        createdAt: { gte: sevenDaysAgo },
      },
    }),
  ]);

  const evaluatedExperiments = await prisma.asoExperiment.findMany({
    where: {
      appId,
      status: AsoExperimentStatus.EVALUATED,
      evaluatedAt: { gte: sevenDaysAgo },
    },
  });

  const successes = evaluatedExperiments.filter(
    (e: { rankBefore: number | null; rankAfter: number | null }) =>
      e.rankBefore != null && e.rankAfter != null && e.rankAfter < e.rankBefore,
  ).length;

  const successRate =
    evaluatedExperiments.length > 0
      ? Math.round((successes / evaluatedExperiments.length) * 100)
      : 0;

  const rankImprovements: number[] = evaluatedExperiments
    .filter(
      (e: { rankBefore: number | null; rankAfter: number | null }) =>
        e.rankBefore != null && e.rankAfter != null,
    )
    .map(
      (e: { rankBefore: number | null; rankAfter: number | null }) =>
        e.rankBefore! - e.rankAfter!,
    );

  const avgRankImprovement =
    rankImprovements.length > 0
      ? Math.round(
          rankImprovements.reduce((a: number, b: number) => a + b, 0) /
            rankImprovements.length,
        )
      : 0;

  return {
    appId,
    period: {
      from: sevenDaysAgo.toISOString(),
      to: new Date().toISOString(),
    },
    experiments: {
      total,
      pending,
      deployed,
      evaluated: evaluated,
    },
    performance: {
      successRate: `${successRate}%`,
      successCount: successes,
      failCount: evaluatedExperiments.length - successes,
      avgRankImprovement,
    },
  };
}
