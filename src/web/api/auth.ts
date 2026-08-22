import { Router, type Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import axios from "../../services/utils/http";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { logger, prisma, env } from "../../config";
import { signToken, requireAuth } from "../auth";
import { PRO_STATUSES } from "../../services/pro-grants";
import { founderWelcome, verifyEmail } from "../../services/notifications/templates";
import type { UserRole } from "@prisma/client";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function setAuthCookie(res: Response, token: string) {
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

function clearAuthCookie(res: Response) {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

type OAuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tokenVersion: number;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

// Called when an OAuth provider proves ownership of an existing account's email.
// If the account was never verified but already had a password, that password
// was set by an unproven party (pre-registration hijack), so it is revoked and
// all outstanding tokens invalidated before the real owner is signed in.
async function reconcileOAuthAccount(user: OAuthUser): Promise<OAuthUser> {
  if (user.emailVerifiedAt) return user;
  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      ...(user.passwordHash ? { passwordHash: null, tokenVersion: { increment: 1 } } : {}),
    },
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
}

async function issueEmailVerification(userId: string, email: string): Promise<void> {
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.emailVerificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
  });
  await verifyEmail({ to: email, token }).catch((err) => logger.error("verify email send failed", err));
}

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

authRouter.use(authLimiter);

const RP_ID = env.WEBAUTHN_RP_ID;
const RP_NAME = env.WEBAUTHN_RP_NAME;
const ORIGIN = env.WEBAUTHN_ORIGIN;

const challengeStore = new Map<string, { challenge: string; expires: number }>();
setInterval(
  () => {
    const now = Date.now();
    for (const [key, val] of challengeStore) {
      if (val.expires < now) challengeStore.delete(key);
    }
  },
  5 * 60 * 1000,
);

