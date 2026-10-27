import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../../../config";
import {
  appNotFoundWithListApps,
  getMcpAllowedAppIds,
  getMcpUserTeamId,
  getSettingsWithBundleId,
  mcpToolMessages,
  verifyMcpAppAccess,
} from "./shared";

export function registerAppCatalogTools(server: McpServer, userId: string) {
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
}
