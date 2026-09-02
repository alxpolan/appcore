import { Router, Request, Response } from "express";
import crypto from "crypto";
import cookie from "cookie";
import fs from "fs";
import path from "path";
import { logger, prisma } from "../../config";
import { env } from "../../config/env";
import { requireAuth, loadTeamRole, loadTeamSettings, requireWriteRole } from "../auth";
import { resolveInternalAppId } from "../lib/resolve-app";

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];
import { encrypt, decryptNullable } from "../../config/encryption";
import {
  getGitHubOAuthUrl,
  exchangeGitHubCode,
  getGitHubUser,
  listUserRepos,
  listRepoDirs,
  listRepoBranches,
  detectFramework,
  linkRepoToApp,
  unlinkRepoFromApp,
  verifyWebhookSignature,
  type GitHubWebhookPayload,
} from "../../services/github";
import { verifyAppOwnership, verifyToken } from "../auth";
import { runScreenshotGeneration } from "../../services/generate-screenshots";
import { runBuildJob } from "../../services/build-binary";
import { frameWithFastlane } from "../../services/frame-screenshots";
import { getJobLogBuffer } from "../../services/log-bus";

export const githubRouter = Router();

function signOAuthState(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyOAuthState(state: string): { userId: string; ts: number } | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const data = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

githubRouter.get("/oauth/start", requireAuth, async (req: Request, res: Response) => {
  try {
    const state = signOAuthState({ userId: req.user!.userId, ts: Date.now() });
    const url = getGitHubOAuthUrl(state);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const stateRaw = req.query.state as string;
    if (!code || !stateRaw) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    const parsed = verifyOAuthState(stateRaw);
    if (!parsed?.userId) {
      res.status(400).json({ error: "Invalid or tampered state" });
      return;
    }
    const { userId, ts } = parsed;
    if (Date.now() - ts > 10 * 60 * 1000) {
      res.status(400).json({ error: "OAuth state expired" });
      return;
    }

    const membership = await prisma.teamMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) {
      res.redirect("/settings?github=error");
      return;
    }

    const teamId = membership.teamId;
    const accessToken = await exchangeGitHubCode(code);
    const ghUser = await getGitHubUser(accessToken);
    const encryptedToken = encrypt(accessToken);

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        githubAccessToken: encryptedToken,
        githubUsername: ghUser.login,
        githubAvatarUrl: ghUser.avatar_url,
        githubConnectedAt: new Date(),
      },
      update: {
        githubAccessToken: encryptedToken,
        githubUsername: ghUser.login,
        githubAvatarUrl: ghUser.avatar_url,
        githubConnectedAt: new Date(),
      },
    });

    logger.info(`GitHub connected for user ${userId}: @${ghUser.login}`);
    res.redirect("/settings?github=connected");
  } catch (err: any) {
    logger.error(`GitHub OAuth callback error: ${err.message}`);
    res.redirect("/settings?github=error");
  }
});

