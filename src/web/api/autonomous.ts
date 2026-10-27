import { Router } from "express";
import { prisma, logger } from "../../config";
import { ASOBrain } from "../../autonomous/brain";
import { ASOExecutor } from "../../autonomous/executor";
import { ASOMemory } from "../../autonomous/memory";
import { AsoExperimentStatus } from "@prisma/client";
import { generateWeeklyReport } from "../../autonomous/scheduler";
import { verifyAppOwnership } from "../auth";
export const autonomousRouter = Router();

autonomousRouter.get("/:appId/analyze", async (req, res) => {
  try {
    const { appId } = req.params;
    const userId = req.user!.userId;

    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;

    logger.info(`[API] Autonomous analysis requested for app "${app.name}" by user ${userId}`);

    const memory = new ASOMemory();
    const brain = new ASOBrain(memory);
    const experiments = await brain.analyze(appId, userId);

    res.json({
      success: true,
      appId,
      experiments: experiments.map((e) => ({
        id: e.id,
        type: e.type,
        fromValue: e.fromValue,
        toValue: e.toValue,
        reason: e.reason,
        confidence: e.confidence,
        status: e.status,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    logger.error(`[API] Autonomous analyze error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

autonomousRouter.get("/:appId/experiments", async (req, res) => {
  try {
    const { appId } = req.params;
    const owned = await verifyAppOwnership(req, res, appId);
    if (!owned) return;

    const status = req.query.status as string | undefined;

    const where: any = { appId };

    if (status) {
      where.status = status.toUpperCase();
    }

    const experiments = await prisma.asoExperiment.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, appId, count: experiments.length, experiments });
  } catch (err) {
    logger.error(`[API] Autonomous experiments list error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

autonomousRouter.post("/:appId/experiments/:expId/approve", async (req, res) => {
  try {
    const { appId, expId } = req.params;
    const owned = await verifyAppOwnership(req, res, appId);
    if (!owned) return;

    const experiment = await prisma.asoExperiment.findFirst({
      where: { id: expId, appId },
    });

    if (!experiment) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }

    if (experiment.status !== AsoExperimentStatus.PENDING && experiment.status !== AsoExperimentStatus.APPROVED) {
      res.status(400).json({
        error: `Cannot approve experiment with status "${experiment.status}"`,
      });
      return;
    }

    await prisma.asoExperiment.update({
      where: { id: expId },
      data: { status: AsoExperimentStatus.APPROVED },
    });

    const executor = new ASOExecutor();
    const result = await executor.deployExperiment(expId, req.user!.userId);

    logger.info(`[API] Experiment ${expId} approved and deployed by user ${req.user!.userId}`);

    res.json(result);
  } catch (err) {
    logger.error(`[API] Autonomous approve error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

autonomousRouter.post("/:appId/experiments/:expId/reject", async (req, res) => {
  try {
    const { appId, expId } = req.params;
    const owned = await verifyAppOwnership(req, res, appId);
    if (!owned) return;

    const experiment = await prisma.asoExperiment.findFirst({
      where: { id: expId, appId },
    });

    if (!experiment) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }

    if (experiment.status === AsoExperimentStatus.DEPLOYED) {
      res.status(400).json({
        error: "Cannot reject an already deployed experiment",
      });
      return;
    }

    const updated = await prisma.asoExperiment.update({
      where: { id: expId },
      data: { status: AsoExperimentStatus.REJECTED },
    });

    logger.info(`[API] Experiment ${expId} rejected by user ${req.user!.userId}`);

    res.json({ success: true, experiment: updated });
  } catch (err) {
    logger.error(`[API] Autonomous reject error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

autonomousRouter.get("/:appId/report", async (req, res) => {
  try {
    const { appId } = req.params;

    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;

    const report = await generateWeeklyReport(appId);

    res.json({ success: true, report });
  } catch (err) {
    logger.error(`[API] Autonomous report error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});
