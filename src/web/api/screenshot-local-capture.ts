import { Router, type Request, type Response } from "express";
import express from "express";
import path from "path";
import { logger, prisma } from "../../config";
import { mcpAuth } from "../mcp/auth";
import { verifyMcpAppAccess } from "../mcp/tools/shared";
import { finishScreenshotCapture } from "../../services/generate-screenshots-capture";
import { createJobLogEmitter } from "../../services/log-bus";

export const screenshotLocalCaptureRouter = Router();

interface PendingCapture {
  appId: string;
  screenshots: Record<string, Array<{ filename: string; data: string }>>;
  descriptions?: Record<string, string>;
  config?: Record<string, string>;
}

const PENDING_CAPTURE_TTL_MS = 60 * 60_000;
const pendingCaptures = new Map<string, PendingCapture>();
const pendingTimers = new Map<string, NodeJS.Timeout>();

function trackPending(jobId: string): void {
  const existing = pendingTimers.get(jobId);

  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingCaptures.delete(jobId);
    pendingTimers.delete(jobId);
  }, PENDING_CAPTURE_TTL_MS);

  timer.unref?.();
  pendingTimers.set(jobId, timer);
}

function mcpUserId(req: Request): string {
  return (req as any).mcpUserId as string;
}

screenshotLocalCaptureRouter.get("/local-capture/config", mcpAuth, async (req: Request, res: Response) => {
  const bundleId = req.query.bundleId;

  if (typeof bundleId !== "string" || !bundleId) {
    res.status(400).json({ error: "bundleId is required" });
    return;
  }

  const app = await verifyMcpAppAccess(mcpUserId(req), bundleId);

  if (!app) {
    res.status(404).json({ error: `App not found or not accessible: ${bundleId}` });
    return;
  }

  res.json({
    appName: app.name,
    iosDir: app.githubIosDir ?? undefined,
    framework: app.githubFramework ?? undefined,
  });
});

screenshotLocalCaptureRouter.post(
  "/local-capture",
  mcpAuth,
  express.json({ limit: "200mb" }),
  async (req: Request, res: Response) => {
    const { bundleId, commitSha, branch, jobId, screenshots, descriptions, config, final } = req.body as {
      bundleId?: string;
      commitSha?: string;
      branch?: string;
      jobId?: string;
      screenshots?: Record<string, Array<{ filename: string; data: string }>>;
      descriptions?: Record<string, string>;
      config?: Record<string, string>;
      final?: boolean;
    };

    if (!bundleId || !screenshots) {
      res.status(400).json({ error: "bundleId and screenshots are required" });
      return;
    }

    const app = await verifyMcpAppAccess(mcpUserId(req), bundleId);

    if (!app) {
      res.status(404).json({ error: `App not found or not accessible: ${bundleId}` });
      return;
    }

    let resolvedJobId = jobId;

    if (resolvedJobId) {
      const pending = pendingCaptures.get(resolvedJobId);

      if (!pending || pending.appId !== app.id) {
        res.status(404).json({ error: `Unknown or expired in-progress capture: ${resolvedJobId}` });
        return;
      }

      for (const [locale, images] of Object.entries(screenshots)) {
        pending.screenshots[locale] = [...(pending.screenshots[locale] ?? []), ...images];
      }

      if (descriptions) pending.descriptions = descriptions;
      if (config) pending.config = config;

      trackPending(resolvedJobId);
    } else {
      if (!commitSha) {
        res.status(400).json({ error: "commitSha is required to start a new capture" });
        return;
      }

      const job = await prisma.screenshotJob.create({
        data: {
          appId: app.id,
          commitSha,
          commitMessage: "[local capture]",
          branch,
          pusher: mcpUserId(req),
          status: "RUNNING",
          startedAt: new Date(),
        },
      });

      resolvedJobId = job.id;
      pendingCaptures.set(resolvedJobId, { appId: app.id, screenshots, descriptions, config });
      trackPending(resolvedJobId);
    }

    if (!final) {
      res.json({ ok: true, jobId: resolvedJobId });

      return;
    }

    res.json({ ok: true, jobId: resolvedJobId });

    const pending = pendingCaptures.get(resolvedJobId)!;

    pendingCaptures.delete(resolvedJobId);
    clearTimeout(pendingTimers.get(resolvedJobId));
    pendingTimers.delete(resolvedJobId);

    const outputDir = path.join(process.cwd(), "screenshots", resolvedJobId);
    const logs: string[] = [];
    const { emit: emitLog, finish: finishLog } = createJobLogEmitter(resolvedJobId);
    const log = (msg: string) => {
      logs.push(msg);
      emitLog(msg);
      logger.info(`[screenshots:${resolvedJobId}] ${msg}`);
    };

    try {
      const jobWithApp = await prisma.screenshotJob.findUnique({
        where: { id: resolvedJobId },
        include: { app: true },
      });

      if (!jobWithApp) throw new Error(`Screenshot job ${resolvedJobId} disappeared`);

      await finishScreenshotCapture(
        resolvedJobId,
        jobWithApp,
        outputDir,
        { screenshots: pending.screenshots, descriptions: pending.descriptions, config: pending.config },
        logs,
        log,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      log(`ERROR: ${msg}`);

      await prisma.screenshotJob.update({
        where: { id: resolvedJobId },
        data: { status: "FAILED", error: msg, completedAt: new Date(), logs: JSON.stringify(logs) },
      });
    } finally {
      finishLog();
    }
  },
);
