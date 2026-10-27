import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appNotFoundWithListApps,
  couldNotResolveAscAppId,
  createAscClient,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
  resolveAscAppId,
  verifyMcpAppAccess,
} from "./shared";
import { bossScheduler } from "../../../jobs/boss";
import {
  QUEUE_NAME as TRANSLATE_LOCALIZATION_QUEUE,
  type TranslateLocalizationData,
} from "../../../jobs/workers/translate-localization.worker";
import * as translationTracker from "../../../jobs/translation-tracker";

export function registerAscWriteTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "update_version_metadata",
    {
      description:
        "Update a single App Store Connect metadata field for a specific locale. " +
        "App info fields (name, subtitle): pass appInfoLocalizationId. " +
        "Version fields (description, keywords, whatsNew, promotionalText, supportUrl, marketingUrl): pass versionLocalizationId. " +
        "Get these IDs from get_version_metadata.",
      inputSchema: {
        appInfoLocalizationId: z
          .string()
          .optional()
          .describe("ID for app info localization (needed for name, subtitle, privacyPolicyUrl)."),
        versionLocalizationId: z
          .string()
          .optional()
          .describe(
            "ID for version localization (needed for description, keywords, whatsNew, promotionalText, supportUrl, marketingUrl).",
          ),
        field: z
          .string()
          .describe(
            "Which field to update. App info fields: name, subtitle, privacyPolicyUrl. Version fields: description, keywords, whatsNew, promotionalText, supportUrl, marketingUrl.",
          ),
        value: z.string().describe("New value for the field."),
      },
    },
    async ({ appInfoLocalizationId, versionLocalizationId, field, value }) => {
      const { settings } = await getSettingsWithBundleId(userId);

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

        const appInfoFields = ["name", "subtitle", "privacyPolicyUrl"];

        if (appInfoFields.includes(field)) {
          if (!appInfoLocalizationId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Field '${field}' requires appInfoLocalizationId. Get it from get_version_metadata.`,
                },
              ],
            };
          }

          await asc.updateAppInfoLocalization(appInfoLocalizationId, {
            [field]: value,
          });
        } else {
          if (!versionLocalizationId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Field '${field}' requires versionLocalizationId. Get it from get_version_metadata.`,
                },
              ],
            };
          }

          await asc.updateVersionLocalization(versionLocalizationId, {
            [field]: value,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, field, value }, null, 2),
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
    "bulk_translate_locales",
    {
      description:
        "Queue AI translation of a version's metadata (name, subtitle, keywords, description, promotionalText, whatsNew) from one source locale into multiple target locales at once. " +
        "Each target locale must already exist for the version in App Store Connect (use get_version_metadata to see which locales exist) — this fills in existing locales, it doesn't create new ones. " +
        "Translation runs as background jobs and this tool returns immediately; check back with get_version_metadata or check_localization_quality after a short wait to see the results. " +
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
        sourceLocale: z
          .string()
          .optional()
          .describe(
            "Locale to translate from (e.g. 'en-US'). Defaults to 'en-US' if it exists for the version, otherwise the first available locale.",
          ),
        targetLocales: z
          .array(z.string())
          .optional()
          .describe(
            "Locales to translate into (e.g. ['de-DE', 'fr-FR']). Translates into every other existing locale for the version if omitted.",
          ),
      },
    },
    async ({ bundleId, versionId, sourceLocale, targetLocales }) => {
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
          appInfoByLocale[l.attributes?.locale ?? l.locale] = l;
        }

        const versionByLocale: Record<string, any> = {};
        for (const l of versionLocs) {
          versionByLocale[l.attributes?.locale ?? l.locale] = l;
        }

        const allLocales = Object.keys(versionByLocale);
        const resolvedSourceLocale = sourceLocale ?? (allLocales.includes("en-US") ? "en-US" : allLocales[0]);

        if (!resolvedSourceLocale || !versionByLocale[resolvedSourceLocale]) {
          return {
            content: [
              {
                type: "text",
                text: `Source locale not found for this version. Available locales: ${allLocales.join(", ") || "(none)"}`,
              },
            ],
          };
        }

        const sourceVersionLoc = versionByLocale[resolvedSourceLocale];
        const sourceAppInfoLoc = appInfoByLocale[resolvedSourceLocale];

        const sourceFields = {
          name: sourceAppInfoLoc?.attributes?.name ?? undefined,
          subtitle: sourceAppInfoLoc?.attributes?.subtitle ?? undefined,
          keywords: sourceVersionLoc?.attributes?.keywords ?? undefined,
          description: sourceVersionLoc?.attributes?.description ?? undefined,
          promotionalText: sourceVersionLoc?.attributes?.promotionalText ?? undefined,
          whatsNew: sourceVersionLoc?.attributes?.whatsNew ?? undefined,
        };

        const resolvedTargets = (targetLocales ?? allLocales.filter((l) => l !== resolvedSourceLocale)).filter(
          (l) => l !== resolvedSourceLocale,
        );

        const queued: string[] = [];
        const skipped: { locale: string; reason: string }[] = [];

        for (const targetLocale of resolvedTargets) {
          const targetVersionLoc = versionByLocale[targetLocale];

          if (!targetVersionLoc) {
            skipped.push({
              locale: targetLocale,
              reason: "Locale does not exist for this version yet. Create it in App Store Connect first.",
            });
            continue;
          }

          if (translationTracker.isTranslating(resolvedVersionId, targetLocale)) {
            skipped.push({ locale: targetLocale, reason: "Translation already in progress" });
            continue;
          }

          const targetAppInfoLoc = appInfoByLocale[targetLocale];

          translationTracker.add(resolvedVersionId, targetLocale);

          const data: TranslateLocalizationData = {
            teamId: app.teamId!,
            bundleId: resolvedBundleId,
            versionId: resolvedVersionId,
            sourceLocale: resolvedSourceLocale,
            targetLocale,
            appInfoLocalizationId: targetAppInfoLoc?.id ?? null,
            versionLocalizationId: targetVersionLoc.id ?? null,
            sourceFields,
          };

          try {
            await bossScheduler.sendJob(TRANSLATE_LOCALIZATION_QUEUE, data);
            queued.push(targetLocale);
          } catch (err: any) {
            translationTracker.remove(resolvedVersionId, targetLocale);
            skipped.push({ locale: targetLocale, reason: err?.message ?? String(err) });
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  versionId: resolvedVersionId,
                  sourceLocale: resolvedSourceLocale,
                  queued,
                  skipped,
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