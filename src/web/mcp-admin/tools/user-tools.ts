import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, logger } from "../../../config";
import { ok, fail, redactSecrets } from "./shared";

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function registerUserTools(server: McpServer, adminUserId: string | null) {
  // @ts-ignore
  server.registerTool(
    "list_users",
    {
      description:
        "List all users on the platform (admin/CEO view). Returns id, email, name, role, " +
        "created date, team count and app count for each user. Supports search and pagination. " +
        "Call this to get an overview of everyone using Marteso.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Filter by email or name (case-insensitive substring match)."),
        role: z
          .enum(["USER", "ADMIN"])
          .optional()
          .describe("Filter to only users with this role."),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        pageSize: z.number().int().min(1).max(100).default(25).describe("Results per page (max 100)."),
      },
    },
    async ({ search, role, page, pageSize }) => {
      const where: any = {};
      if (role) where.role = role;

      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            ...userSelect,
            _count: { select: { teamMembers: true } },
            teamMembers: {
              select: { team: { select: { id: true, name: true, _count: { select: { apps: true } } } } },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);

      const data = users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        teamCount: u._count.teamMembers,
        appCount: u.teamMembers.reduce((sum, m) => sum + m.team._count.apps, 0),
        teams: u.teamMembers.map((m) => ({ id: m.team.id, name: m.team.name })),
      }));

      return ok({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_user",
    {
      description:
        "Get full details for a single user by id or email, including their teams, team " +
        "members, apps, subscription, and passkeys. Secrets are redacted.",
      inputSchema: {
        userId: z.string().optional().describe("User id. Provide either userId or email."),
        email: z.string().optional().describe("User email. Provide either userId or email."),
      },
    },
    async ({ userId, email }) => {
      if (!userId && !email) return fail("Provide either userId or email.");

      const user = await prisma.user.findFirst({
        where: userId ? { id: userId } : { email: email! },
        include: {
          teamMembers: {
            include: {
              team: {
                include: {
                  settings: true,
                  subscription: true,
                  members: { include: { user: { select: userSelect } } },
                  apps: { select: { id: true, name: true, bundleId: true, isOwnApp: true } },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          passkeys: {
            select: { id: true, name: true, deviceType: true, createdAt: true, lastUsedAt: true },
          },
        },
      });

      if (!user) return fail("User not found.");

      return ok(redactSecrets(user));
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_user",
    {
      description:
        "Create a new user account. By default also creates a personal team owned by the user " +
        "(mirrors normal sign-up). Optionally attach the user to an existing team instead. " +
        "Returns the created user (without secrets).",
      inputSchema: {
        email: z.string().email().describe("Email address (must be unique)."),
        password: z
          .string()
          .min(8)
          .describe("Initial password (min 8 chars). Stored hashed (bcrypt)."),
        name: z.string().optional().describe("Display name. Defaults to the email local-part."),
        role: z
          .enum(["USER", "ADMIN"])
          .default("USER")
          .describe("Account role. Use ADMIN sparingly."),
        teamId: z
          .string()
          .optional()
          .describe(
            "Attach the user to this existing team instead of creating a personal team.",
          ),
        teamRole: z
          .enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])
          .default("MEMBER")
          .describe("Role within the team when teamId is provided."),
      },
    },
    async ({ email, password, name, role, teamId, teamRole }) => {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return fail("Email already in use.");

      if (teamId) {
        const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
        if (!team) return fail(`Team not found: ${teamId}`);
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const displayName = name ?? email.split("@")[0];

      const user = await prisma.user.create({
        data: { email, name: displayName, passwordHash, role },
        select: userSelect,
      });

      let team;

      if (teamId) {
        await prisma.teamMember.create({ data: { teamId, userId: user.id, role: teamRole } });
        team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
      } else {
        team = await prisma.team.create({
          data: {
            name: `${displayName}'s Team`,
            members: { create: { userId: user.id, role: "OWNER" } },
          },
          select: { id: true, name: true },
        });
      }

      logger.info(`Admin MCP: user created ${user.email} (${user.id}) by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true, user, team });
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_user",
    {
      description:
        "Update a user's name, email, or role. Bumps the user's tokenVersion when the role " +
        "changes so existing sessions are invalidated. Only provided fields are changed.",
      inputSchema: {
        userId: z.string().describe("Id of the user to update."),
        email: z.string().email().optional().describe("New email (must remain unique)."),
        name: z.string().optional().describe("New display name."),
        role: z.enum(["USER", "ADMIN"]).optional().describe("New role."),
      },
    },
    async ({ userId, email, name, role }) => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return fail("User not found.");

      if (email && email !== user.email) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) return fail("Email already in use.");
      }

      const data: any = {};
      if (email !== undefined) data.email = email;
      if (name !== undefined) data.name = name;

      if (role !== undefined && role !== user.role) {
        data.role = role;
        data.tokenVersion = { increment: 1 };
      }

      if (Object.keys(data).length === 0) return fail("No fields to update.");

      const updated = await prisma.user.update({ where: { id: userId }, data, select: userSelect });

      logger.info(`Admin MCP: user updated ${userId} by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true, user: updated });
    },
  );

  // @ts-ignore
  server.registerTool(
    "reset_user_password",
    {
      description:
        "Set a new password for a user (admin reset). Stores a bcrypt hash and bumps " +
        "tokenVersion to invalidate existing sessions.",
      inputSchema: {
        userId: z.string().describe("Id of the user."),
        newPassword: z.string().min(8).describe("New password (min 8 chars)."),
      },
    },
    async ({ userId, newPassword }) => {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return fail("User not found.");

      const passwordHash = await bcrypt.hash(newPassword, 12);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });

      logger.info(`Admin MCP: password reset for ${userId} by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true });
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_user",
    {
      description:
        "Permanently delete a user account. Requires confirm=true. Teams the user solely owns " +
        "are NOT auto-deleted — review them first with get_user. This cannot be undone.",
      inputSchema: {
        userId: z.string().describe("Id of the user to delete."),
        confirm: z
          .boolean()
          .describe("Must be true to actually delete. A safety guard against accidental deletion."),
      },
    },
    async ({ userId, confirm }) => {
      if (!confirm) return fail("Deletion not confirmed. Pass confirm=true to proceed.");

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });

      if (!user) return fail("User not found.");
      if (userId === adminUserId) return fail("You cannot delete the account you are acting as.");

      await prisma.teamMember.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });

      logger.info(`Admin MCP: user deleted ${user.email} (${userId}) by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true, deleted: userId });
    },
  );
}
