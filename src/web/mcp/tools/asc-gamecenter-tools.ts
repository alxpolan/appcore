import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  couldNotResolveAscAppId,
  createAscClient,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

function ascError(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `ASC error: ${err?.message ?? String(err)}`,
      },
    ],
  };
}

function credentialsMissing() {
  return {
    content: [
      {
        type: "text" as const,
        text: mcpToolMessages.appStoreConnectCredentialsNotConfigured,
      },
    ],
  };
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function getGameCenterDetailId(asc: any, appId: string): Promise<string | null> {
  try {
    const { data: resp } = await asc.client.get(`/apps/${appId}/gameCenterDetail`);
    return resp.data?.id ?? null;
  } catch {
    return null;
  }
}

export function registerAscGameCenterTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_asc_leaderboards",
    {
      description:
        "List all Game Center leaderboards for an app. " +
        "Returns leaderboard IDs, reference names, vendor identifiers, score format, sort order, submission type, and archived status. " +
        "Use this to discover leaderboardId values for other leaderboard tools.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
      },
    },
    async ({ bundleId }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(resolvedBundleId);
        if (!app) {
          return {
            content: [
              {
                type: "text",
                text: couldNotResolveAscAppId(resolvedBundleId),
              },
            ],
          };
        }

        const gcDetailId = await getGameCenterDetailId(asc, app.id);
        if (!gcDetailId) {
          return json({ leaderboards: [], gcEnabled: false });
        }

        const { data: resp } = await asc.client.get(`/gameCenterDetails/${gcDetailId}/gameCenterLeaderboards`, {
          params: {
            "fields[gameCenterLeaderboards]":
              "referenceName,vendorIdentifier,defaultFormatter,archived,scoreSortType,submissionType",
            limit: 200,
          },
        });

        return json({
          gcDetailId,
          gcEnabled: true,
          leaderboards: (resp.data ?? []).map((lb: any) => ({
            id: lb.id,
            referenceName: lb.attributes?.referenceName ?? "",
            vendorIdentifier: lb.attributes?.vendorIdentifier ?? "",
            defaultFormatter: lb.attributes?.defaultFormatter ?? "INTEGER",
            archived: lb.attributes?.archived ?? false,
            scoreSortType: lb.attributes?.scoreSortType ?? "HIGH_TO_LOW",
            submissionType: lb.attributes?.submissionType ?? "INDIVIDUAL",
          })),
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_asc_leaderboard",
    {
      description:
        "Create a new Game Center leaderboard for an app. " +
        "Call list_asc_leaderboards first to get the gcDetailId needed for creation.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        gcDetailId: z.string().describe("Game Center detail ID from list_asc_leaderboards."),
        referenceName: z.string().describe("Internal reference name for the leaderboard."),
        vendorIdentifier: z
          .string()
          .describe(
            "Unique vendor identifier for the leaderboard (e.g. 'com.example.myapp.scores'). Cannot be changed after creation.",
          ),
        defaultFormatter: z
          .enum([
            "INTEGER",
            "DECIMAL_POINT_ONE_DIGIT",
            "DECIMAL_POINT_TWO_DIGITS",
            "DECIMAL_POINT_THREE_DIGITS",
            "TIME_DURATION",
            "ELAPSED_TIME_MINUTE_SECOND",
            "ELAPSED_TIME_HOUR_MINUTE_SECOND",
            "COMPLETED_CHALLENGES",
            "COMPLETED_UNITS",
            "POINTS",
            "SECONDS",
            "CENTISECONDS",
            "MILLISECONDS",
            "YARDS",
            "FEET_AND_INCHES",
            "METERS",
            "KILOMETERS",
            "MILES",
            "FIXED_POINT_ONE_FRACTION_DIGIT",
            "FIXED_POINT_TWO_FRACTION_DIGITS",
            "FIXED_POINT_THREE_FRACTION_DIGITS",
          ])
          .optional()
          .describe("Score display format. Defaults to INTEGER."),
        scoreSortType: z
          .enum(["HIGH_TO_LOW", "LOW_TO_HIGH"])
          .optional()
          .describe("Whether higher or lower scores rank better. Defaults to HIGH_TO_LOW."),
        submissionType: z
          .enum(["INDIVIDUAL", "BEST"])
          .optional()
          .describe("Whether each submission or only the best score is recorded. Defaults to INDIVIDUAL."),
      },
    },
    async ({
      bundleId,
      gcDetailId,
      referenceName,
      vendorIdentifier,
      defaultFormatter,
      scoreSortType,
      submissionType,
    }) => {
      const { settings } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/gameCenterLeaderboards", {
          data: {
            type: "gameCenterLeaderboards",
            attributes: {
              referenceName,
              vendorIdentifier,
              defaultFormatter: defaultFormatter ?? "INTEGER",
              scoreSortType: scoreSortType ?? "HIGH_TO_LOW",
              submissionType: submissionType ?? "INDIVIDUAL",
            },
            relationships: {
              gameCenterDetail: {
                data: { type: "gameCenterDetails", id: gcDetailId },
              },
            },
          },
        });
        return json({
          id: resp.data.id,
          referenceName: resp.data.attributes?.referenceName ?? referenceName,
          vendorIdentifier: resp.data.attributes?.vendorIdentifier ?? vendorIdentifier,
          defaultFormatter: resp.data.attributes?.defaultFormatter ?? defaultFormatter ?? "INTEGER",
          archived: resp.data.attributes?.archived ?? false,
          scoreSortType: resp.data.attributes?.scoreSortType ?? scoreSortType ?? "HIGH_TO_LOW",
          submissionType: resp.data.attributes?.submissionType ?? submissionType ?? "INDIVIDUAL",
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_asc_leaderboard",
    {
      description:
        "Update an existing Game Center leaderboard's mutable attributes. " +
        "Only referenceName and archived status can be changed after creation.",
      inputSchema: {
        leaderboardId: z.string().describe("Leaderboard ID from list_asc_leaderboards."),
        referenceName: z.string().optional().describe("New internal reference name."),
        archived: z.boolean().optional().describe("Set true to archive or false to unarchive the leaderboard."),
      },
    },
    async ({ leaderboardId, referenceName, archived }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attrs: Record<string, unknown> = {};
        if (referenceName !== undefined) attrs.referenceName = referenceName;
        if (archived !== undefined) attrs.archived = archived;
        await asc.client.patch(`/gameCenterLeaderboards/${leaderboardId}`, {
          data: {
            type: "gameCenterLeaderboards",
            id: leaderboardId,
            attributes: attrs,
          },
        });
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  server.registerTool(
    "delete_asc_leaderboard",
    {
      description: "Delete a Game Center leaderboard. " + "Only leaderboards that have never been live can be deleted.",
      inputSchema: {
        leaderboardId: z.string().describe("Leaderboard ID from list_asc_leaderboards."),
      },
    },
    async ({ leaderboardId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/gameCenterLeaderboards/${leaderboardId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  server.registerTool(
    "list_asc_leaderboard_localizations",
    {
      description:
        "List all localizations for a Game Center leaderboard. " +
        "Returns localization IDs, locale codes, display names, and score suffix strings.",
      inputSchema: {
        leaderboardId: z.string().describe("Leaderboard ID from list_asc_leaderboards."),
      },
    },
    async ({ leaderboardId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/gameCenterLeaderboards/${leaderboardId}/localizations`, {
          params: {
            "fields[gameCenterLeaderboardLocalizations]": "locale,name,formatterSuffix,formatterSuffixSingular",
          },
        });

        return json(
          (resp.data ?? []).map((l: any) => ({
            id: l.id,
            locale: l.attributes?.locale ?? "",
            name: l.attributes?.name ?? "",
            formatterSuffix: l.attributes?.formatterSuffix ?? "",
            formatterSuffixSingular: l.attributes?.formatterSuffixSingular ?? "",
          })),
        );
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  server.registerTool(
    "create_asc_leaderboard_localization",
    {
      description:
        "Add a new localization to a Game Center leaderboard. Each locale (e.g. 'en-US', 'de-DE') can only have one localization.",
      inputSchema: {
        leaderboardId: z.string().describe("Leaderboard ID from list_asc_leaderboards."),
        locale: z.string().describe("BCP 47 locale code (e.g. 'en-US', 'de-DE', 'fr-FR')."),
        name: z.string().describe("Display name shown to players for this locale."),
        formatterSuffix: z.string().optional().describe("Plural suffix appended to the score (e.g. 'points')."),
        formatterSuffixSingular: z
          .string()
          .optional()
          .describe("Singular suffix appended to the score (e.g. 'point')."),
      },
    },
    async ({ leaderboardId, locale, name, formatterSuffix, formatterSuffixSingular }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attrs: Record<string, string> = { locale, name };

        if (formatterSuffix) attrs.formatterSuffix = formatterSuffix;
        if (formatterSuffixSingular) attrs.formatterSuffixSingular = formatterSuffixSingular;

        const { data: resp } = await asc.client.post("/gameCenterLeaderboardLocalizations", {
          data: {
            type: "gameCenterLeaderboardLocalizations",
            attributes: attrs,
            relationships: {
              gameCenterLeaderboard: {
                data: { type: "gameCenterLeaderboards", id: leaderboardId },
              },
            },
          },
        });

        return json({
          id: resp.data.id,
          locale,
          name: resp.data.attributes?.name ?? name,
          formatterSuffix: resp.data.attributes?.formatterSuffix ?? "",
          formatterSuffixSingular: resp.data.attributes?.formatterSuffixSingular ?? "",
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  server.registerTool(
    "update_asc_leaderboard_localization",
    {
      description:
        "Update an existing Game Center leaderboard localization. " +
        "Use list_asc_leaderboard_localizations to get the localizationId.",
      inputSchema: {
        localizationId: z.string().describe("Localization ID from list_asc_leaderboard_localizations."),
        name: z.string().optional().describe("New display name for this locale."),
        formatterSuffix: z.string().optional().describe("New plural suffix (e.g. 'points')."),
        formatterSuffixSingular: z.string().optional().describe("New singular suffix (e.g. 'point')."),
      },
    },
    async ({ localizationId, name, formatterSuffix, formatterSuffixSingular }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const attrs: Record<string, string> = {};

        if (name !== undefined) attrs.name = name;
        if (formatterSuffix !== undefined) attrs.formatterSuffix = formatterSuffix;
        if (formatterSuffixSingular !== undefined) attrs.formatterSuffixSingular = formatterSuffixSingular;

        await asc.client.patch(`/gameCenterLeaderboardLocalizations/${localizationId}`, {
          data: {
            type: "gameCenterLeaderboardLocalizations",
            id: localizationId,
            attributes: attrs,
          },
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  server.registerTool(
    "delete_asc_leaderboard_localization",
    {
      description:
        "Delete a Game Center leaderboard localization. " +
        "Use list_asc_leaderboard_localizations to get the localizationId.",
      inputSchema: {
        localizationId: z.string().describe("Localization ID from list_asc_leaderboard_localizations."),
      },
    },
    async ({ localizationId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        await asc.client.delete(`/gameCenterLeaderboardLocalizations/${localizationId}`);
        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
