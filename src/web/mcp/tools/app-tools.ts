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
        "Call this to discover available bundle IDs before using other tools.",
    },
    async () => {
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
          ...{ isOwnApp: true },
          ...(allowedAppIds ? { id: { in: allowedAppIds } } : {}),
        },
        include: {
          snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
          _count: { select: { rankings: true, competitors: true } },
        },
        orderBy: [{ name: "asc" }],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              apps.map((a) => ({
                bundleId: a.bundleId,
                name: a.name,
                displayName: a.displayName,
                country: a.country,
                title: a.currentTitle,
                subtitle: a.currentSubtitle,
                rating: a.snapshots[0]?.rating ?? null,
                ratingsCount: a.snapshots[0]?.ratingsCount ?? null,
                iconUrl: a.snapshots[0]?.iconUrl ?? null,
                trackedKeywords: a._count.rankings,
                competitors: a._count.competitors,
                lastScraped: a.snapshots[0]?.scrapedAt ?? null,
              })),
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
    "get_app_info",
    {
      description:
        "Get current ASO metadata (title, subtitle, keywords, description) for a specific app. " +
        "Use list_apps first to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Falls back to the user's default app if omitted."),
      },
    },
    async ({ bundleId }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
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
                displayName: app.displayName,
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
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        limit: z.number().int().min(1).max(50).default(10).describe("Max versions to return (default 10, max 50)"),
      },
    },
    async ({ bundleId, limit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      
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
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
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
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
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
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
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
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
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
          content: [{ type: "text", text: appNotFoundWithListApps(resolvedBundleId) }],
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
    "set_display_name",
    {
      description:
        "Set the clean display name shown for an app throughout Marteso's UI (sidebar, app switcher, dashboard), " +
        "overriding its raw, often keyword-stuffed App Store title (e.g. 'CapCut: Video & Photo Editor' -> 'CapCut'). " +
        "Use list_apps or get_app_info first to see the current raw name. Pass an empty string to clear the override " +
        "and fall back to the raw App Store name.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        displayName: z
          .string()
          .max(60)
          .describe("The clean display name to show instead of the raw App Store title. Pass '' to clear it."),
      },
    },
    async ({ bundleId, displayName }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdProvidedWithDefault }],
        };
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!app) {
        return {
          content: [{ type: "text", text: appNotFoundWithListApps(resolvedBundleId) }],
        };
      }

      const trimmed = displayName.trim();
      await prisma.app.update({
        where: { id: app.id },
        data: { displayName: trimmed || null },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, bundleId: resolvedBundleId, displayName: trimmed || null }, null, 2),
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
        "Get competitor apps tracked for an app, including ratings, relevance scores, latest metadata, " +
        "how many languages their listing is localized into, a monetization summary, and AI review sentiment. " +
        "Use get_competitor_detail for the full breakdown (reviews, monetization items, metadata changes, keyword rankings) " +
        "on a single competitor. Use list_apps to find the bundleId first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
      },
    },
    async ({ bundleId }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdConfigured }],
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
              inAppPurchases: { select: { kind: true } },
              reviewSummaries: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { sentiment: true, averageRating: true, reviewCount: true },
              },
            },
          },
        },
      });

      const result = rels.map((r) => {
        const latestSummary = r.competitor.reviewSummaries[0];
        return {
          bundleId: r.competitor.bundleId,
          name: r.competitor.name,
          rating: r.competitor.snapshots[0]?.rating ?? null,
          ratingsCount: r.competitor.snapshots[0]?.ratingsCount ?? null,
          title: r.competitor.snapshots[0]?.title ?? null,
          relevanceScore: r.relevanceScore,
          languagesCount: r.competitor.supportedLanguages.length,
          monetization:
            r.competitor.inAppPurchases.length > 0
              ? {
                  itemCount: r.competitor.inAppPurchases.length,
                  hasSubscription: r.competitor.inAppPurchases.some((p) => p.kind === "subscription"),
                }
              : null,
          aiReviewSummary: latestSummary
            ? {
                sentiment: latestSummary.sentiment,
                averageRating: latestSummary.averageRating,
                reviewCount: latestSummary.reviewCount,
              }
            : null,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_competitor_detail",
    {
      description:
        "Get the full competitive intel Marteso has on a single tracked competitor — everything visible in the " +
        "Competitors dashboard detail view: metadata (subtitle, description, category, version, developer), how many " +
        "languages its App Store listing is localized into, in-app purchase/subscription monetization, recent reviews, " +
        "the AI-generated review summary (strengths, weaknesses, themes, sentiment), recent metadata changes, and keyword " +
        "ranking comparisons against your app. Use get_competitors first to find the competitor's bundle ID.",
      inputSchema: {
        bundleId: z.string().optional().describe("Your app's bundle ID. Uses the user's default app if omitted."),
        competitorBundleId: z.string().describe("The competitor app's bundle ID, from get_competitors."),
        reviewLimit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max recent reviews to include (default 20, max 100)."),
      },
    },
    async ({ bundleId, competitorBundleId, reviewLimit }) => {
      const { resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!resolvedBundleId) {
        return {
          content: [{ type: "text", text: mcpToolMessages.noBundleIdConfigured }],
        };
      }

      const ownApp = await verifyMcpAppAccess(userId, resolvedBundleId);
      if (!ownApp) {
        return { content: [{ type: "text", text: appNotFound(resolvedBundleId) }] };
      }

      const competitor = await prisma.app.findUnique({
        where: { bundleId: competitorBundleId },
        include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
      });

      if (!competitor) {
        return { content: [{ type: "text", text: appNotFound(competitorBundleId) }] };
      }

      const relation = await prisma.competitorRelation.findFirst({
        where: {
          OR: [
            { appId: ownApp.id, competitorId: competitor.id },
            { appId: competitor.id, competitorId: ownApp.id },
          ],
        },
      });

      if (!relation) {
        return {
          content: [
            {
              type: "text",
              text: `${competitorBundleId} is not tracked as a competitor of ${resolvedBundleId}.`,
            },
          ],
        };
      }

      const [reviews, reviewSummary, metadataChanges, inAppPurchases, trackedKeywords] = await Promise.all([
        prisma.competitorReview.findMany({
          where: { appId: competitor.id },
          orderBy: { reviewedAt: "desc" },
          take: reviewLimit,
        }),

        prisma.competitorReviewSummary.findFirst({
          where: { appId: competitor.id },
          orderBy: { createdAt: "desc" },
        }),

        prisma.appMetadataChange.findMany({
          where: { appId: competitor.id },
          orderBy: { detectedAt: "desc" },
          take: 30,
        }),

        prisma.appInAppPurchase.findMany({
          where: { appId: competitor.id },
          orderBy: { position: "asc" },
        }),

        prisma.keyword.findMany({
          where: { rankings: { some: { appId: ownApp.id } } },
          orderBy: { popularity: "desc" },
        }),
      ]);

      const kwIds = trackedKeywords.map((k) => k.id);
      const [compRankings, ownRankings] = await Promise.all([
        prisma.keywordRanking.findMany({
          where: { keywordId: { in: kwIds }, appId: competitor.id },
          orderBy: { trackedAt: "desc" },
          distinct: ["keywordId"],
        }),

        prisma.keywordRanking.findMany({
          where: { keywordId: { in: kwIds }, appId: ownApp.id },
          orderBy: { trackedAt: "desc" },
          distinct: ["keywordId"],
        }),
      ]);

      const compRankMap = new Map(compRankings.map((r) => [r.keywordId, r.rank]));
      const ownRankMap = new Map(ownRankings.map((r) => [r.keywordId, r.rank]));
      const snapshot = competitor.snapshots[0];

      const result = {
        bundleId: competitor.bundleId,
        name: competitor.name,
        country: competitor.country,
        title: competitor.currentTitle,
        subtitle: competitor.currentSubtitle,
        description: competitor.currentDescription,
        rating: snapshot?.rating ?? null,
        ratingsCount: snapshot?.ratingsCount ?? null,
        version: snapshot?.version ?? null,
        developerName: snapshot?.developerName ?? null,
        category: snapshot?.category ?? null,
        languages: competitor.supportedLanguages,
        languagesCount: competitor.supportedLanguages.length,
        monetization: inAppPurchases.map((p) => ({ name: p.name, price: p.price, kind: p.kind })),
        reviews: reviews.map((r) => ({
          rating: r.rating,
          title: r.title,
          body: r.body,
          territory: r.territory,
          reviewedAt: r.reviewedAt,
        })),
        aiReviewSummary: reviewSummary
          ? {
              reviewCount: reviewSummary.reviewCount,
              averageRating: reviewSummary.averageRating,
              summary: reviewSummary.summary,
              strengths: reviewSummary.strengths,
              weaknesses: reviewSummary.weaknesses,
              topThemes: reviewSummary.topThemes,
              sentiment: reviewSummary.sentiment,
              createdAt: reviewSummary.createdAt,
            }
          : null,
        recentMetadataChanges: metadataChanges.map((c) => ({
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          detectedAt: c.detectedAt,
        })),
        keywordRankings: trackedKeywords.map((kw) => ({
          keyword: kw.term,
          popularity: kw.popularity,
          competitorRank: compRankMap.get(kw.id) ?? null,
          ourRank: ownRankMap.get(kw.id) ?? null,
        })),
      };

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
