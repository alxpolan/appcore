import { Request, Response } from "express";
import cookie from "cookie";
import { logger, prisma } from "../../config";
import { requireAuth, loadTeamRole, requireWriteRole } from "../auth";
import { verifyWebhookSignature, type GitHubWebhookPayload } from "../../services/github";

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];
import { verifyAppOwnership, verifyToken } from "../auth";
import { runScreenshotGeneration } from "../../services/generate-screenshots";
import { runBuildJob } from "../../services/build-binary";
import { getJobLogBuffer } from "../../services/log-bus";
import { encrypt, decryptNullable } from "../../config/encryption";
import { githubRouter } from "./github-oauth";

githubRouter.get("/snapshot-env/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const app = await prisma.app.findUnique({
      where: { id: req.params.appId as string },
      select: { snapshotEnvVars: true },
    });

    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const envVars: Array<{ key: string; value: string }> = app.snapshotEnvVars
      ? JSON.parse(decryptNullable(app.snapshotEnvVars)!)
      : [];

    res.json({ envVars });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.put("/snapshot-env/:appId", writeAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const { envVars } = req.body as {
      envVars: Array<{ key: string; value: string }>;
    };

    if (!Array.isArray(envVars)) {
      res.status(400).json({ error: "envVars must be an array" });
      return;
    }

    const encrypted = encrypt(JSON.stringify(envVars));

    await prisma.app.update({
      where: { id: req.params.appId as string },
      data: { snapshotEnvVars: encrypted },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/builds/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const jobs = await prisma.buildJob.findMany({
      where: { appId: req.params.appId as string },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        appId: true,
        branch: true,
        commitSha: true,
        status: true,
        errors: true,
        errorSummary: true,
        ipaPath: true,
        version: true,
        buildNumber: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    res.json(
      jobs.map((j) => ({
        ...j,
        logs: [],
        errors: j.errors ? JSON.parse(j.errors) : [],
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/builds/:appId/:jobId/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const job = await prisma.buildJob.findFirst({
      where: {
        id: req.params.jobId as string,
        appId: req.params.appId as string,
      },
      select: { logs: true },
    });

    if (!job) {
      res.status(404).json({ error: "Build job not found" });
      return;
    }

    res.json({ logs: job.logs ? JSON.parse(job.logs) : [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const jobs = await prisma.screenshotJob.findMany({
      where: { appId: req.params.appId as string },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        appId: true,
        commitSha: true,
        commitMessage: true,
        branch: true,
        pusher: true,
        status: true,
        error: true,
        screenshotUrls: true,
        framedByLocale: true,
        screenshotDescriptions: true,
        screenshotSublines: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    res.json(jobs.map((j) => ({ ...j, logs: [] })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/:appId/:jobId/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const job = await prisma.screenshotJob.findFirst({
      where: {
        id: req.params.jobId as string,
        appId: req.params.appId as string,
      },
      select: { logs: true },
    });

    if (!job) {
      res.status(404).json({ error: "Screenshot job not found" });
      return;
    }

    res.json({ logs: job.logs ? JSON.parse(job.logs) : [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/:appId/:jobId/logs/stream", async (req: Request, res: Response) => {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const cookieToken = cookies.auth_token;
  const header = req.headers.authorization;
  const rawToken = cookieToken ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);

  if (!rawToken) {
    res.status(401).end();
    return;
  }

  let user: ReturnType<typeof verifyToken>;
  try {
    user = verifyToken(rawToken);
  } catch {
    res.status(401).end();
    return;
  }

  const appId = req.params.appId as string;
  const jobId = req.params.jobId as string;

  try {
    const app = await prisma.app.findUnique({ where: { id: appId } });

    if (!app || (user.role !== "ADMIN" && app.teamId !== user.teamId)) {
      res.status(403).end();
      return;
    }

    const job = await prisma.screenshotJob.findFirst({
      where: { id: jobId, appId },
      select: { status: true, logs: true },
    });

    if (!job) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: string, data: string) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    if (job.status === "COMPLETED" || job.status === "FAILED") {
      const stored: string[] = job.logs ? JSON.parse(job.logs) : [];
      for (const line of stored) send("log", line);
      send("done", job.status);
      res.end();
      return;
    }

    const buffer = getJobLogBuffer(jobId);

    if (!buffer) {
      send("waiting", "pending");
      res.end();
      return;
    }

    for (const line of buffer.logs) send("log", line);

    if (buffer.done) {
      send("done", "COMPLETED");
      res.end();
      return;
    }

    const onLine = (line: string) => send("log", line);
    const onDone = () => {
      send("done", "COMPLETED");
      res.end();
    };

    buffer.emitter.on("line", onLine);
    buffer.emitter.once("done", onDone);

    req.on("close", () => {
      buffer.emitter.off("line", onLine);
      buffer.emitter.off("done", onDone);
    });
  } catch (err: any) {
    logger.error(`SSE log stream error: ${err.message}`);
    res.end();
  }
});

async function getAppAndToken(appId: string, res: Response) {
  const app = await prisma.app.findUnique({ where: { id: appId } });

  if (!app) {
    res.status(404).json({ error: "App not found" });
    return null;
  }

  if (!app.githubRepoFullName) {
    res.status(400).json({ error: "No GitHub repo linked" });
    return null;
  }

  if (!app.teamId) {
    res.status(400).json({ error: "App has no team" });
    return null;
  }

  const settings = await prisma.teamSettings.findUnique({
    where: { teamId: app.teamId },
  });

  if (!settings?.githubAccessToken) {
    res.status(400).json({ error: "No GitHub access token configured" });
    return null;
  }

  const token = decryptNullable(settings.githubAccessToken)!;

  return { app, token };
}

async function fetchLatestCommit(repoFullName: string, token: string, branch?: string | null) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const get = async <T>(url: string): Promise<T> => {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GitHub API Error: ${r.status}`);

    return r.json() as Promise<T>;
  };

  type GitRef = { ref: string; object: { sha: string } };

  if (branch) {
    const ref = await get<GitRef>(`https://api.github.com/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!ref.object || typeof ref.object.sha !== "string" || ref.object.sha.length === 0) throw new Error(`GitHub API response for git/ref/heads/${branch} is missing required field object.sha`);

    return { commitSha: ref.object.sha, branch };
  }

  const data = await get<GitRef[]>(`https://api.github.com/repos/${repoFullName}/git/refs/heads`);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`GitHub API response for git/refs/heads on ${repoFullName} contains no refs`);

  const ref = data[0];
  if (!ref.object || typeof ref.object.sha !== "string" || ref.object.sha.length === 0) throw new Error("GitHub API response for git/refs/heads is missing required field object.sha");
  if (typeof ref.ref !== "string" || ref.ref.length === 0) throw new Error("GitHub API response for git/refs/heads is missing required field ref");

  return {
    commitSha: ref.object.sha,
    branch: ref.ref.replace("refs/heads/", ""),
  };
}

githubRouter.post("/screenshots/trigger/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const ctx = await getAppAndToken(req.params.appId as string, res);
    if (!ctx) return;

    const { commitSha, branch } = await fetchLatestCommit(ctx.app.githubRepoFullName!, ctx.token, ctx.app.githubBranch);
    const job = await prisma.screenshotJob.create({
      data: {
        appId: ctx.app.id,
        commitSha,
        commitMessage: "[manual trigger]",
        branch,
        pusher: req.user!.userId,
        status: "PENDING",
      },
    });

    runScreenshotGeneration(job.id).catch((err) => logger.error(`Screenshot job ${job.id} failed: ${err.message}`));
    res.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.post("/builds/trigger/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const ctx = await getAppAndToken(req.params.appId as string, res);
    if (!ctx) return;
    const { commitSha, branch } = await fetchLatestCommit(ctx.app.githubRepoFullName!, ctx.token, ctx.app.githubBranch);

    runBuildJob(ctx.app.id, {
      repoUrl: `https://github.com/${ctx.app.githubRepoFullName}.git`,
      accessToken: ctx.token,
      branch,
      appName: ctx.app.name,
      bundleId: ctx.app.bundleId,
      commitSha,
    }).catch((err) => logger.error(`Build job for app ${ctx.app.id} failed: ${err.message}`));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.post("/webhook", async (req: Request, res: Response) => {
  try {
    const event = req.headers["x-github-event"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;
    const body = JSON.stringify(req.body);

    if (event !== "push") {
      res.json({ ok: true, skipped: true, reason: `event=${event}` });
      return;
    }

    const payload = req.body as GitHubWebhookPayload;
    const repoFullName = payload.repository.full_name;

    const app = await prisma.app.findFirst({
      where: { githubRepoFullName: repoFullName },
    });

    if (!app) {
      logger.warn(`Webhook received for unlinked repo: ${repoFullName}`);
      res.status(200).json({ ok: false, reason: "no linked app" });
      return;
    }

    if (!app.githubWebhookSecret || !signature) {
      res.status(401).json({ error: "Missing signature or secret" });
      return;
    }

    if (!verifyWebhookSignature(body, signature, app.githubWebhookSecret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const commitSha = payload.after;
    const commitMessage = payload.head_commit?.message ?? null;
    const branch = payload.ref.replace("refs/heads/", "");
    const pusher = payload.pusher.name;

    logger.info(`GitHub push: ${repoFullName}@${branch} (${commitSha.slice(0, 7)}) by ${pusher}`);

    if (app.githubBranch && app.githubBranch !== branch) {
      logger.info(`Ignoring push to ${branch}: app is pinned to ${app.githubBranch}`);
      res.json({ ok: true, ignored: true, reason: "branch-mismatch" });
      return;
    }

    let jobId: string | undefined;

    if (app.screenshotsLocked) {
      logger.info(`Skipping screenshot generation for ${repoFullName}: screenshots are locked`);
    } else {
      const job = await prisma.screenshotJob.create({
        data: {
          appId: app.id,
          commitSha,
          commitMessage,
          branch,
          pusher,
          status: "PENDING",
        },
      });

      jobId = job.id;

      runScreenshotGeneration(job.id).catch((err) =>
        logger.error(`Screenshot generation failed for job ${job.id}: ${err.message}`),
      );
    }

    const settings = app.teamId
      ? await prisma.teamSettings.findUnique({
          where: { teamId: app.teamId },
        })
      : null;

    if (settings?.githubAccessToken) {
      runBuildJob(app.id, {
        repoUrl: `https://github.com/${repoFullName}.git`,
        accessToken: settings.githubAccessToken,
        branch,
        appName: app.name,
        bundleId: app.bundleId,
        commitSha,
      }).catch((err) => logger.error(`Binary build failed for app ${app.id}: ${err.message}`));
    }

    res.json({ ok: true, jobId, screenshotsLocked: app.screenshotsLocked });
  } catch (err: any) {
    logger.error(`Webhook handler error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});