githubRouter.get("/status", requireAuth, loadTeamSettings, async (req: Request, res: Response) => {
  try {
    const settings = req.teamSettings;
    res.json({
      connected: !!settings?.githubAccessToken,
      username: settings?.githubUsername ?? null,
      avatarUrl: settings?.githubAvatarUrl ?? null,
      connectedAt: settings?.githubConnectedAt ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.post("/disconnect", writeAuth, async (req: Request, res: Response) => {
  try {
    const teamId = req.user!.teamId;

    await prisma.teamSettings.updateMany({
      where: { teamId },
      data: {
        githubAccessToken: null,
        githubUsername: null,
        githubAvatarUrl: null,
        githubConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/repos", requireAuth, loadTeamSettings, async (req: Request, res: Response) => {
  try {
    const settings = req.teamSettings;
    if (!settings?.githubAccessToken) {
      res.status(400).json({ error: "GitHub not connected" });
      return;
    }
    const repos = await listUserRepos(decryptNullable(settings.githubAccessToken)!);
    res.json(
      repos.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/repo-dirs/:owner/:repo", requireAuth, loadTeamSettings, async (req: Request, res: Response) => {
  try {
    const settings = req.teamSettings;
    if (!settings?.githubAccessToken) {
      res.status(400).json({ error: "GitHub not connected" });
      return;
    }
    const repoFullName = `${req.params.owner}/${req.params.repo}`;
    const dirs = await listRepoDirs(decryptNullable(settings.githubAccessToken)!, repoFullName);
    res.json(dirs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/repo-branches/:owner/:repo", requireAuth, loadTeamSettings, async (req: Request, res: Response) => {
  try {
    const settings = req.teamSettings;
    if (!settings?.githubAccessToken) {
      res.status(400).json({ error: "GitHub not connected" });
      return;
    }
    const repoFullName = `${req.params.owner}/${req.params.repo}`;
    const branches = await listRepoBranches(decryptNullable(settings.githubAccessToken)!, repoFullName);
    res.json(branches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/detect-framework/:owner/:repo", requireAuth, loadTeamSettings, async (req: Request, res: Response) => {
  try {
    const settings = req.teamSettings;
    if (!settings?.githubAccessToken) {
      res.status(400).json({ error: "GitHub not connected" });
      return;
    }
    const repoFullName = `${req.params.owner}/${req.params.repo}`;
    const framework = await detectFramework(decryptNullable(settings.githubAccessToken)!, repoFullName);
    res.json({ framework });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.post("/link", writeAuth, async (req: Request, res: Response) => {
  try {
    const { appId, repoFullName, iosDir, framework, branch } = req.body;
    if (!appId || !repoFullName) {
      res.status(400).json({ error: "appId and repoFullName required" });
      return;
    }
    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;

    await linkRepoToApp(req.user!.userId, appId, repoFullName, iosDir ?? null, framework ?? null, branch ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.put("/framework/:appId", writeAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const { framework } = req.body as { framework?: string };
    if (framework !== "capacitor" && framework !== "native") {
      res.status(400).json({ error: "framework must be 'capacitor' or 'native'" });
      return;
    }
    await prisma.app.update({
      where: { id: req.params.appId as string },
      data: { githubFramework: framework },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.put("/branch/:appId", writeAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const { branch } = req.body as { branch?: string | null };
    const trimmed = typeof branch === "string" ? branch.trim() : null;
    if (trimmed !== null && trimmed.length === 0) {
      res.status(400).json({ error: "branch must be a non-empty string or null" });
      return;
    }
    await prisma.app.update({
      where: { id: req.params.appId as string },
      data: { githubBranch: trimmed },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.post("/unlink", writeAuth, async (req: Request, res: Response) => {
  try {
    const { appId } = req.body;
    if (!appId) {
      res.status(400).json({ error: "appId required" });
      return;
    }
    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;

    await unlinkRepoFromApp(req.user!.userId, appId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/app-repo/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const owned = await verifyAppOwnership(req, res, req.params.appId as string);
    if (!owned) return;

    const app = await prisma.app.findUnique({
      where: { id: req.params.appId as string },
      select: {
        githubRepoOwner: true,
        githubRepoName: true,
        githubRepoFullName: true,
        githubIosDir: true,
        githubFramework: true,
        githubBranch: true,
      },
    });
    res.json({
      linked: !!app?.githubRepoFullName,
      repoFullName: app?.githubRepoFullName ?? null,
      repoOwner: app?.githubRepoOwner ?? null,
      repoName: app?.githubRepoName ?? null,
      iosDir: app?.githubIosDir ?? null,
      framework: app?.githubFramework ?? null,
      branch: app?.githubBranch ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
        ipaPath: true,
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
  const get = async (url: string) => {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`GitHub API Error: ${r.status}`);
    return r.json();
  };

  if (branch) {
    const ref = await get(
      `https://api.github.com/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return { commitSha: (ref?.object?.sha ?? "unknown") as string, branch };
  }

  // No branch configured: fall back to whatever the API lists first. This is arbitrary
  // rather than the default branch, which is exactly why the setting exists.
  const data = await get(`https://api.github.com/repos/${repoFullName}/git/refs/heads`);
  const ref = Array.isArray(data) ? data[0] : null;
  return {
    commitSha: (ref?.object?.sha ?? "unknown") as string,
    branch: (ref?.ref?.replace("refs/heads/", "") ?? "main") as string,
  };
}

githubRouter.post("/screenshots/trigger/:appId", writeAuth, async (req: Request, res: Response) => {
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

githubRouter.post("/builds/trigger/:appId", writeAuth, async (req: Request, res: Response) => {
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

    // Apps that pin a branch only build that one. Without a pin every push to every
    // branch would keep triggering a full screenshot run plus a binary build.
    if (app.githubBranch && app.githubBranch !== branch) {
      logger.info(`Ignoring push to ${branch}: app is pinned to ${app.githubBranch}`);
      res.json({ ok: true, ignored: true, reason: "branch-mismatch" });
      return;
    }

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

    const settings = app.teamId
      ? await prisma.teamSettings.findUnique({
          where: { teamId: app.teamId },
        })
      : null;

    runScreenshotGeneration(job.id).catch((err) =>
      logger.error(`Screenshot generation failed for job ${job.id}: ${err.message}`),
    );

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

    res.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    logger.error(`Webhook handler error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.delete("/screenshots/framed/:jobId", writeAuth, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const job = await prisma.screenshotJob.findUnique({ where: { id: jobId } });
    if (!job || !job.framedByLocale) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const framedByLocale = job.framedByLocale as Record<string, string[]>;
    const updated: Record<string, string[]> = {};
    for (const [locale, urls] of Object.entries(framedByLocale)) {
      const filtered = urls.filter((u) => u !== url);
      if (filtered.length > 0) updated[locale] = filtered;
    }

    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: { framedByLocale: updated as any },
    });

    try {
      const screenshotsBase = path.join(process.cwd(), "screenshots");
      const rel = url.replace(/^\/screenshots\//, "");
      const filePath = path.join(screenshotsBase, rel);
      if (filePath.startsWith(screenshotsBase) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      logger.warn(`Failed to delete screenshot file: ${err.message}`);
    }

    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Delete framed screenshot error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.patch("/screenshots/framed/:jobId/reorder", writeAuth, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const { locale, urls } = req.body as { locale?: string; urls?: string[] };
    if (!locale || !Array.isArray(urls)) {
      res.status(400).json({ error: "locale and urls are required" });
      return;
    }

    const job = await prisma.screenshotJob.findUnique({ where: { id: jobId } });
    if (!job?.framedByLocale) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const framedByLocale = job.framedByLocale as Record<string, string[]>;
    const existing = framedByLocale[locale];
    if (!existing) {
      res.status(404).json({ error: `Locale ${locale} not found` });
      return;
    }

    const existingSet = new Set(existing);
    if (urls.length !== existing.length || !urls.every((u) => existingSet.has(u))) {
      res.status(400).json({ error: "urls must be a permutation of the existing screenshots" });
      return;
    }

    const updated = { ...framedByLocale, [locale]: urls };
    await prisma.screenshotJob.update({
      where: { id: jobId },
      data: { framedByLocale: updated as any },
    });

    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Reorder framed screenshots error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

githubRouter.get("/screenshots/latest-framed/:appId", requireAuth, async (req: Request, res: Response) => {
  try {
    const internalAppId = await resolveInternalAppId(req.params.appId as string);
    if (!internalAppId) {
      res.json({ job: null });
      return;
    }

    const jobs = await prisma.screenshotJob.findMany({
      where: { appId: internalAppId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const job = jobs.find((j) => j.framedByLocale != null) ?? null;

    if (!job || !job.framedByLocale) {
      res.json({ job: null });
      return;
    }

    res.json({
      job: {
        id: job.id,
        commitSha: job.commitSha,
        commitMessage: job.commitMessage,
        branch: job.branch,
        createdAt: job.createdAt,
        framedByLocale: job.framedByLocale,
      },
    });
  } catch (err: any) {
    logger.error(`latest-framed error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});
