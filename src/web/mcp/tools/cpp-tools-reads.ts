import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appNotFound,
  appNotFoundWithListApps,
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  jsonResult,
  mcpToolMessages,
  textResult,
  verifyMcpAppAccess,
} from "./shared";
import { isEditableCppVersionState } from "../../../services/utils/custom-product-pages";

export function registerCppReadTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_cpp_pages",
    {
      description:
        "List Custom Product Pages (CPPs) for an app, with each page's versions and whether each version is " +
        "editable. Use this to find a pageId/versionId before calling add_cpp_locale, " +
        "update_cpp_promotional_text, add_cpp_screenshots_from_studio_job, or submit_cpp_version_for_review. " +
        "Use list_apps first to find available bundle IDs.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Falls back to the user's default app if omitted."),
      },
    },
    async ({ bundleId }: { bundleId?: string }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      if (!resolvedBundleId) {
        return textResult(mcpToolMessages.noBundleIdProvidedWithDefault);
      }

      const app = await verifyMcpAppAccess(userId, resolvedBundleId);

      if (!app) {
        return textResult(appNotFoundWithListApps(resolvedBundleId));
      }

      try {
        const asc = await createAscClient(settings);
        const ascApp = await asc.getApp(resolvedBundleId);

        if (!ascApp) {
          return textResult(appNotFound(resolvedBundleId));
        }

        const pages = await asc.listCustomProductPages(ascApp.id);
        const result = await Promise.all(
          pages.map(async (page) => {
            const versions = await asc.listCustomProductPageVersions(page.id).catch(() => []);

            return {
              id: page.id,
              name: page.attributes.name,
              url: page.attributes.url ?? null,
              visible: page.attributes.visible ?? null,
              versions: versions.map((v) => ({
                id: v.id,
                version: v.attributes.version ?? null,
                state: v.attributes.state ?? null,
                deepLink: v.attributes.deepLink ?? null,
                isEditable: isEditableCppVersionState(v.attributes.state),
              })),
            };
          }),
        );

        return jsonResult({ pages: result });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_cpp_localizations",
    {
      description:
        "List a Custom Product Page version's locales, each with its promotional text and a compact summary of " +
        "its screenshot sets (per-displayType screenshot id/fileName/ready state, not full image URLs). Use this " +
        "to check what's already set up before calling add_cpp_locale, update_cpp_promotional_text, " +
        "add_cpp_screenshots_from_studio_job, or delete_cpp_screenshot. Get versionId from list_cpp_pages.",
      inputSchema: {
        versionId: z.string().describe("Custom Product Page version ID, from list_cpp_pages."),
      },
    },
    async ({ versionId }: { versionId: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);
        const localizations = await asc.listCustomProductPageLocalizations(versionId);

        const result = await Promise.all(
          localizations.map(async (loc) => {
            const sets = await asc.listCustomProductPageScreenshotSets(loc.id);
            const screenshotSets = await Promise.all(
              sets.map(async (set) => {
                const shots = await asc.listScreenshotsInSet(set.id);

                return {
                  displayType: set.attributes.screenshotDisplayType,
                  screenshots: shots.map((shot) => ({
                    id: shot.id,
                    fileName: shot.attributes.fileName ?? null,
                    ready: shot.attributes.assetDeliveryState?.state === "COMPLETE",
                  })),
                };
              }),
            );

            return {
              id: loc.id,
              locale: loc.attributes.locale,
              promotionalText: loc.attributes.promotionalText ?? "",
              screenshotSets,
            };
          }),
        );

        result.sort((a, b) => a.locale.localeCompare(b.locale));

        return jsonResult({ versionId, localizations: result });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );
}
