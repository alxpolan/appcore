import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import {
  appNotFound,
  getSettingsWithBundleId,
  mcpToolMessages,
  verifyMcpAppAccess,
} from "./shared";

export function registerAppInsightsTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "get_analytics",
    {
      description:
        "Get downloads, updates, revenue, impressions, page views, taps, and sessions summary for an app over a configurable date range. " +
        "Use list_apps to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe("Number of days to look back (default 30, max 365)"),
      },
    },
    async ({ bundleId, days }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdConfigured }],
        };
      }

      if (!(await verifyMcpAppAccess(userId, resolvedBundleId))) {
        return {
          content: [{ type: "text", text: appNotFound(resolvedBundleId) }],
        };
      }

      const since = new Date();

      since.setDate(since.getDate() - days);

      const [downloadAgg, reviewAgg] = await Promise.all([
        prisma.appStoreAnalytics.aggregate({
          where: { bundleId: resolvedBundleId, reportDate: { gte: since } },
          _sum: {
            downloads: true,
            proceeds: true,
            updates: true,
            impressions: true,
            pageViews: true,
            taps: true,
            sessions: true,
          },
        }),
        prisma.appReview.aggregate({
          where: { bundleId: resolvedBundleId },
          _avg: { rating: true },
          _count: { id: true },
        }),
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                bundleId: resolvedBundleId,
                periodDays: days,
                since: since.toISOString().split("T")[0],
                totalDownloads: downloadAgg._sum.downloads ?? 0,
                totalUpdates: downloadAgg._sum.updates ?? 0,
                totalProceedsUsd: downloadAgg._sum.proceeds ?? 0,
                totalImpressions: downloadAgg._sum.impressions ?? 0,
                totalPageViews: downloadAgg._sum.pageViews ?? 0,
                totalTaps: downloadAgg._sum.taps ?? 0,
                totalSessions: downloadAgg._sum.sessions ?? 0,
                avgRating: reviewAgg._avg.rating ?? null,
                totalReviews: reviewAgg._count.id,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_analytics_by_platform",
    {
      description:
        "Get impressions, page views, taps, and sessions broken down by major iOS version for an app over a configurable date range. " +
        "Useful for spotting whether an old iOS version (e.g. app dropped support) is losing impressions without converting to taps/downloads. " +
        "Note: Apple does not report actual downloads broken down by iOS version, only engagement/usage metrics. " +
        "Use list_apps to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe("Number of days to look back (default 30, max 365)"),
      },
    },
    async ({ bundleId, days }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdConfigured }],
        };
      }

      if (!(await verifyMcpAppAccess(userId, resolvedBundleId))) {
        return {
          content: [{ type: "text", text: appNotFound(resolvedBundleId) }],
        };
      }

      const since = new Date();

      since.setDate(since.getDate() - days);

      const rows = await prisma.appStoreAnalyticsPlatform.findMany({
        where: { bundleId: resolvedBundleId, reportDate: { gte: since } },
      });

      const byVersionMap: Record<
        string,
        { iosVersion: string; impressions: number; pageViews: number; taps: number; sessions: number }
      > = {};

      for (const r of rows) {
        const major = r.platformVersion.match(/^iOS (\d+)/)?.[1];
        const iosVersion = major ? `iOS ${major}` : r.platformVersion || "Unknown";
        const v = (byVersionMap[iosVersion] ??= {
          iosVersion,
          impressions: 0,
          pageViews: 0,
          taps: 0,
          sessions: 0,
        });

        v.impressions += r.impressions;
        v.pageViews += r.pageViews;
        v.taps += r.taps;
        v.sessions += r.sessions;
      }

      const byVersion = Object.values(byVersionMap)
        .map((v) => ({ ...v, tapRatePct: v.impressions > 0 ? (v.taps / v.impressions) * 100 : null }))
        .sort((a, b) => b.impressions + b.sessions - (a.impressions + a.sessions));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                bundleId: resolvedBundleId,
                periodDays: days,
                since: since.toISOString().split("T")[0],
                byVersion,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_purchases",
    {
      description:
        "Get recent in-app purchase / subscription transactions for an app, sourced from App Store Connect's COMMERCE report. " +
        "Returns product name, payment method, territory, quantity, and proceeds per transaction — more granular than get_analytics' aggregate revenue. " +
        "Use list_apps to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max number of transactions to return (default 50, max 200), most recent first."),
      },
    },
    async ({ bundleId, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdConfigured }],
        };
      }

      if (!(await verifyMcpAppAccess(userId, resolvedBundleId))) {
        return {
          content: [{ type: "text", text: appNotFound(resolvedBundleId) }],
        };
      }

      const rows = await prisma.appStoreCommercePurchase.findMany({
        where: { bundleId: resolvedBundleId },
        orderBy: { reportDate: "desc" },
        take: limit,
        select: {
          reportDate: true,
          purchaseType: true,
          contentName: true,
          paymentMethod: true,
          territory: true,
          purchases: true,
          proceedsUsd: true,
          salesUsd: true,
          payingUsers: true,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                bundleId: resolvedBundleId,
                transactions: rows.map((r) => ({
                  date: r.reportDate.toISOString().slice(0, 10),
                  purchaseType: r.purchaseType,
                  contentName: r.contentName,
                  paymentMethod: r.paymentMethod,
                  territory: r.territory,
                  purchases: r.purchases,
                  proceedsUsd: r.proceedsUsd,
                  salesUsd: r.salesUsd,
                  payingUsers: r.payingUsers,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_reviews",
    {
      description:
        "Get App Store reviews for an app. Returns rating, title, body, territory, and review date. " +
        "Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        minRating: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Only return reviews at or above this star rating (1-5)."),
        maxRating: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Only return reviews at or below this star rating (1-5)."),
        territory: z
          .string()
          .optional()
          .describe("Filter by territory code, e.g. 'DEU', 'USA'. Returns all territories if omitted."),
        limit: z.number().int().min(1).max(200).default(50).describe("Max reviews to return (default 50, max 200)"),
      },
    },
    async ({ bundleId, minRating, maxRating, territory, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.noBundleIdProvided,
            },
          ],
        };
      }

      if (!(await verifyMcpAppAccess(userId, resolvedBundleId))) {
        return {
          content: [{ type: "text", text: appNotFound(resolvedBundleId) }],
        };
      }

      const where: Record<string, any> = { bundleId: resolvedBundleId };

      if (minRating !== undefined || maxRating !== undefined) {
        where.rating = {};
        if (minRating !== undefined) where.rating.gte = minRating;
        if (maxRating !== undefined) where.rating.lte = maxRating;
      }

      if (territory) where.territory = territory;

      const reviews = await prisma.appReview.findMany({
        where,
        orderBy: { reviewedAt: "desc" },
        take: limit,
      });

      const result = reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        reviewer: r.reviewerNickname,
        territory: r.territory,
        reviewedAt: r.reviewedAt,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
