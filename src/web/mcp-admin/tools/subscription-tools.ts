import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma, logger } from "../../../config";
import { ADMIN_GRANT_CUSTOMER, PRO_STATUSES, isAdminGrant, isGrantExpired } from "../../../services/pro-grants";
import { premiumGranted } from "../../../services/notifications/templates";
import { ok, fail } from "./shared";

export function registerSubscriptionTools(server: McpServer, adminUserId: string | null) {
  // @ts-ignore
  server.registerTool(
    "billing_overview",
    {
      description:
        "List every team with its effective subscription state: whether they are Pro, the source " +
        "(admin gift vs. Lemon Squeezy payment), interval, and expiry. Includes a summary row count of " +
        "Pro teams, admin grants, and paid teams.",
      inputSchema: {
        search: z.string().optional().describe("Filter by team name (case-insensitive substring)."),
        onlyPro: z.boolean().default(false).describe("If true, only return teams that are currently Pro."),
        page: z.number().int().min(1).default(1).describe("Page number (1-based)."),
        pageSize: z.number().int().min(1).max(100).default(50).describe("Results per page (max 100)."),
      },
    },
    async ({ search, onlyPro, page, pageSize }) => {
      const where: any = search ? { name: { contains: search, mode: "insensitive" } } : {};

      const teams = await prisma.team.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          subscription: true,
          _count: { select: { members: true, apps: true } },
        },
      });

      const now = new Date();
      const rows = teams.map((t) => {
        const s = t.subscription;
        const grant = isAdminGrant(s);
        const expired = isGrantExpired(s, now);
        const effectiveStatus = expired ? "expired" : (s?.status ?? null);
        const isPro = !!effectiveStatus && (PRO_STATUSES as readonly string[]).includes(effectiveStatus);

        return {
          teamId: t.id,
          teamName: t.name,
          createdAt: t.createdAt,
          memberCount: t._count.members,
          appCount: t._count.apps,
          isPro,
          subscription: s
            ? {
                status: effectiveStatus,
                interval: s.interval,
                endsAt: s.endsAt,
                renewsAt: s.renewsAt,
                source: grant ? "admin" : "lemon",
                permanent: grant && !s.endsAt,
              }
            : null,
        };
      });

      const filtered = onlyPro ? rows.filter((r) => r.isPro) : rows;
      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);

      return ok({
        summary: {
          totalTeams: rows.length,
          proTeams: rows.filter((r) => r.isPro).length,
          adminGrants: rows.filter((r) => r.subscription?.source === "admin" && r.isPro).length,
          paidTeams: rows.filter((r) => r.subscription?.source === "lemon" && r.isPro).length,
        },
        data: paged,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_team_subscription",
    {
      description:
        "Inspect one team's subscription: status, interval, endsAt, source (admin gift vs. paid), and " +
        "whether the gift has expired.",
      inputSchema: {
        teamId: z.string().describe("Id of the team."),
      },
    },
    async ({ teamId }) => {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { subscription: true },
      });

      if (!team) return fail("Team not found.");

      const s = team.subscription;
      const grant = isAdminGrant(s);
      const expired = isGrantExpired(s, new Date());
      const effectiveStatus = expired ? "expired" : (s?.status ?? null);
      const isPro = !!effectiveStatus && (PRO_STATUSES as readonly string[]).includes(effectiveStatus);

      return ok({
        teamId: team.id,
        teamName: team.name,
        isPro,
        subscription: s
          ? {
              status: effectiveStatus,
              interval: s.interval,
              endsAt: s.endsAt,
              renewsAt: s.renewsAt,
              trialEndsAt: s.trialEndsAt,
              source: grant ? "admin" : "lemon",
              permanent: grant && !s.endsAt,
              lemonSubscriptionId: s.lemonSubscriptionId,
            }
          : null,
      });
    },
  );

  // @ts-ignore
  server.registerTool(
    "gift_pro_subscription",
    {
      description:
        "Gift Pro to a team as an admin grant. Use forever=true for a permanent grant, or pass " +
        "durationDays for a time-limited gift. If the team already has an admin grant that is still in " +
        "the future, the duration is added on top of the current endsAt. Refuses to overwrite a real " +
        "Lemon Squeezy subscription. Sends a notification email to the team owner.",
      inputSchema: {
        teamId: z.string().describe("Id of the team to grant Pro to."),
        forever: z
          .boolean()
          .default(false)
          .describe("If true, the grant never expires. When set, durationDays is ignored."),
        durationDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of days the gift lasts. Required when forever is false."),
        interval: z
          .enum(["monthly", "yearly"])
          .default("yearly")
          .describe("Subscription interval label shown in the UI."),
      },
    },
    async ({ teamId, forever, durationDays, interval }) => {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          subscription: true,
          members: { where: { role: "OWNER" }, include: { user: true }, take: 1 },
        },
      });

      if (!team) return fail("Team not found.");

      const existing = team.subscription;

      if (existing && !isAdminGrant(existing)) {
        return fail("Team has a real paid subscription. Manage it in Lemon Squeezy instead.");
      }

      let endsAt: Date | null = null;

      if (!forever) {
        if (!durationDays || durationDays <= 0) {
          return fail("Provide a positive durationDays or set forever=true.");
        }

        const base =
          existing?.endsAt && new Date(existing.endsAt) > new Date() ? new Date(existing.endsAt) : new Date();

        endsAt = new Date(base.getTime() + durationDays * 86_400_000);
      }

      const data = {
        status: "active",
        interval,
        endsAt,
        renewsAt: endsAt,
        trialEndsAt: null,
        lemonCustomerId: ADMIN_GRANT_CUSTOMER,
        lemonOrderId: null,
        lemonProductId: null,
        lemonVariantId: null,
        cardBrand: null,
        cardLastFour: null,
        customerPortalUrl: null,
        updatePaymentMethodUrl: null,
      };

      const subscription = existing
        ? await prisma.subscription.update({ where: { teamId }, data })
        : await prisma.subscription.create({
            data: { teamId, lemonSubscriptionId: `admin_grant_${teamId}`, ...data },
          });

      const ownerEmail = team.members[0]?.user.email;

      if (ownerEmail) {
        premiumGranted({ to: ownerEmail, teamName: team.name, endsAt }).catch((err) =>
          logger.error("premium grant email failed", { err, teamId }),
        );
      }

      logger.info(
        `Admin MCP: gifted Pro to team ${teamId} (${forever ? "forever" : `${durationDays}d`}) by ${
          adminUserId ?? "static-token"
        }`,
      );

      return ok({
        ok: true,
        forever,
        endsAt,
        ownerNotified: !!ownerEmail,
        subscription,
      });
    },
  );

  // @ts-ignore
  server.registerTool(
    "revoke_pro_subscription",
    {
      description:
        "Revoke an admin Pro grant for a team. Refuses to touch real Lemon Squeezy subscriptions — " +
        "those must be cancelled in Lemon Squeezy.",
      inputSchema: {
        teamId: z.string().describe("Id of the team whose admin grant should be revoked."),
      },
    },
    async ({ teamId }) => {
      const existing = await prisma.subscription.findUnique({ where: { teamId } });
      if (!existing) return fail("Team has no subscription.");

      if (!isAdminGrant(existing)) {
        return fail("This is a real paid subscription. Cancel it in Lemon Squeezy instead.");
      }

      await prisma.subscription.delete({ where: { teamId } });
      logger.info(`Admin MCP: revoked Pro grant for team ${teamId} by ${adminUserId ?? "static-token"}`);

      return ok({ ok: true });
    },
  );
}
