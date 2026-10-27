import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import {
  appNotFound,
  appNotFoundWithListApps,
  getSettingsWithBundleId,
  mcpToolMessages,
  verifyMcpAppAccess,
} from "./shared";

export function registerAppCompetitorsTools(server: McpServer, userId: string) {
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
}
