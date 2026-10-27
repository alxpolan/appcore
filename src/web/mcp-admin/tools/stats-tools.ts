import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import { ok } from "./shared";

export function registerStatsTools(server: McpServer, _adminUserId: string | null) {
  // @ts-ignore
  server.registerTool(
    "get_platform_stats",
    {
      description:
        "High-level platform metrics for the CEO dashboard: total users, teams, apps, keywords, " +
        "AI suggestions, reviews, active subscriptions, plus new-user and new-app counts over a " +
        "recent window. Call this first for a state-of-the-business overview.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe("Window (in days) for the 'recent' growth counts."),
      },
    },
    async ({ days }) => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        users,
        teams,
        apps,
        ownApps,
        keywords,
        suggestions,
        reviews,
        activeSubscriptions,
        admins,
        newUsers,
        newApps,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.team.count(),
        prisma.app.count(),
        prisma.app.count({ where: { isOwnApp: true } }),
        prisma.keyword.count(),
        prisma.aSOSuggestion.count(),
        prisma.appReview.count(),
        prisma.subscription.count({ where: { status: "active" } }),
        prisma.user.count({ where: { role: "ADMIN" } }),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.app.count({ where: { createdAt: { gte: since } } }),
      ]);

      return ok({
        totals: { users, admins, teams, apps, ownApps, keywords, suggestions, reviews, activeSubscriptions },
        window: { days, since: since.toISOString(), newUsers, newApps },
      });
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_user_growth",
    {
      description:
        "Daily new-user counts over the last N days, for plotting signup growth. Returns an " +
        "array of { date, count }.",
      inputSchema: {
        days: z.number().int().min(1).max(365).default(30).describe("Number of days to include."),
      },
    },
    async ({ days }) => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const rows = await prisma.$queryRaw<{ day: Date; count: number }[]>`
        SELECT DATE_TRUNC('day', "createdAt") as day, COUNT(*)::int as count
        FROM "User"
        WHERE "createdAt" >= ${since}
        GROUP BY day ORDER BY day ASC
      `;
      
      const data = rows.map((r) => ({
        date: (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().split("T")[0],
        count: Number(r.count),
      }));

      return ok({ days, data });
    },
  );
}
