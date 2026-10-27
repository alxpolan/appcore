import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma, env } from "../../config";
import { signToken, requireAuth } from "../auth";
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
import { setAuthCookie } from "./auth-shared";
import { authRouter } from "./auth-core";

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

const DEMO_EMAIL = "demo@marteso.com";

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
