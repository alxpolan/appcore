import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  appNotFound,
  appNotFoundWithListApps,
  couldNotResolveAscAppId,
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  jsonResult,
  mcpToolMessages,
  registerMutatingTool,
  resolveAscAppId,
  textResult,
  verifyMcpAppAccess,
} from "./shared";
import { isEditableCppVersionState } from "../../../services/utils/custom-product-pages";

export function registerCppWriteTools(server: McpServer, userId: string) {
  registerMutatingTool(
    server,
    userId,
    "create_cpp_page",
    {
      description:
        "Create a new Custom Product Page (CPP) for an app and ensure it has an editable version. Follow up " +
        "with add_cpp_locale to add locales, update_cpp_promotional_text, add_cpp_screenshots_from_studio_job, " +
        "and finally submit_cpp_version_for_review.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        name: z.string().describe("Internal name for the Custom Product Page (not shown to App Store users)."),
      },
    },
    async ({ bundleId, name }: { bundleId?: string; name: string }) => {
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

        const page = await asc.createCustomProductPage(
          ascApp.id,
          name.trim(),
          ascApp.attributes.primaryLocale ?? "en-US",
        );

        let versions = await asc.listCustomProductPageVersions(page.id).catch(() => []);

        if (versions.length === 0) {
          versions = [await asc.createCustomProductPageVersion(page.id)];
        }

        return jsonResult({
          id: page.id,
          name: page.attributes.name,
          url: page.attributes.url ?? null,
          versions: versions.map((v) => ({
            id: v.id,
            version: v.attributes.version ?? null,
            state: v.attributes.state ?? null,
            isEditable: isEditableCppVersionState(v.attributes.state),
          })),
        });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_cpp_page",
    {
      description: "Delete a Custom Product Page entirely, including every version, locale, and screenshot on it.",
      inputSchema: {
        pageId: z.string().describe("Custom Product Page ID to delete, from list_cpp_pages."),
      },
    },
    async ({ pageId }: { pageId: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);

        await asc.deleteCustomProductPage(pageId);

        return jsonResult({ ok: true, pageId });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "add_cpp_locale",
    {
      description:
        "Add a locale to a Custom Product Page version, creating its localization so promotional text and " +
        "screenshots can be set for it. If the locale already exists on this version, returns the existing " +
        "localization instead of erroring. Get versionId from list_cpp_pages.",
      inputSchema: {
        versionId: z.string().describe("Custom Product Page version ID, from list_cpp_pages."),
        locale: z.string().describe("Locale to add, e.g. 'de-DE'."),
      },
    },
    async ({ versionId, locale }: { versionId: string; locale: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);

        try {
          const created = await asc.createCustomProductPageLocalization(versionId, locale);

          return jsonResult({
            id: created.id,
            locale: created.attributes.locale,
            promotionalText: created.attributes.promotionalText ?? "",
            created: true,
          });
        } catch (err: any) {
          if (!String(err?.message ?? "").includes("409")) {
            throw err;
          }

          const existing = await asc.listCustomProductPageLocalizations(versionId);
          const match = existing.find((l) => l.attributes.locale === locale);

          if (!match) {
            throw err;
          }

          return jsonResult({
            id: match.id,
            locale: match.attributes.locale,
            promotionalText: match.attributes.promotionalText ?? "",
            created: false,
          });
        }
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "update_cpp_promotional_text",
    {
      description:
        "Set the promotional text for one Custom Product Page locale. Get localizationId from " +
        "list_cpp_localizations or add_cpp_locale.",
      inputSchema: {
        localizationId: z.string().describe("Custom Product Page localization ID."),
        promotionalText: z.string().describe("New promotional text for this locale."),
      },
    },
    async ({ localizationId, promotionalText }: { localizationId: string; promotionalText: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);
        const updated = await asc.updateCustomProductPageLocalization(localizationId, promotionalText);

        return jsonResult({
          id: updated.id,
          locale: updated.attributes.locale,
          promotionalText: updated.attributes.promotionalText ?? "",
        });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "delete_cpp_locale",
    {
      description: "Remove a locale from a Custom Product Page version, deleting its localization and screenshots.",
      inputSchema: {
        localizationId: z.string().describe("Custom Product Page localization ID to delete."),
      },
    },
    async ({ localizationId }: { localizationId: string }) => {
      const { settings } = await getSettingsWithBundleId(userId);

      if (!hasAscCredentials(settings)) {
        return textResult(mcpToolMessages.appStoreConnectCredentialsNotConfigured);
      }

      try {
        const asc = await createAscClient(settings);

        await asc.deleteCustomProductPageLocalization(localizationId);

        return jsonResult({ ok: true, localizationId });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );

  registerMutatingTool(
    server,
    userId,
    "submit_cpp_version_for_review",
    {
      description:
        "Submit a Custom Product Page version for App Store review. The version must be in an editable state " +
        "(PREPARE_FOR_SUBMISSION or REJECTED) — check with list_cpp_pages first.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID. Uses the user's default app if omitted."),
        versionId: z.string().describe("Custom Product Page version ID to submit, from list_cpp_pages."),
      },
    },
    async ({ bundleId, versionId }: { bundleId?: string; versionId: string }) => {
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
        const ascAppId = await resolveAscAppId(asc, settings, resolvedBundleId);

        if (!ascAppId) {
          return textResult(couldNotResolveAscAppId(resolvedBundleId));
        }

        const version = await asc.getCustomProductPageVersion(versionId);

        if (!isEditableCppVersionState(version.attributes.state)) {
          return textResult(`Version is ${version.attributes.state}, nothing to submit.`);
        }

        const submissionId = await asc.submitCustomProductPageVersionForReview(ascAppId, versionId);

        return jsonResult({ ok: true, versionId, submissionId });
      } catch (err: any) {
        return textResult(`ASC error: ${formatAscError(err)}`);
      }
    },
  );
}
