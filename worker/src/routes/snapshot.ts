import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { createSnapshotJob, getSnapshotJob } from "../log-bus";
import { SnapshotRunner } from "../services/SnapshotRunner";

const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;

export const snapshotRouter = Router();

interface SnapshotRequest {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  bundleId: string;
  iosDir?: string;
  framework?: string;
  exportMethod?: string;
  envVars?: Record<string, string>;
  splitIndex?: number;
  splitCount?: number;
}

snapshotRouter.post("/snapshot", async (req: Request, res: Response) => {
  const { repoUrl, accessToken, branch, appName, iosDir, framework, envVars, splitIndex, splitCount } =
    req.body as SnapshotRequest;

  if (!repoUrl || !accessToken || !appName) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  if (!/^https:\/\/[^\s"'`\\;<>&|$(){}[\]]+$/.test(repoUrl)) {
    res.status(400).json({ error: "Invalid repository URL" });
    return;
  }

  if (branch && !/^[a-zA-Z0-9/_.-]+$/.test(branch)) {
    res.status(400).json({ error: "Invalid branch name" });
    return;
  }

  const runId = String(Date.now());
  const { emit: emitLog, finish } = createSnapshotJob(runId);

  res.json({ ok: true, runId });

  const runner = new SnapshotRunner(
    runId,
    { repoUrl, accessToken, branch, appName, iosDir, framework, envVars, splitIndex, splitCount },
    emitLog,
    finish,
  );
  runner.run().catch(() => {
    /* errors are captured inside SnapshotRunner */
  });
});

snapshotRouter.get("/snapshot/:runId/stream", (req: Request, res: Response) => {
  const job = getSnapshotJob(req.params.runId as string);
  if (!job) {
    res.status(404).json({ error: "Unknown runId" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;

  const send = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      closed = true;
      console.error(`[snapshot] SSE write error: ${err}`);
    }
  };

  for (const line of job.logs) send("log", line);

  if (job.result) {
    send("result", job.result);
    if (!closed) res.end();
    return;
  }

  const onLine = (line: string) => send("log", line);
  const onResult = (result: unknown) => {
    send("result", result);
    if (!closed) res.end();
  };

  job.emitter.on("line", onLine);
  job.emitter.once("result", onResult);

  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (err) {
        closed = true;
        clearInterval(heartbeat);
        console.error(`[snapshot] SSE heartbeat error: ${err}`);
      }
    }
  }, 15_000);
  heartbeat.unref?.();

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    job.emitter.off("line", onLine);
    job.emitter.off("result", onResult);
  });

  res.on("error", () => {
    closed = true;
    clearInterval(heartbeat);
    job.emitter.off("line", onLine);
    job.emitter.off("result", onResult);
  });
});

snapshotRouter.get("/snapshot/:runId/xcresult/:filename", (req: Request, res: Response) => {
  const { runId, filename } = req.params as { runId: string; filename: string };

  if (!RUN_ID_RE.test(runId) || !FILENAME_RE.test(filename)) {
    res.status(400).json({ error: "Invalid runId or filename" });
    return;
  }

  const artifactsDir = path.join(process.cwd(), "logs", "captures", runId);
  const filePath = path.join(artifactsDir, filename);
  const resolved = path.resolve(filePath);
  
  if (!resolved.startsWith(path.resolve(artifactsDir) + path.sep)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: "xcresult not found" });
    return;
  }

  const stat = fs.statSync(resolved);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(resolved).pipe(res);
});
