import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AGE_RATING_FIELDS,
  buildAgeRatingDeclarationUpdateBody,
  toAgeRatingDeclaration,
} from "../../../services/asc-age-rating";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";

function ascError(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `ASC error: ${formatAscError(err)}`,
      },
    ],
  };
}

function invalidInput(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Invalid age rating declaration: ${err?.message ?? "unknown error"}`,
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

async function resolveDeclarationId(
  asc: Awaited<ReturnType<typeof createAscClient>>,
  bundleId: string,
): Promise<string> {
  const app = await asc.getApp(bundleId);

  if (!app) throw new Error("App not found in App Store Connect");

  const appInfoId = await asc.getAppInfoId(app.id);

  if (!appInfoId) throw new Error("No app info found in App Store Connect");

  const fields = AGE_RATING_FIELDS.map((field) => field.key).join(",");
  const { data: resp } = await asc.client.get(`/appInfos/${appInfoId}/ageRatingDeclaration`, {
    params: { "fields[ageRatingDeclarations]": fields },
  });

  return toAgeRatingDeclaration(resp.data).id;
}

export function registerAscAgeRatingTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "get_app_age_rating",
    {
      description:
        "Get the age rating questionnaire of an app: all content descriptors (violence, gambling, advertising, ...) " +
        "with their current answers, plus the declaration ID needed for updates. " +
        "Editable fields: booleans, NONE/INFREQUENT_OR_MILD/FREQUENT_OR_INTENSE/INFREQUENT/FREQUENT levels, " +
        "kids age band, rating overrides, GRAC number and info URL.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
      },
    },
    async ({ bundleId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(bundleId);

        if (!app) return invalidInput(new Error("App not found in App Store Connect"));

        const appInfoId = await asc.getAppInfoId(app.id);

        if (!appInfoId) return invalidInput(new Error("No app info found in App Store Connect"));

        const fields = AGE_RATING_FIELDS.map((field) => field.key).join(",");
        const { data: resp } = await asc.client.get(`/appInfos/${appInfoId}/ageRatingDeclaration`, {
          params: { "fields[ageRatingDeclarations]": fields },
        });

        return json({ ...toAgeRatingDeclaration(resp.data), fields: AGE_RATING_FIELDS });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_age_rating",
    {
      description:
        "Update the age rating questionnaire of an app. " +
        "Pass only the fields to change as attributes; use null to clear a field. " +
        "Booleans take true/false, content levels take NONE, INFREQUENT_OR_MILD, FREQUENT_OR_INTENSE, INFREQUENT or FREQUENT, " +
        "kidsAgeBand takes FIVE_AND_UNDER, SIX_TO_EIGHT or NINE_TO_ELEVEN. " +
        "Use get_app_age_rating to see current answers.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
        attributes: z
          .record(z.string(), z.union([z.boolean(), z.string()]).nullable())
          .describe("Age rating fields to update, e.g. { gambling: true, contests: 'NONE' }."),
      },
    },
    async ({ bundleId, attributes }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const declarationId = await resolveDeclarationId(asc, bundleId);

        let body: ReturnType<typeof buildAgeRatingDeclarationUpdateBody>;

        try {
          body = buildAgeRatingDeclarationUpdateBody(declarationId, attributes ?? {});
        } catch (err: any) {
          return invalidInput(err);
        }

        const { data: resp } = await asc.client.patch(`/ageRatingDeclarations/${declarationId}`, body);

        return json(toAgeRatingDeclaration(resp.data));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
