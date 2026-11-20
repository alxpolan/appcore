import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildRetentionMessageCreateBody,
  buildRetentionMessageLocalizationCreateBody,
  buildRetentionMessageLocalizationUpdateBody,
  buildRetentionMessageVersionCreateBody,
  toRetentionMessage,
  toRetentionMessageLocalization,
  toRetentionMessageVersion,
} from "../../../services/asc-retention-messages";
import {
  couldNotResolveAscAppId,
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

export function ascError(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `ASC error: ${formatAscError(err)}`,
      },
    ],
  };
}

export function invalidInput(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Invalid retention message: ${err?.message ?? "unknown error"}`,
      },
    ],
  };
}

export function credentialsMissing() {
  return {
    content: [
      {
        type: "text" as const,
        text: mcpToolMessages.appStoreConnectCredentialsNotConfigured,
      },
    ],
  };
}

export function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function registerAscSubscriptionRetentionMessageCoreTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_messages",
    {
      description:
        "List retention messages for an app. A retention message is shown to a subscriber who tries to cancel: " +
        "required header/body text, an optional image, and optional retention offers.",
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
          return { content: [{ type: "text" as const, text: couldNotResolveAscAppId(resolvedBundleId) }] };
        }

        const { data: resp } = await asc.client.get(`/apps/${app.id}/retentionMessages`, {
          params: { "fields[retentionMessages]": "referenceName", limit: 200 },
        });

        return json((resp.data ?? []).map(toRetentionMessage));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_retention_message",
    {
      description:
        "Create a retention message shell for an app. After creating it, call " +
        "create_app_subscription_retention_message_version to add a draft version, then attach localized " +
        "text (and optionally an image) to that version.",
      inputSchema: {
        bundleId: z
          .string()
          .optional()
          .describe("App bundle ID (e.g. 'com.example.myapp'). Uses the user's default app if omitted."),
        referenceName: z.string().describe("Internal reference name, not shown to subscribers."),
      },
    },
    async ({ bundleId, referenceName }) => {
      const { settings, resolvedBundleId } = await getSettingsWithBundleId(userId, bundleId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(resolvedBundleId);

        if (!app) {
          return { content: [{ type: "text" as const, text: couldNotResolveAscAppId(resolvedBundleId) }] };
        }

        let body: ReturnType<typeof buildRetentionMessageCreateBody>;

        try {
          body = buildRetentionMessageCreateBody({ appId: app.id, referenceName });
        } catch (err: any) {
          return invalidInput(err);
        }

        const { data: resp } = await asc.client.post("/retentionMessages", body);

        return json(toRetentionMessage(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_retention_message",
    {
      description:
        "Delete a retention message, including its versions and localizations. " +
        "Use list_app_subscription_retention_messages to find the message ID.",
      inputSchema: {
        retentionMessageId: z.string().describe("Retention message ID from list_app_subscription_retention_messages."),
      },
    },
    async ({ retentionMessageId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/retentionMessages/${retentionMessageId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_retention_message_version",
    {
      description:
        "Create a new draft version of a retention message. Localized text and an image are attached to a " +
        "version, not to the message directly. Use list_app_subscription_retention_messages to find the message ID.",
      inputSchema: {
        retentionMessageId: z.string().describe("Retention message ID from list_app_subscription_retention_messages."),
      },
    },
    async ({ retentionMessageId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let body: ReturnType<typeof buildRetentionMessageVersionCreateBody>;

      try {
        body = buildRetentionMessageVersionCreateBody({ retentionMessageId });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/retentionMessageVersions", body);

        return json(toRetentionMessageVersion(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_message_versions",
    {
      description:
        "List the versions of a retention message, with review state. " +
        "Use list_app_subscription_retention_messages to find the message ID.",
      inputSchema: {
        retentionMessageId: z.string().describe("Retention message ID from list_app_subscription_retention_messages."),
      },
    },
    async ({ retentionMessageId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(`/retentionMessages/${retentionMessageId}/versions`, {
          params: { "fields[retentionMessageVersions]": "state", limit: 200 },
        });

        return json((resp.data ?? []).map(toRetentionMessageVersion));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_subscription_retention_message_localization",
    {
      description:
        "Add localized header/body text to a retention message version. " +
        "Header is limited to 66 characters, body to 144 characters; at least one of them is required. " +
        "Use create_app_subscription_retention_message_version to find the version ID.",
      inputSchema: {
        retentionMessageVersionId: z
          .string()
          .describe("Retention message version ID from create_app_subscription_retention_message_version."),
        locale: z.string().describe("Locale code (e.g. 'en-US', 'de-DE', 'fr-FR')."),
        header: z.string().max(66).optional().describe("Header text shown to the subscriber."),
        body: z.string().max(144).optional().describe("Body text shown to the subscriber."),
      },
    },
    async ({ retentionMessageVersionId, locale, header, body }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let requestBody: ReturnType<typeof buildRetentionMessageLocalizationCreateBody>;

      try {
        requestBody = buildRetentionMessageLocalizationCreateBody({
          retentionMessageVersionId,
          locale,
          header,
          body,
        });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.post("/retentionMessageLocalizations", requestBody);

        return json(toRetentionMessageLocalization(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_retention_message_localization",
    {
      description:
        "Update the header and/or body text of a retention message localization. " +
        "Use list_app_subscription_retention_message_localizations to find the localization ID.",
      inputSchema: {
        localizationId: z
          .string()
          .describe("Retention message localization ID from list_app_subscription_retention_message_localizations."),
        header: z.string().max(66).nullable().optional().describe("New header text. Null clears it."),
        body: z.string().max(144).nullable().optional().describe("New body text. Null clears it."),
      },
    },
    async ({ localizationId, header, body }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let requestBody: ReturnType<typeof buildRetentionMessageLocalizationUpdateBody>;

      try {
        requestBody = buildRetentionMessageLocalizationUpdateBody({ id: localizationId, header, body });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.patch(`/retentionMessageLocalizations/${localizationId}`, requestBody);

        return json(toRetentionMessageLocalization(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_retention_message_localization",
    {
      description:
        "Delete a retention message localization. " +
        "Use list_app_subscription_retention_message_localizations to find the localization ID.",
      inputSchema: {
        localizationId: z
          .string()
          .describe("Retention message localization ID from list_app_subscription_retention_message_localizations."),
      },
    },
    async ({ localizationId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/retentionMessageLocalizations/${localizationId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "list_app_subscription_retention_message_localizations",
    {
      description:
        "List the localized header/body text of a retention message version. " +
        "Use create_app_subscription_retention_message_version to find the version ID.",
      inputSchema: {
        retentionMessageVersionId: z
          .string()
          .describe("Retention message version ID from create_app_subscription_retention_message_version."),
      },
    },
    async ({ retentionMessageVersionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const { data: resp } = await asc.client.get(
          `/retentionMessageVersions/${retentionMessageVersionId}/localizations`,
          { params: { "fields[retentionMessageLocalizations]": "locale,header,body", limit: 200 } },
        );

        return json((resp.data ?? []).map(toRetentionMessageLocalization));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
