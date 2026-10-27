import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import type { App, TeamSettings } from "@prisma/client";
import { env, prisma } from "../config";

const JWT_SECRET = env.JWT_SECRET;

export type TeamRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  teamId: string | null;
  tokenVersion?: number;
  isDemo?: boolean;
}

export interface AuthedUser {
  userId: string;
  email: string;
  role: string;
  teamId: string;
  isDemo?: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
      bundleApp?: App;
      teamRole?: TeamRoleName | null;
      teamSettings?: TeamSettings | null;
    }
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function loadTeamRole(req: Request, _res: Response, next: NextFunction) {
  if (req.user!.role === "ADMIN") {
    req.teamRole = "OWNER";

    return next();
  }

  try {
    const member = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId: req.user!.teamId, userId: req.user!.userId },
      },
      select: { role: true },
    });

    req.teamRole = (member?.role as TeamRoleName | undefined) ?? null;
  } catch {
    req.teamRole = null;
  }
  next();
}

const WRITE_ROLES = new Set<TeamRoleName>(["OWNER", "ADMIN", "MEMBER"]);

export function requireWriteRole(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (req.user?.role === "ADMIN") return next();

  if (!req.teamRole || !WRITE_ROLES.has(req.teamRole)) {
    res.status(403).json({ error: "You do not have permission to perform this action" });

    return;
  }

  next();
}

export function demoGuard(req: Request, res: Response, next: NextFunction) {
  if (req.user?.isDemo && MUTATING_METHODS.has(req.method)) {
    res.json({ ok: true });

    return;
  }

  next();
}

export function requireTeamAdminMw(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "ADMIN") return next();
  if (req.teamRole === "OWNER" || req.teamRole === "ADMIN") return next();
  res.status(403).json({ error: "Team admin role required" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  const cookieToken = cookies.auth_token;
  const header = req.headers.authorization;
  const rawToken = cookieToken ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);

  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });

    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = verifyToken(rawToken);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });

    return;
  }

  if (!decoded.userId || !decoded.email || !decoded.role || !decoded.teamId) {
    res.status(401).json({ error: "Invalid token claims" });

    return;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { tokenVersion: true, role: true },
    });

    if (!dbUser) {
      res.status(401).json({ error: "Unauthorized" });

      return;
    }

    if (decoded.tokenVersion !== dbUser.tokenVersion) {
      res.status(401).json({ error: "Token has been invalidated" });

      return;
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: dbUser.role,
      teamId: decoded.teamId,
      isDemo: decoded.isDemo ?? false,
    };
    next();
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function loadTeamSettings(req: Request, _res: Response, next: NextFunction) {
  req.teamSettings = await prisma.teamSettings.findUnique({
    where: { teamId: req.user!.teamId },
  });
  next();
}

export function bundleAccess(source: "params" | "query" | "body" = "query", paramName = "bundleId") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bundleId = req[source]?.[paramName] as string | undefined;

    if (!bundleId) {
      res.status(400).json({ error: `${paramName} required` });

      return;
    }

    const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
    if (!app) return;

    req.bundleApp = app;
    next();
  };
}

export function appAccess(source: "params" | "query" | "body" = "query", paramName = "appId") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const appId = req[source]?.[paramName] as string | undefined;

    if (!appId) {
      res.status(400).json({ error: `${paramName} required` });

      return;
    }

    const app = await verifyAppOwnership(req, res, appId);
    if (!app) return;
    req.bundleApp = app;
    next();
  };
}

export function requireBundleAccess(
  source: "params" | "query" | "body" = "query",
  paramName = "bundleId",
): Array<(req: Request, res: Response, next: NextFunction) => void> {
  return [requireAuth, bundleAccess(source, paramName)];
}

export async function memberAllowedApp(userId: string, teamId: string, appId: string): Promise<boolean> {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { appAccess: { select: { appId: true } } },
  });

  if (!member) return false;
  if (member.role === "OWNER" || member.role === "ADMIN") return true;
  if (member.appAccess.length === 0) return true;

  return member.appAccess.some((a) => a.appId === appId);
}

export async function verifyAppOwnership(req: Request, res: Response, appId: string) {
  const app = await prisma.app.findUnique({ where: { id: appId } });

  if (!app) {
    res.status(404).json({ error: "App not found" });

    return null;
  }

  if (req.user!.role === "ADMIN") return app;

  if (!app.teamId || app.teamId !== req.user!.teamId) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  if (!(await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id))) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  return app;
}

export async function verifyAppOwnershipByBundleId(req: Request, res: Response, bundleId: string) {
  const app = await prisma.app.findUnique({ where: { bundleId } });

  if (!app) {
    res.status(404).json({ error: "App not found" });

    return null;
  }

  if (req.user!.role === "ADMIN") return app;

  if (!app.teamId || app.teamId !== req.user!.teamId) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  if (!(await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id))) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  return app;
}

export async function requireTeamAdmin(req: Request, res: Response): Promise<boolean> {
  if (req.user!.role === "ADMIN") return true;

  const member = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: { teamId: req.user!.teamId, userId: req.user!.userId },
    },
    select: { role: true },
  });

  if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
    res.status(403).json({ error: "Team admin role required" });

    return false;
  }

  return true;
}

export async function loadVersionInBundle(res: Response, versionId: string, bundleId: string) {
  const version = await prisma.appStoreVersion.findFirst({
    where: { id: versionId, bundleId },
  });

  if (!version) {
    res.status(404).json({ error: "Version not found" });

    return null;
  }

  return version;
}

export async function loadVersionLocalizationInBundle(
  res: Response,
  opts: { ascLocalizationId: string; kind: "appInfo" | "version"; bundleId: string },
) {
  const { ascLocalizationId, kind, bundleId } = opts;
  const where =
    kind === "appInfo"
      ? { appInfoLocalizationId: ascLocalizationId, version: { bundleId } }
      : { versionLocalizationId: ascLocalizationId, version: { bundleId } };

  const localization = await prisma.appStoreVersionLocalization.findFirst({ where });

  if (!localization) {
    res.status(404).json({ error: "Localization not found" });

    return null;
  }

  return localization;
}

export async function verifyTeamMemberBelongsToTeam(req: Request, res: Response, memberId: string) {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    res.status(404).json({ error: "Member not found" });

    return null;
  }

  if (req.user!.role !== "ADMIN" && member.teamId !== req.user!.teamId) {
    res.status(403).json({ error: "Not authorized" });

    return null;
  }

  return member;
}
