import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma, logger } from "../../../config";
import { ok, fail, redactSecrets } from "./shared";

const memberUserSelect = { id: true, email: true, name: true, role: true } as const;

export function registerTeamTools(server: McpServer, adminUserId: string | null) {
  // @ts-ignore
  server.registerTool(
    "list_teams",
    {
      description:
        "List all teams on the platform with member counts, app counts, and subscription status. " +
        "Supports search by name and pagination.",
      inputSchema: {
        search: z.string().optional().describe("Filter by team name (case-insensitive substring)."),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        pageSize: z.number().int().min(1).max(100).default(25).describe("Results per page (max 100)."),
      },
    },
    async ({ search, page, pageSize }) => {
      const where: any = search ? { name: { contains: search, mode: "insensitive" } } : {};

      const [teams, total] = await Promise.all([
        prisma.team.findMany({
          where,
          select: {
            id: true,
            name: true,
            createdAt: true,
            _count: { select: { members: true, apps: true } },
            subscription: { select: { status: true, interval: true, renewsAt: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.team.count({ where }),
      ]);

      const data = teams.map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        memberCount: t._count.members,
        appCount: t._count.apps,
        subscriptionStatus: t.subscription?.status ?? "none",
        subscriptionInterval: t.subscription?.interval ?? null,
      }));

      return ok({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_team",
    {
      description:
        "Get full details for one team: members (with their users), apps, settings, and " +
        "subscription. Secrets are redacted.",
      inputSchema: {
        teamId: z.string().describe("Id of the team."),
      },
    },
    async ({ teamId }) => {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          settings: true,
          subscription: true,
          members: { include: { user: { select: memberUserSelect } }, orderBy: { createdAt: "asc" } },
          invites: { orderBy: { createdAt: "desc" } },
          apps: { select: { id: true, name: true, bundleId: true, isOwnApp: true, country: true } },
        },
      });

      if (!team) return fail("Team not found.");

      return ok(redactSecrets(team));
    },
  );

  // @ts-ignore
  server.registerTool(
    "set_team_member_role",
    {
      description:
        "Add a user to a team or change their role within it. If the user is already a member, " +
        "their role is updated; otherwise they are added.",
      inputSchema: {
        teamId: z.string().describe("Id of the team."),
        userId: z.string().describe("Id of the user."),
        role: z
          .enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])
          .describe("Role to assign within the team."),
      },
    },
    async ({ teamId, userId, role }) => {
      const [team, user] = await Promise.all([
        prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      ]);
      
      if (!team) return fail(`Team not found: ${teamId}`);
      if (!user) return fail(`User not found: ${userId}`);

      const member = await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId, userId } },
        create: { teamId, userId, role },
        update: { role },
        include: { user: { select: memberUserSelect } },
      });

      logger.info(
        `Admin MCP: team ${teamId} member ${userId} set to ${role} by ${adminUserId ?? "static-token"}`,
      );

      return ok({ ok: true, member });
    },
  );

  // @ts-ignore
  server.registerTool(
    "remove_team_member",
    {
      description: "Remove a user from a team. Does not delete the user account.",
      inputSchema: {
        teamId: z.string().describe("Id of the team."),
        userId: z.string().describe("Id of the user to remove."),
      },
    },
    async ({ teamId, userId }) => {
      const member = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
        select: { id: true },
      });

      if (!member) return fail("User is not a member of that team.");

      await prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
      logger.info(`Admin MCP: removed ${userId} from team ${teamId} by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true });
    },
  );
}
