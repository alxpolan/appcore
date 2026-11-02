import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import type { StudioProgressEvent, StudioSaveResult } from "./render";

const RENDER_LEASE_MS = 2 * 60_000;
const HEARTBEAT_MS = 15_000;
const emptyProgress: StudioProgressEvent = { done: 0, total: 0, locale: null, basenames: [] };

export interface StudioRenderState {
  operationId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  progress: StudioProgressEvent;
  result: StudioSaveResult | null;
  error: string | null;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** A heartbeat distinguishes a long worker batch from an interrupted server process. */
export async function getStudioRenderStatus(jobId: string): Promise<StudioRenderState | null> {
  const row = await prisma.screenshotStudioRender.findUnique({ where: { jobId } });
  if (!row) return null;
  if (row.status === "RUNNING" && row.updatedAt.getTime() < Date.now() - RENDER_LEASE_MS) {
    await prisma.screenshotStudioRender.updateMany({
      where: { jobId, operationId: row.operationId, status: "RUNNING", updatedAt: row.updatedAt },
      data: { status: "FAILED", error: "Render was interrupted. Your draft is preserved; save again to retry.", completedAt: new Date() },
    });
    // The heartbeat or completion may have raced this read.
    return getStudioRenderStatus(jobId);
  }
  return { ...row, status: row.status as StudioRenderState["status"], progress: row.progress as unknown as StudioProgressEvent, result: row.result as unknown as StudioSaveResult | null };
}

export async function trackStudioRender(
  jobId: string,
  run: (emit: (progress: StudioProgressEvent) => void) => Promise<StudioSaveResult>,
  onProgress?: (progress: StudioProgressEvent) => void,
): Promise<StudioSaveResult> {
  await getStudioRenderStatus(jobId); // Reap an expired operation before claiming the job.
  const operationId = crypto.randomUUID();
  const data = {
    operationId, status: "RUNNING", progress: emptyProgress as unknown as Prisma.InputJsonValue,
    result: Prisma.DbNull, error: null, startedAt: new Date(), completedAt: null,
  };
  const claimed = await prisma.screenshotStudioRender.updateMany({
    where: { jobId, status: { not: "RUNNING" } }, data,
  });
  if (!claimed.count) {
    try {
      await prisma.screenshotStudioRender.create({ data: { jobId, ...data } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new Error("A render is already running for this job.");
      throw err;
    }
  }
  const where = { jobId, operationId, status: "RUNNING" };
  let writes = Promise.resolve();
  const persist = (patch: Prisma.ScreenshotStudioRenderUpdateManyMutationInput) => {
    writes = writes.then(async () => { await prisma.screenshotStudioRender.updateMany({ where, data: patch }); })
      .catch((err) => { logger.warn(`[studio:${jobId}] Could not persist render progress: ${String(err)}`); });
  };
  const heartbeat = setInterval(() => persist({ updatedAt: new Date() }), HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const result = await run((progress) => {
      persist({ progress: progress as unknown as Prisma.InputJsonValue });
      onProgress?.(progress);
    });
    await writes;
    await prisma.screenshotStudioRender.updateMany({
      where, data: { status: "SUCCEEDED", result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, completedAt: new Date() },
    });
    return result;
  } catch (err) {
    await writes;
    await prisma.screenshotStudioRender.updateMany({
      where, data: { status: "FAILED", error: err instanceof Error ? err.message : String(err), completedAt: new Date() },
    });
    throw err;
  } finally { clearInterval(heartbeat); }
}
