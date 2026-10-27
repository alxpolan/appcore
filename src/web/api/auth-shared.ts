import type { Response } from "express";
import crypto from "crypto";
import { logger, prisma } from "../../config";
import { verifyEmail } from "../../services/notifications/templates";
import type { UserRole } from "@prisma/client";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function setAuthCookie(res: Response, token: string) {
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export type OAuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tokenVersion: number;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

export async function reconcileOAuthAccount(user: OAuthUser): Promise<OAuthUser> {
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

export async function issueEmailVerification(userId: string, email: string): Promise<void> {
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  const token = crypto.randomBytes(32).toString("hex");

  await prisma.emailVerificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
  });
  await verifyEmail({ to: email, token }).catch((err) => logger.error("verify email send failed", err));
}
