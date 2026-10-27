import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import { requireAuth } from "../auth";
import { bossScheduler } from "../../jobs/boss";

export const bossRouter = Router();

bossRouter.use(requireAuth);

const VALID_QUEUES = [
  "scrape",
  "track-keywords",
  "sync-analytics",
  "extract-keywords",
  "discover-keywords",
  "discover-competitors",
  "analyze",
  "sync-metadata",
  "competitor-intel",
];

function isMissingSchema(err: unknown): boolean {
  const code = (err as any)?.meta?.driverAdapterError?.cause?.originalCode;
  return code === "42P01" || code === "3F000";
}

bossRouter.get("/jobs", async (req, res) => {
  if (req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const queue = (req.query.queue as string) || null;

    const rows = queue
      ? await prisma.$queryRaw(
          Prisma.sql`
            SELECT id::text, name, state::text, data, output,
                   retry_count, created_on, started_on, completed_on
            FROM pgboss.job
            WHERE name = ${queue}
              AND name NOT LIKE '%/dispatch'
            ORDER BY created_on DESC
            LIMIT ${limit}
          `,
        )
      : await prisma.$queryRaw(
          Prisma.sql`
            SELECT id::text, name, state::text, data, output,
                   retry_count, created_on, started_on, completed_on
            FROM pgboss.job
            WHERE name NOT LIKE '%/dispatch'
            ORDER BY created_on DESC
            LIMIT ${limit}
          `,
        );

    res.json(rows);
  } catch (err) {
    if (isMissingSchema(err)) return res.json([]);
    logger.error("[BOSS API] /jobs failed", { error: err });
    res.status(500).json({ error: "Failed to query pg-boss jobs" });
  }
});

bossRouter.get("/schedules", async (req, res) => {
  if (req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT name, cron, timezone, updated_on
        FROM pgboss.schedule
        ORDER BY name
      `,
    );

    res.json(rows);
  } catch (err) {
    if (isMissingSchema(err)) return res.json([]);
    logger.error("[BOSS API] /schedules failed", { error: err });
    res.status(500).json({ error: "Failed to query pg-boss schedules" });
  }
});

bossRouter.post("/send", async (req, res) => {
  if (req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const { queue } = req.body as { queue?: string };

  if (!queue || !VALID_QUEUES.includes(queue)) {
    res.status(400).json({ error: `queue must be one of: ${VALID_QUEUES.join(", ")}` });
    return;
  }

  if (!bossScheduler.isRunning) {
    res.status(503).json({ error: "BossScheduler is not running" });
    return;
  }

  try {
    await bossScheduler.triggerDispatch(queue);
    logger.info(`[BOSS API] Manual dispatch for "${queue}" by user ${req.user!.userId}`);
    res.json({ ok: true, message: `Dispatching ${queue}…` });
  } catch (err) {
    logger.error("[BOSS API] /send failed", { error: err });
    res.status(500).json({ error: "Failed to enqueue dispatch job" });
  }
});

bossRouter.delete("/jobs", async (req, res) => {
  if (req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const queue = (req.query.queue as string) || undefined;

  if (queue && !VALID_QUEUES.includes(queue)) {
    res.status(400).json({ error: `queue must be one of: ${VALID_QUEUES.join(", ")}` });
    return;
  }

  if (!bossScheduler.isRunning) {
    res.status(503).json({ error: "BossScheduler is not running" });
    return;
  }

  try {
    await bossScheduler.cancelAllJobs(queue);
    logger.info(`[BOSS API] Deleted all jobs${queue ? ` for queue "${queue}"` : ""} by user ${req.user!.userId}`);
    res.json({
      ok: true,
      message: queue ? `All jobs in "${queue}" deleted` : "All jobs deleted",
    });
  } catch (err) {
    logger.error("[BOSS API] DELETE /jobs failed", { error: err });
    res.status(500).json({ error: "Failed to delete jobs" });
  }
});
