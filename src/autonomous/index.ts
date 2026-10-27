import { logger } from "../config";
import { ASOMemory } from "./memory";
import { ASOBrain } from "./brain";
import { ASOEvaluator } from "./evaluator";
import { ASOExecutor } from "./executor";

export { ASOMemory } from "./memory";
export { ASOBrain } from "./brain";
export { ASOEvaluator } from "./evaluator";
export { ASOExecutor } from "./executor";
export { initScheduler, generateWeeklyReport } from "./scheduler";

const AUTO_DEPLOY_CONFIDENCE = 0.85;

export async function runOnce(
  appId: string,
  userId: string,
  opts: { autoDeploy?: boolean } = {},
) {
  const memory = new ASOMemory();
  const brain = new ASOBrain(memory);
  const executor = new ASOExecutor();
  const evaluator = new ASOEvaluator(memory);

  logger.info(`[Autonomous] runOnce for app ${appId} (userId: ${userId})`);

  const experiments = await brain.analyze(appId, userId);

  logger.info(`[Autonomous] Created ${experiments.length} experiments`);
  const deployed: string[] = [];

  if (opts.autoDeploy !== false) {
    for (const exp of experiments) {
      if (exp.confidence > AUTO_DEPLOY_CONFIDENCE) {
        logger.info(
          `[Autonomous] Auto-deploying experiment ${exp.id} (confidence: ${exp.confidence})`,
        );
        try {
          await executor.deployExperiment(exp.id, userId);
          deployed.push(exp.id);
        } catch (err) {
          logger.error(
            `[Autonomous] Auto-deploy failed for ${exp.id}: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  const evaluations = await evaluator.evaluatePendingExperiments(appId);

  const report = {
    appId,
    newExperiments: experiments.length,
    autoDeployed: deployed.length,
    autoDeployedIds: deployed,
    evaluatedCount: evaluations.length,
    successfulEvaluations: evaluations.filter((e) => e.success).length,
    experiments: experiments.map((e) => ({
      id: e.id,
      type: e.type,
      fromValue: e.fromValue,
      toValue: e.toValue,
      confidence: e.confidence,
      reason: e.reason,
      autoDeployed: deployed.includes(e.id),
    })),
  };

  logger.info(
    `[Autonomous] runOnce complete: ${JSON.stringify(report, null, 2)}`,
  );

  return report;
}
