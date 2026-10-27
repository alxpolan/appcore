import crypto from "crypto";
import axios from "../../services/utils/http";
import { logger, prisma, env } from "../../config";
import { signToken } from "../auth";
import { founderWelcome } from "../../services/notifications/templates";
import { reconcileOAuthAccount, setAuthCookie } from "./auth-shared";
import { authRouter } from "./auth-core";

function signSignInState(): string {
  const payload = { nonce: crypto.randomBytes(16).toString("hex"), ts: Date.now() };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");

  return `${data}.${sig}`;
}

function verifySignInState(state: string): { ts: number } | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;

  const data = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

authRouter.get("/google/start", (_req, res) => {
  const clientId = env.GOOGLE_AUTH_CLIENT_ID;

  if (!clientId) {
    res.status(500).json({ error: "Google sign-in is not configured" });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${env.APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state: signSignInState(),
    access_type: "online",
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

authRouter.get("/google/callback", async (req, res) => {
  const appUrl = env.APP_URL;
  const fail = (reason: string) => res.redirect(`${appUrl}/#gg_error=${encodeURIComponent(reason)}`);

  try {
    const code = req.query.code as string | undefined;
    const stateRaw = req.query.state as string | undefined;
    if (!code || !stateRaw) return fail("missing_code_or_state");

    const parsed = verifySignInState(stateRaw);
    if (!parsed) return fail("invalid_state");
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return fail("state_expired");

    const clientId = env.GOOGLE_AUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_AUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail("not_configured");

    const tokenRes = await axios.post<{
      access_token?: string;
      error?: string;
    }>(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    if (tokenRes.data.error) return fail(tokenRes.data.error);
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) return fail("no_access_token");

    const profileRes = await axios.get<{
      email?: string;
      name?: string;
      verified_email?: boolean;
    }>("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = profileRes.data;

    if (!profile.email || !profile.verified_email) return fail("no_verified_email");
    const email = profile.email.toLowerCase();

    let user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenVersion: true,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    let teamId: string | null = null;
    let teamRole: string | null = null;
    let isNew = false;

    if (user) {
      user = await reconcileOAuthAccount(user);
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      teamId = membership?.teamId ?? null;
      teamRole = user.role === "ADMIN" ? "OWNER" : (membership?.role ?? null);
    } else {
      const displayName = profile.name?.trim() || email.split("@")[0];

      user = await prisma.user.create({
        data: { email, name: displayName, role: "USER", emailVerifiedAt: new Date() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tokenVersion: true,
          passwordHash: true,
          emailVerifiedAt: true,
        },
      });

      const team = await prisma.team.create({
        data: {
          name: `${displayName}'s Team`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });

      teamId = team.id;
      teamRole = "OWNER";
      isNew = true;
      logger.info(`New user signed up via Google: ${email}`);
      founderWelcome({ to: user.email, name: user.name ?? displayName });
    }

    const jwtToken = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId,
      tokenVersion: user.tokenVersion,
    });

    setAuthCookie(res, jwtToken);

    const fragment = new URLSearchParams({
      gg_done: "1",
      user: Buffer.from(
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          teamId,
          teamRole,
        }),
      ).toString("base64url"),
    });

    if (isNew) fragment.set("gg_new", "1");
    res.redirect(`${appUrl}/#${fragment}`);
  } catch (err: any) {
    logger.error(`Google sign-in callback error: ${err.message}`);
    fail("server_error");
  }
});

authRouter.get("/github/start", (_req, res) => {
  const clientId = env.GITHUB_AUTH_CLIENT_ID;

  if (!clientId) {
    res.status(500).json({ error: "GitHub sign-in is not configured" });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "user:email",
    state: signSignInState(),
    allow_signup: "true",
  });

  res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});

authRouter.get("/github/callback", async (req, res) => {
  const appUrl = env.APP_URL;
  const fail = (reason: string) => res.redirect(`${appUrl}/#gh_error=${encodeURIComponent(reason)}`);

  try {
    const code = req.query.code as string | undefined;
    const stateRaw = req.query.state as string | undefined;
    if (!code || !stateRaw) return fail("missing_code_or_state");

    const parsed = verifySignInState(stateRaw);
    if (!parsed) return fail("invalid_state");
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return fail("state_expired");

    const clientId = env.GITHUB_AUTH_CLIENT_ID;
    const clientSecret = env.GITHUB_AUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail("not_configured");

    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      { client_id: clientId, client_secret: clientSecret, code },
      { headers: { Accept: "application/json" } },
    );

    if (tokenRes.data.error) return fail(tokenRes.data.error);
    const accessToken = tokenRes.data.access_token as string | undefined;
    if (!accessToken) return fail("no_access_token");

    const ghHeaders = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" };

    const profileRes = await axios.get<{ login: string; name: string | null; email: string | null }>(
      "https://api.github.com/user",
      { headers: ghHeaders },
    );

    const profile = profileRes.data;

    let email = profile.email?.toLowerCase() ?? null;

    if (!email) {
      const emailsRes = await axios.get<Array<{ email: string; primary: boolean; verified: boolean }>>(
        "https://api.github.com/user/emails",
        { headers: ghHeaders },
      );

      const primary = emailsRes.data.find((e) => e.primary && e.verified) ?? emailsRes.data.find((e) => e.verified);

      email = primary?.email.toLowerCase() ?? null;
    }

    if (!email) return fail("no_verified_email");

    let user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenVersion: true,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    let teamId: string | null = null;
    let teamRole: string | null = null;
    let isNew = false;

    if (user) {
      user = await reconcileOAuthAccount(user);
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      teamId = membership?.teamId ?? null;
      teamRole = user.role === "ADMIN" ? "OWNER" : (membership?.role ?? null);
    } else {
      const displayName = profile.name?.trim() || profile.login || email.split("@")[0];

      user = await prisma.user.create({
        data: { email, name: displayName, role: "USER", emailVerifiedAt: new Date() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tokenVersion: true,
          passwordHash: true,
          emailVerifiedAt: true,
        },
      });

      const team = await prisma.team.create({
        data: {
          name: `${displayName}'s Team`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });

      teamId = team.id;
      teamRole = "OWNER";
      isNew = true;
      logger.info(`New user signed up via GitHub: ${email}`);
      founderWelcome({ to: user.email, name: user.name ?? displayName });
    }

    const jwtToken = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId,
      tokenVersion: user.tokenVersion,
    });

    setAuthCookie(res, jwtToken);

    const fragment = new URLSearchParams({
      gh_done: "1",
      user: Buffer.from(
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          teamId,
          teamRole,
        }),
      ).toString("base64url"),
    });

    if (isNew) fragment.set("gh_new", "1");
    res.redirect(`${appUrl}/#${fragment}`);
  } catch (err: any) {
    logger.error(`GitHub sign-in callback error: ${err.message}`);
    fail("server_error");
  }
});
