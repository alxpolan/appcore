import { Router, Request, Response } from "express";
import crypto from "crypto";
import { logger, prisma } from "../../config";
import { env } from "../../config/env";
import { requireAuth, loadTeamRole, loadTeamSettings, requireWriteRole } from "../auth";
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
} from "../../services/github";
import { verifyAppOwnership } from "../auth";

const writeAuth = [requireAuth, loadTeamRole, requireWriteRole];

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

githubRouter.get(
  "/detect-framework/:owner/:repo",
  requireAuth,
  loadTeamSettings,
  async (req: Request, res: Response) => {
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
  },
);

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
