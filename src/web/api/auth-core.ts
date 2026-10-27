import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { prisma } from "../../config";
import { signToken, requireAuth } from "../auth";
import { PRO_STATUSES } from "../../services/pro-grants";
import { founderWelcome } from "../../services/notifications/templates";
import { issueEmailVerification, setAuthCookie, clearAuthCookie } from "./auth-shared";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

authRouter.use(authLimiter);

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
        heardAboutUs: true,
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

const HEARD_ABOUT_US_OPTIONS = [
  "Reddit",
  "X (Twitter)",
  "Google search",
  "ChatGPT / AI assistant",
  "An email from us",
  "Friend or colleague",
  "Other",
] as const;

authRouter.post("/heard-about-us", requireAuth, async (req, res) => {
  try {
    const { source } = req.body as { source?: string };

    if (typeof source !== "string" || !(HEARD_ABOUT_US_OPTIONS as readonly string[]).includes(source)) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { heardAboutUs: source, heardAboutUsAt: new Date() },
    });

    res.json({ heardAboutUs: source });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});
