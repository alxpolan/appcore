import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  couldNotResolveAscAppId,
  createAscClient,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
  resolveAscAppId,
} from "./shared";
import { evaluateLocalizationQuality, isFirstVersionLocalizationSet } from "../../lib/localization-quality";

export function registerAscReadTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_versions",
    {
      description:
        "List all App Store Connect versions for an app with their states (e.g. READY_FOR_SALE, PREPARE_FOR_SUBMISSION, IN_REVIEW). " +
        "Use this to discover versionId values for get_version_metadata and update_version_metadata.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
      },
    },
    async ({ bundleId }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!hasAscCredentials(settings)) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.appStoreConnectCredentialsNotConfiguredInSettings,
            },
          ],
        };
      }

      try {
        const asc = await createAscClient(settings);
        const ascAppId = await resolveAscAppId(asc, settings, resolvedBundleId);

        if (!ascAppId) {
          return {
            content: [{ type: "text", text: couldNotResolveAscAppId(resolvedBundleId) }],
          };
        }

        const versions = await asc.listVersions(ascAppId);
        const result = versions.map((v: any) => ({
          versionId: v.id,
          versionString: v.attributes?.versionString,
          appStoreState: v.attributes?.appStoreState,
          platform: v.attributes?.platform,
          isEditable: [
            "PREPARE_FOR_SUBMISSION",
            "DEVELOPER_REJECTED",
            "REJECTED",
            "METADATA_REJECTED",
            "WAITING_FOR_REVIEW",
          ].includes(v.attributes?.appStoreState),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `ASC error: ${err?.message ?? String(err)}` }],
        };
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_version_metadata",
    {
      description:
        "Get full App Store Connect metadata for a version across all locales. " +
        "Returns name, subtitle, keywords, description, whatsNew (release notes), and promotionalText per locale. " +
        "Use list_app_versions to get a versionId, or omit it to use the current editable version.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        versionId: z
          .string()
          .optional()
          .describe("ASC version ID from list_app_versions. Uses the current editable version if omitted."),
        locale: z
          .string()
          .optional()
          .describe("Return only this locale (e.g. 'en-US', 'de-DE'). Returns all locales if omitted."),
      },
    },
    async ({ bundleId, versionId, locale }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!hasAscCredentials(settings)) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.appStoreConnectCredentialsNotConfigured,
            },
          ],
        };
      }

      try {
        const asc = await createAscClient(settings);
        const ascAppId = await resolveAscAppId(asc, settings, resolvedBundleId);

        if (!ascAppId) {
          return {
            content: [{ type: "text", text: couldNotResolveAscAppId(resolvedBundleId) }],
          };
        }

        let resolvedVersionId = versionId;

        if (!resolvedVersionId) {
          const editable = await asc.getEditableVersion(ascAppId);

          if (!editable) {
            return {
              content: [
                {
                  type: "text",
                  text: mcpToolMessages.noEditableVersionFound,
                },
              ],
            };
          }

          resolvedVersionId = editable.id;
        }

        const [appInfoLocs, versionLocs] = await Promise.all([
          asc.getAppInfoLocalizations(ascAppId).catch(() => [] as any[]),
          asc.getVersionLocalizations(resolvedVersionId, locale).catch(() => [] as any[]),
        ]);

        const appInfoByLocale: Record<string, any> = {};
        for (const l of appInfoLocs) {
          const loc = l.attributes.locale;

          appInfoByLocale[loc] = l;
        }

        const localeMap: Record<string, any> = {};
        for (const l of versionLocs) {
          const loc = l.attributes.locale;
          if (locale && loc !== locale) continue;

          const appInfo = appInfoByLocale[loc];

          localeMap[loc] = {
            locale: loc,
            appInfoLocalizationId: appInfo?.id ?? null,
            name: appInfo?.attributes?.name ?? null,
            subtitle: appInfo?.attributes?.subtitle ?? null,
            privacyPolicyUrl: appInfo?.attributes?.privacyPolicyUrl ?? null,
            versionLocalizationId: l.id,
            description: l.attributes?.description ?? null,
            keywords: l.attributes?.keywords ?? null,
            whatsNew: l.attributes?.whatsNew ?? null,
            promotionalText: l.attributes?.promotionalText ?? null,
            supportUrl: l.attributes?.supportUrl ?? null,
            marketingUrl: l.attributes?.marketingUrl ?? null,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  versionId: resolvedVersionId,
                  localizations: Object.values(localeMap),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `ASC error: ${err?.message ?? String(err)}` }],
        };
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "check_localization_quality",
    {
      description:
        "Check App Store submission readiness and keyword optimization for every locale of a version — the same green/yellow/gray verdict the Versions UI shows. " +
        "Use this after editing metadata to confirm your changes landed and to see which locales are still 'yellow' (submittable but not keyword-optimized) and exactly why. " +
        "Each locale gets a status: 'optimal' (green — submittable and keywords well-used), 'non_optimal' (yellow — submittable but keyword field is weak: budget underused, keywords duplicated, or already indexed via title/subtitle), or 'incomplete' (gray — required fields missing, not submittable). " +
        "Omit versionId to use the current editable version.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        versionId: z
          .string()
          .optional()
          .describe("ASC version ID from list_app_versions. Uses the current editable version if omitted."),
        locale: z
          .string()
          .optional()
          .describe("Check only this locale (e.g. 'ja', 'de-DE'). Checks all locales if omitted."),
      },
    },
    async ({ bundleId, versionId, locale }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!hasAscCredentials(settings)) {
        return {
          content: [
            {
              type: "text",
              text: mcpToolMessages.appStoreConnectCredentialsNotConfigured,
            },
          ],
        };
      }

      try {
        const asc = await createAscClient(settings);
        const ascAppId = await resolveAscAppId(asc, settings, resolvedBundleId);

        if (!ascAppId) {
          return {
            content: [{ type: "text", text: couldNotResolveAscAppId(resolvedBundleId) }],
          };
        }

        let resolvedVersionId = versionId;

        if (!resolvedVersionId) {
          const editable = await asc.getEditableVersion(ascAppId);

          if (!editable) {
            return {
              content: [{ type: "text", text: mcpToolMessages.noEditableVersionFound }],
            };
          }

          resolvedVersionId = editable.id;
        }

        const [appInfoLocs, versionLocs] = await Promise.all([
          asc.getAppInfoLocalizations(ascAppId).catch(() => [] as any[]),
          asc.getVersionLocalizations(resolvedVersionId).catch(() => [] as any[]),
        ]);

        const appInfoByLocale: Record<string, any> = {};
        for (const l of appInfoLocs) {
          const loc = l.attributes.locale;

          appInfoByLocale[loc] = l;
        }

        const merged = versionLocs.map((l) => {
          const loc = l.attributes.locale;
          const appInfo = appInfoByLocale[loc];

          return {
            locale: loc,
            name: appInfo?.attributes?.name ?? "",
            subtitle: appInfo?.attributes?.subtitle ?? "",
            privacyPolicyUrl: appInfo?.attributes?.privacyPolicyUrl ?? "",
            description: l.attributes?.description ?? "",
            keywords: l.attributes?.keywords ?? "",
            whatsNew: l.attributes?.whatsNew ?? "",
            promotionalText: l.attributes?.promotionalText ?? "",
            supportUrl: l.attributes?.supportUrl ?? "",
            marketingUrl: l.attributes?.marketingUrl ?? "",
          };
        });

        const isFirstVersion = isFirstVersionLocalizationSet(merged);
        const evaluated = merged
          .filter((m) => !locale || m.locale === locale)
          .map((m) => {
            const q = evaluateLocalizationQuality(m, isFirstVersion);

            return {
              locale: q.locale,
              status: q.status,
              isComplete: q.isComplete,
              isOptimal: q.isOptimal,
              keywordChars: q.keywords.used,
              keywordLimit: q.keywords.max,
              missingFields: q.missingFields,
              redundantKeywords: q.keywords.overlaps,
              duplicateKeywords: q.keywords.duplicates,
              reasons: q.reasons,
            };
          })
          .sort((a, b) => a.locale.localeCompare(b.locale));

        const summary = {
          total: evaluated.length,
          optimal: evaluated.filter((e) => e.status === "optimal").length,
          nonOptimal: evaluated.filter((e) => e.status === "non_optimal").length,
          incomplete: evaluated.filter((e) => e.status === "incomplete").length,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  versionId: resolvedVersionId,
                  legend: {
                    optimal: "green — submittable and keywords well-optimized",
                    non_optimal: "yellow — submittable but keyword field is weak",
                    incomplete: "gray — required fields missing, not submittable",
                  },
                  summary,
                  locales: evaluated,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `ASC error: ${err?.message ?? String(err)}` }],
        };
      }
    },
  );
}