authRouter.post("/signup", async (req, res) => {
  try {
    const { email, password, name, inviteToken } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      inviteToken?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName = name ?? email.split("@")[0];
    let invite = inviteToken ? await prisma.teamInvite.findUnique({ where: { token: inviteToken } }) : null;

    if (invite && (invite.acceptedAt || invite.expiresAt < new Date())) {
      invite = null;
    }

    if (invite && invite.email.toLowerCase() !== email.toLowerCase()) {
      res.status(403).json({ error: "This invite is for a different email address" });
      return;
    }

    // An invite link is delivered to the invitee's mailbox, so accepting it
    // already proves control of the address; other signups must verify by email.
    const user = await prisma.user.create({
      data: { email, name: displayName, passwordHash, role: "USER", emailVerifiedAt: invite ? new Date() : null },
    });

    let teamId: string | null = null;

    if (invite) {
      await prisma.teamMember.create({
        data: { teamId: invite.teamId, userId: user.id, role: invite.role },
      });
      await prisma.teamInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      teamId = invite.teamId;
    } else {
      const team = await prisma.team.create({
        data: {
          name: `${displayName}'s Team`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      teamId = team.id;
    }

    if (!invite) {
      await issueEmailVerification(user.id, user.email);
      res.status(201).json({ verificationRequired: true, email: user.email });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId,
      tokenVersion: user.tokenVersion,
    });
    setAuthCookie(res, token);
    founderWelcome({ to: user.email, name: user.name ?? displayName });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId,
        teamRole: "OWNER",
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.emailVerifiedAt) {
      await issueEmailVerification(user.id, user.email);
      res.status(403).json({
        error: "Please verify your email address. We've sent you a new confirmation link.",
        verificationRequired: true,
      });
      return;
    }

    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId: membership?.teamId ?? null,
      tokenVersion: user.tokenVersion,
    });

    setAuthCookie(res, token);

    const passkeyCount = await prisma.passkeyCredential.count({
      where: { userId: user.id },
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId: membership?.teamId ?? null,
        teamRole: user.role === "ADMIN" ? "OWNER" : (membership?.role ?? null),
      },
      hasPasskeys: passkeyCount > 0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }

    const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date()) {
      res.status(400).json({ error: "Invalid or expired verification link" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } });

    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const jwt = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId: membership?.teamId ?? null,
      tokenVersion: user.tokenVersion,
    });
    setAuthCookie(res, jwt);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId: membership?.teamId ?? null,
        teamRole: user.role === "ADMIN" ? "OWNER" : (membership?.role ?? null),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (email) {
      const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (user && !user.emailVerifiedAt) {
        await issueEmailVerification(user.id, user.email);
      }
    }
    // Generic response regardless of account existence to avoid enumeration.
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/accept-invite", requireAuth, async (req, res) => {
  try {
    const { token: inviteToken } = req.body as { token?: string };
    if (!inviteToken) {
      res.status(400).json({ error: "token required" });
      return;
    }

    const invite = await prisma.teamInvite.findUnique({
      where: { token: inviteToken },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      res.status(400).json({ error: "Invalid or expired invite" });
      return;
    }

    if (invite.email.trim().toLowerCase() !== req.user!.email.trim().toLowerCase()) {
      res.status(403).json({ error: "This invite is for a different email address" });
      return;
    }

    await prisma.teamMember.upsert({
      where: {
        teamId_userId: { teamId: invite.teamId, userId: req.user!.userId },
      },
      create: {
        teamId: invite.teamId,
        userId: req.user!.userId,
        role: invite.role,
      },
      update: { role: invite.role },
    });

    await prisma.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    const freshUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { tokenVersion: true },
    });

    const newToken = signToken({
      userId: req.user!.userId,
      email: req.user!.email,
      role: req.user!.role,
      teamId: invite.teamId,
      tokenVersion: freshUser?.tokenVersion ?? 0,
    });

    setAuthCookie(res, newToken);
    res.json({ ok: true, teamId: invite.teamId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        passwordHash: true,
        passkeys: {
          select: { id: true, name: true, createdAt: true, lastUsedAt: true },
        },
        teamMembers: {
          select: { teamId: true, role: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const membership = user.teamMembers[0];
    const { passwordHash, ...rest } = user;

    const teamId = membership?.teamId ?? null;
    let plan: "pro" | "free" = "free";
    let isFringeloTeam = false;
    if (teamId) {
      const [sub, fringeloMember] = await Promise.all([
        prisma.subscription.findUnique({ where: { teamId }, select: { status: true } }),
        prisma.teamMember.findFirst({
          where: { teamId, user: { email: "admin@fringelo.com" } },
          select: { id: true },
        }),
      ]);
      if (sub && (PRO_STATUSES as readonly string[]).includes(sub.status)) {
        plan = "pro";
      }
      isFringeloTeam = fringeloMember != null;
    }

    res.json({
      ...rest,
      passwordSet: passwordHash != null,
      teamId,
      teamRole: user.role === "ADMIN" ? "OWNER" : (membership?.role ?? null),
      plan,
      isFringeloTeam,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.patch("/profile", requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body as { name?: string; email?: string };
    const updates: { name?: string; email?: string } = {};

    if (typeof name === "string") updates.name = name.trim();
    if (typeof email === "string") {
      const trimmed = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      const existing = await prisma.user.findFirst({
        where: { email: trimmed, NOT: { id: req.user!.userId } },
      });

      if (existing) {
        res.status(409).json({ error: "Email already in use" });
        return;
      }
      updates.email = trimmed;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const emailChanged = typeof updates.email === "string";

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: emailChanged ? { ...updates, tokenVersion: { increment: 1 } } : updates,
      select: { id: true, email: true, name: true, role: true, tokenVersion: true },
    });

    if (emailChanged) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        teamId: membership?.teamId ?? null,
        tokenVersion: user.tokenVersion,
      });

      setAuthCookie(res, token);
    }

    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.patch("/password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        res.status(400).json({ error: "Current password required" });
        return;
      }

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    res.json({ ok: true, hadPassword: !!user.passwordHash });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.get("/users", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.delete("/users/:id", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (userId === req.user!.userId) {
      res.status(400).json({ error: "Cannot delete yourself" });
      return;
    }

    await prisma.user.delete({ where: { id: userId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

const DEMO_EMAIL = "demo@marteso.com"; //"demo@marteso.com";

authRouter.post("/demo", async (_req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_EMAIL },
      select: { id: true, email: true, name: true, role: true, tokenVersion: true },
    });

    if (!user) {
      res.status(503).json({ error: "Demo account not found" });
      return;
    }

    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    if (!membership) {
      res.status(503).json({ error: "Demo account not found" });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId: membership.teamId,
      tokenVersion: user.tokenVersion,
      isDemo: true,
    });

    setAuthCookie(res, token);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId: membership.teamId,
        teamRole: "OWNER",
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/passkey/register-options", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { passkeys: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: Buffer.from(user.id),
      userName: user.email,
      userDisplayName: user.name ?? user.email,
      attestationType: "none",
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    challengeStore.set(`reg:${user.id}`, {
      challenge: options.challenge,
      expires: Date.now() + 5 * 60 * 1000,
    });

    res.json({ options });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/passkey/register-verify", requireAuth, async (req, res) => {
  try {
    const { registrationResponse, passkeyName } = req.body as {
      registrationResponse: RegistrationResponseJSON;
      passkeyName?: string;
    };

    const stored = challengeStore.get(`reg:${req.user!.userId}`);
    if (!stored || stored.expires < Date.now()) {
      res.status(400).json({ error: "Challenge expired, start registration again" });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: "Passkey verification failed" });
      return;
    }

    challengeStore.delete(`reg:${req.user!.userId}`);

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await prisma.passkeyCredential.create({
      data: {
        userId: req.user!.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.transports ?? [],
        name: passkeyName ?? null,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/passkey/login-options", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };

    let allowCredentials: { id: string; transports: string[] }[] = [];

    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { passkeys: true },
      });

      if (user && user.passkeys.length > 0) {
        allowCredentials = user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: p.transports,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "preferred",
      allowCredentials: allowCredentials.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
    });

    const sessionId = crypto.randomUUID();
    challengeStore.set(`auth:${sessionId}`, {
      challenge: options.challenge,
      expires: Date.now() + 5 * 60 * 1000,
    });

    res.json({ options, sessionId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/passkey/login-verify", async (req, res) => {
  try {
    const { sessionId, assertionResponse } = req.body as {
      sessionId: string;
      assertionResponse: AuthenticationResponseJSON;
    };

    const stored = challengeStore.get(`auth:${sessionId}`);
    if (!stored || stored.expires < Date.now()) {
      res.status(400).json({ error: "Challenge expired, try again" });
      return;
    }

    const cred = await prisma.passkeyCredential.findUnique({
      where: { credentialId: assertionResponse.id },
      include: { user: { select: { id: true, email: true, name: true, role: true, tokenVersion: true } } },
    });

    if (!cred) {
      res.status(401).json({ error: "Unknown passkey" });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.counter),
        transports: cred.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: "Passkey authentication failed" });
      return;
    }

    challengeStore.delete(`auth:${sessionId}`);

    await prisma.passkeyCredential.update({
      where: { id: cred.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    const { user } = cred;
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId: membership?.teamId ?? null,
      tokenVersion: user.tokenVersion,
    });
    setAuthCookie(res, token);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId: membership?.teamId ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.delete("/passkey/:id", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const cred = await prisma.passkeyCredential.findUnique({
      where: { id: id ?? "" },
    });

    if (!cred || cred.userId !== req.user!.userId) {
      res.status(404).json({ error: "Passkey not found" });
      return;
    }

    await prisma.passkeyCredential.delete({ where: { id: cred.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

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
