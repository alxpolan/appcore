import { Router, Request, Response } from "express";
import { prisma } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamRole, requireWriteRole, demoGuard, TeamRoleName } from "../auth";
import { teamInvite } from "../../services/notifications/templates.js";
import crypto from "crypto";

export const teamRouter = Router();

const VALID_ROLES: TeamRoleName[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function send500(res: Response, err: unknown, scope: string) {
  console.error(`[team.ts:${scope}]`, err);
  res.status(500).json({ error: "Internal server error" });
}

function getActorRole(req: Request): TeamRoleName | null {
  if (req.user?.role === "ADMIN") return "OWNER";
  return (req.teamRole as TeamRoleName | undefined) ?? null;
}

function canAssignRole(actor: TeamRoleName | null, target: TeamRoleName): boolean {
  if (target === "OWNER" || target === "ADMIN") return actor === "OWNER";
  return actor === "OWNER" || actor === "ADMIN";
}

async function countOwners(teamId: string): Promise<number> {
  return prisma.teamMember.count({ where: { teamId, role: "OWNER" } });
}

teamRouter.get("/invite/:token", async (req, res) => {
  try {
    const invite = await prisma.teamInvite.findUnique({
      where: { token: req.params.token },
      include: { team: { select: { name: true } } },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      res.status(404).json({ error: "Invalid or expired invite" });
      return;
    }

    res.json({
      email: invite.email,
      role: invite.role,
      teamName: invite.team.name,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    send500(res, err, "GET /invite/:token");
  }
});

teamRouter.use(requireAuth, demoGuard, loadTeamRole, requireWriteRole);

async function getMyMembership(userId: string, teamId: string | null) {
  if (!teamId) return null;

  return prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
}

function canManageTeam(role: string | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

teamRouter.get("/", async (req, res) => {
  try {
    const teamId = req.user!.teamId;
    const isAdmin = req.user!.role === "ADMIN";

    if (!teamId && !isAdmin) {
      res.status(403).json({ error: "No team" });
      return;
    }

    const resolvedTeamId = teamId ?? (await prisma.team.findFirst())?.id;

    if (!resolvedTeamId) {
      res.json({ team: null, members: [] });
      return;
    }

    const team = await prisma.team.findUnique({
      where: { id: resolvedTeamId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
        invites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    res.json({
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      members: team.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
      pendingInvites: team.invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    send500(res, err, "GET /");
  }
});

teamRouter.post("/invite", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { email: rawEmail, role } = req.body as { email?: string; role?: string };

    if (!rawEmail || !role) {
      res.status(400).json({ error: "email and role required" });
      return;
    }

    if (!VALID_ROLES.includes(role as TeamRoleName)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const email = normalizeEmail(rawEmail);

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Invalid email" });
      return;
    }

    if (!canAssignRole(getActorRole(req), role as TeamRoleName)) {
      res.status(403).json({ error: "Insufficient permissions to assign this role" });
      return;
    }

    const teamId = req.user!.teamId;
    const team = await prisma.team.findUnique({ where: { id: teamId } });

    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      const alreadyMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: existingUser.id } },
      });

      if (alreadyMember) {
        res.status(409).json({ error: "Dieser Nutzer ist bereits Mitglied" });
        return;
      }
    }

    await prisma.teamInvite.updateMany({
      where: { teamId, email, acceptedAt: null },
      data: { expiresAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const inviter = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { name: true, email: true },
    });

    const invite = await prisma.teamInvite.create({
      data: {
        teamId,
        email,
        role: role as TeamRoleName,
        token,
        invitedBy: inviter?.name ?? inviter?.email ?? req.user!.userId,
        expiresAt,
      },
    });

    await teamInvite({
      to: email,
      inviterName: inviter?.name ?? inviter?.email ?? "Someone",
      teamName: team.name,
      role,
      token,
    });

    res.json({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    send500(res, err, "POST /invite");
  }
});

teamRouter.delete("/invites/:id", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId;

    const invite = await prisma.teamInvite.findUnique({
      where: { id: req.params.id },
    });

    if (!invite || invite.teamId !== teamId) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    await prisma.teamInvite.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    send500(res, err, "DELETE /invites/:id");
  }
});

teamRouter.put("/members/:id", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { role } = req.body as { role?: string };

    if (!role || !VALID_ROLES.includes(role as TeamRoleName)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const teamId = req.user!.teamId;
    const actorRole = getActorRole(req);
    const newRole = role as TeamRoleName;

    const target = await prisma.teamMember.findUnique({
      where: { id: req.params.id },
    });

    if (!target || target.teamId !== teamId) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    if (target.userId === req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Cannot change your own role" });
      return;
    }

    if (!canAssignRole(actorRole, newRole)) {
      res.status(403).json({ error: "Insufficient permissions to assign this role" });
      return;
    }

    if (target.role === "OWNER" && actorRole !== "OWNER") {
      res.status(403).json({ error: "Only an owner can change another owner's role" });
      return;
    }

    if (target.role === "OWNER" && newRole !== "OWNER") {
      const owners = await countOwners(teamId);

      if (owners <= 1) {
        res.status(409).json({ error: "A team must have at least one owner" });
        return;
      }
    }

    await prisma.teamMember.update({
      where: { id: req.params.id },
      data: { role: newRole },
    });

    res.json({ ok: true });
  } catch (err) {
    send500(res, err, "PUT /members/:id");
  }
});

teamRouter.delete("/members/:id", async (req, res) => {
  try {
    const existing = await prisma.teamMember.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const teamId = req.user!.teamId;
    const isAdmin = req.user!.role === "ADMIN";

    if (!isAdmin && existing.teamId !== teamId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const isSelf = existing.userId === req.user!.userId;
    const me = await getMyMembership(req.user!.userId, teamId ?? "");
    const actorRole: TeamRoleName | null = isAdmin ? "OWNER" : ((me?.role as TeamRoleName | undefined) ?? null);

    if (!isSelf && !isAdmin && !canManageTeam(me?.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!isSelf && existing.role === "OWNER" && actorRole !== "OWNER") {
      res.status(403).json({ error: "Only an owner can remove another owner" });
      return;
    }

    if (existing.role === "OWNER") {
      const owners = await countOwners(existing.teamId);

      if (owners <= 1) {
        res.status(409).json({ error: "A team must have at least one owner" });
        return;
      }
    }

    await prisma.teamMember.delete({ where: { id: req.params.id } });
    await prisma.user.update({
      where: { id: existing.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    res.json({ ok: true });
  } catch (err) {
    send500(res, err, "DELETE /members/:id");
  }
});

teamRouter.get("/members/:id/apps", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId;

    const member = await prisma.teamMember.findUnique({
      where: { id: req.params.id },
      include: { appAccess: { select: { appId: true } } },
    });

    if (!member || member.teamId !== teamId) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    res.json({ appIds: member.appAccess.map((a) => a.appId) });
  } catch (err) {
    send500(res, err, "GET /members/:id/apps");
  }
});

teamRouter.put("/members/:id/apps", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { appIds } = req.body as { appIds?: string[] };

    if (!Array.isArray(appIds) || appIds.some((v) => typeof v !== "string")) {
      res.status(400).json({ error: "appIds array required" });
      return;
    }

    const teamId = req.user!.teamId;
    const member = await prisma.teamMember.findUnique({
      where: { id: req.params.id },
    });

    if (!member || member.teamId !== teamId) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    if (appIds.length > 0) {
      const unique = Array.from(new Set(appIds));
      const valid = await prisma.app.findMany({
        where: { id: { in: unique }, teamId },
        select: { id: true },
      });

      if (valid.length !== unique.length) {
        res.status(400).json({ error: "One or more appIds do not belong to this team" });
        return;
      }
    }

    await prisma.$transaction([
      prisma.teamMemberAppAccess.deleteMany({
        where: { teamMemberId: req.params.id },
      }),
      ...(appIds.length > 0
        ? [
            prisma.teamMemberAppAccess.createMany({
              data: appIds.map((appId) => ({ teamMemberId: req.params.id, appId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    res.json({ ok: true });
  } catch (err) {
    send500(res, err, "PUT /members/:id/apps");
  }
});

teamRouter.put("/", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { name } = req.body as { name?: string };
    const trimmed = name?.trim();

    if (!trimmed) {
      res.status(400).json({ error: "name required" });
      return;
    }

    if (trimmed.length > 100) {
      res.status(400).json({ error: "name too long" });
      return;
    }

    const teamId = req.user!.teamId;
    const team = await prisma.team.update({
      where: { id: teamId },
      data: { name: trimmed },
    });

    res.json({ id: team.id, name: team.name });
  } catch (err) {
    send500(res, err, "PUT /");
  }
});
