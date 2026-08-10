import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import {
  appNotFound,
  appNotFoundWithListApps,
  getMcpAllowedAppIds,
  getMcpUserTeamId,
  getSettingsWithBundleId,
  mcpToolMessages,
  verifyMcpAppAccess,
} from "./shared";

export function registerAppTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_apps",
    {
      description:
        "List all apps managed in Marteso. Returns bundle IDs, names, and key metrics. " +
        "Always call this first to discover available bundle IDs before using other tools.",
      inputSchema: {
        ownOnly: z
          .boolean()
          .default(true)
          .describe(
            "When true (default) returns only your own apps. Set false to include tracked competitor apps too.",
          ),
      },
    },
    async ({ ownOnly }) => {
      const teamId = await getMcpUserTeamId(userId);
      if (!teamId) {
        return {
          content: [{ type: "text", text: "[]" }],
        };
      }
      const allowedAppIds = await getMcpAllowedAppIds(userId, teamId);
      const apps = await prisma.app.findMany({
        where: {
          teamId,
          ...(ownOnly ? { isOwnApp: true } : {}),
          ...(allowedAppIds ? { id: { in: allowedAppIds } } : {}),
        },
        include: {
          snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
          _count: { select: { rankings: true, competitors: true } },
        },
        orderBy: [{ isOwnApp: "desc" }, { name: "asc" }],
      });

      const result = apps.map((a) => ({
        bundleId: a.bundleId,
        name: a.name,
        isOwnApp: a.isOwnApp,
        country: a.country,
        title: a.currentTitle,
        subtitle: a.currentSubtitle,
        rating: a.snapshots[0]?.rating ?? null,
        ratingsCount: a.snapshots[0]?.ratingsCount ?? null,
        iconUrl: a.snapshots[0]?.iconUrl ?? null,
        trackedKeywords: a._count.rankings,
        competitors: a._count.competitors,
        lastScraped: a.snapshots[0]?.scrapedAt ?? null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_app_info",
    {
      description:
        "Get current ASO metadata (title, subtitle, keywords, description) for a specific app. " +
        "Use list_apps first to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Falls back to the user's default app if omitted.",
          ),
      },
    },
    async ({ bundleId }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
      if (!resolvedBundleId) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.noBundleIdProvidedWithDefault,
            },
          ],
        };
      }

      const accessCheck = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!accessCheck) {
        return {
          content: [
            {
              type: "text",
              text: appNotFoundWithListApps(resolvedBundleId),
            },
          ],
        };
      }
      const app = await prisma.app.findUnique({
        where: { bundleId: resolvedBundleId },
        include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
      });

      if (!app) {
        return {
          content: [
            {
              type: "text",
              text: appNotFoundWithListApps(resolvedBundleId),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                bundleId: app.bundleId,
                name: app.name,
                isOwnApp: app.isOwnApp,
                country: app.country,
                title: app.currentTitle,
                subtitle: app.currentSubtitle,
                keywords: app.currentKeywords,
                description: app.currentDescription,
                rating: app.snapshots[0]?.rating ?? null,
                ratingsCount: app.snapshots[0]?.ratingsCount ?? null,
                version: app.snapshots[0]?.version ?? null,
                lastScraped: app.snapshots[0]?.scrapedAt ?? null,
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
    "get_versions",
    {
      description:
        "Get version history for an app from scraped App Store snapshots. " +
        "Returns version number, release notes, and when each version was first detected. " +
        "Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Max versions to return (default 10, max 50)"),
      },
    },
    async ({ bundleId, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
      if (!resolvedBundleId) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.noBundleIdProvidedWithDefault,
            },
          ],
        };
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);

      if (!app) {
        return {
          content: [
            {
              type: "text",
              text: appNotFoundWithListApps(resolvedBundleId),
            },
          ],
        };
      }

      const snapshots = await prisma.appSnapshot.findMany({
        where: { appId: app.id, version: { not: null } },
        orderBy: { scrapedAt: "desc" },
        select: { version: true, releaseNotes: true, scrapedAt: true },
      });

      const seen = new Set<string>();
      const versions: {
        version: string;
        releaseNotes: string | null;
        firstDetectedAt: Date;
      }[] = [];

      for (const s of snapshots) {
        if (s.version && !seen.has(s.version)) {
          seen.add(s.version);
          versions.push({
            version: s.version,
            releaseNotes: s.releaseNotes ?? null,
            firstDetectedAt: s.scrapedAt,
          });
          if (versions.length >= limit) break;
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(versions, null, 2) }],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_keywords",
    {
      description:
        "Get tracked keywords with current App Store rankings, popularity scores, and difficulty for an app. " +
        "Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(2000)
          .describe("Max keywords to return (default 2000, max 2000)"),
      },
    },
    async ({ bundleId, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
      if (!resolvedBundleId) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.noBundleIdProvidedWithDefault,
            },
          ],
        };
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);

      if (!app) {
        return {
          content: [
            {
              type: "text",
              text: appNotFoundWithListApps(resolvedBundleId),
            },
          ],
        };
      }

      const keywords = await prisma.keyword.findMany({
        where: { rankings: { some: { appId: app.id } } },
        include: {
          rankings: {
            where: { appId: app.id },
            orderBy: { trackedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { popularity: "desc" },
        take: limit,
      });

      const result = keywords.map((k) => ({
        term: k.term,
        country: k.country,
        popularity: k.popularity,
        difficulty: k.difficulty,
        searchVolume: k.searchVolume,
        rank: k.rankings?.[0]?.rank ?? null,
        trackedAt: k.rankings?.[0]?.trackedAt ?? null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "bulk_remove_keywords",
    {
      description:
        "Remove multiple tracked keywords for an app at once, e.g. to clean up irrelevant or low-value terms. " +
        "This deletes the keyword globally (all apps tracking it lose its ranking history), same as removing a keyword in the Keywords UI. " +
        "Use get_keywords first to see which terms are tracked for this app.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
        terms: z
          .array(z.string())
          .min(1)
          .max(500)
          .describe(
            "Keyword terms to remove, as returned by get_keywords (e.g. ['fitness tracker', 'workout planner']).",
          ),
        country: z
          .string()
          .optional()
          .describe(
            "Restrict removal to keywords tracked under this country code (e.g. 'US'). Matches any country if omitted.",
          ),
      },
    },
    async ({ bundleId, terms, country }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
      if (!resolvedBundleId) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.noBundleIdProvidedWithDefault,
            },
          ],
        };
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!app) {
        return {
          content: [
            { type: "text", text: appNotFoundWithListApps(resolvedBundleId) },
          ],
        };
      }

      const keywords = await prisma.keyword.findMany({
        where: {
          term: { in: terms },
          ...(country ? { country } : {}),
          rankings: { some: { appId: app.id } },
        },
        select: { id: true, term: true, country: true },
      });

      if (keywords.length > 0) {
        await prisma.keyword.deleteMany({
          where: { id: { in: keywords.map((k) => k.id) } },
        });
      }

      const removedTerms = new Set(keywords.map((k) => k.term));
      const notFound = terms.filter((t) => !removedTerms.has(t));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                removed: keywords.map((k) => ({
                  term: k.term,
                  country: k.country,
                })),
                removedCount: keywords.length,
                notFound,
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
    "get_competitors",
    {
      description:
        "Get competitor apps tracked for an app, including ratings, relevance scores, and latest metadata. " +
        "Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
      },
    },
    async ({ bundleId }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );

      if (!resolvedBundleId) {
        return {
          content: [
            { type: "text", text: mcpToolMessages.noBundleIdConfigured },
          ],
        };
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);

      if (!app) {
        return {
          content: [{ type: "text", text: appNotFound(resolvedBundleId) }],
        };
      }

      const rels = await prisma.competitorRelation.findMany({
        where: { appId: app.id },
        include: {
          competitor: {
            include: {
              snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
            },
          },
        },
      });

      const result = rels.map((r) => ({
        bundleId: r.competitor.bundleId,
        name: r.competitor.name,
        rating: r.competitor.snapshots[0]?.rating ?? null,
        ratingsCount: r.competitor.snapshots[0]?.ratingsCount ?? null,
        title: r.competitor.snapshots[0]?.title ?? null,
        relevanceScore: r.relevanceScore,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

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
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
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
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
      if (!resolvedBundleId) {
        return {
          content: [
            { type: "text", text: mcpToolMessages.noBundleIdConfigured },
          ],
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
    "get_reviews",
    {
      description:
        "Get App Store reviews for an app. Returns rating, title, body, territory, and review date. " +
        "Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe(
            "App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted.",
          ),
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
          .describe(
            "Filter by territory code, e.g. 'DEU', 'USA'. Returns all territories if omitted.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max reviews to return (default 50, max 200)"),
      },
    },
    async ({ bundleId, minRating, maxRating, territory, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(
        userId,
        bundleId,
      );
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
