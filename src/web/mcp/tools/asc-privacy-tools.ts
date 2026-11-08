import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env, prisma } from "../../../config";
import {
  createAppDataUsage,
  dataUsagePurposesUrl,
  deleteAppDataUsage,
  getDataUsagePublishState,
  irisFetch,
  listAppDataUsages,
  listDataUsageCategories,
  resolveIrisSession,
  type IrisSession,
} from "../../../services/asc-privacy";

function sessionMissing() {
  return {
    content: [
      {
        type: "text" as const,
        text: "Apple web session is not configured. Set ASC_ANALYTICS_COOKIES (browser session cookies) and ASC_IRIS_TEAM_ID / ASC_IRIS_TEAM_TYPE.",
      },
    ],
  };
}

function invalidInput(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Invalid data usage: ${err?.message ?? "unknown error"}`,
      },
    ],
  };
}

function irisError(err: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Apple web error: ${err?.message ?? "unknown error"}`,
      },
    ],
  };
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function resolveAdamId(bundleId: string): Promise<string> {
  const app = await prisma.app.findUnique({ where: { bundleId }, select: { trackId: true } });

  if (!app?.trackId) {
    throw new Error("App has no iTunes track ID yet - sync the app first");
  }

  return String(app.trackId);
}

function resolveSession(): IrisSession {
  return resolveIrisSession(env);
}

export function registerAscPrivacyTools(server: McpServer, _userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_data_usages",
    {
      description:
        "List the App Privacy data usages (nutrition label entries) of an app via Apple's internal web API, " +
        "plus the publish state. " +
        "Each entry includes the usage ID, data category, purpose, and data protection group. " +
        "Requires a configured Apple web session.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
      },
    },
    async ({ bundleId }) => {
      let session: IrisSession;

      try {
        session = resolveSession();
      } catch {
        return sessionMissing();
      }

      try {
        const adamId = await resolveAdamId(bundleId);
        const [usages, publishState] = await Promise.all([
          listAppDataUsages(session, adamId),
          getDataUsagePublishState(session, adamId),
        ]);

        return json({ usages, publishState });
      } catch (err: any) {
        return irisError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "get_privacy_catalogs",
    {
      description:
        "List valid data category IDs (with their groupings) and purpose IDs for App Privacy entries " +
        "(e.g. USER_ID, PURCHASE_HISTORY, ANALYTICS). " +
        "Use these IDs when calling create_app_data_usage. Requires a configured Apple web session.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
      },
    },
    async ({ bundleId }) => {
      let session: IrisSession;

      try {
        session = resolveSession();
      } catch {
        return sessionMissing();
      }

      try {
        const adamId = await resolveAdamId(bundleId);
        const [categories, purposes] = await Promise.all([
          listDataUsageCategories(session, adamId),
          irisFetch(session, adamId, "GET", dataUsagePurposesUrl()),
        ]);
        const ids = (doc: any) => ((doc?.data ?? []) as any[]).map((entry) => entry.id);

        return json({ categories, purposes: ids(purposes) });
      } catch (err: any) {
        return irisError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "create_app_data_usage",
    {
      description:
        "Add an App Privacy data usage entry (nutrition label) via Apple's internal web API. " +
        "Requires categoryId from get_privacy_catalogs, optionally a purposeId and dataProtectionId " +
        "(e.g. DATA_NOT_LINKED_TO_YOU). Requires a configured Apple web session.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
        categoryId: z.string().describe("Data category ID from get_privacy_catalogs."),
        purposeId: z.string().optional().describe("Purpose ID from get_privacy_catalogs."),
        dataProtectionId: z.string().optional().describe("Data protection group ID, e.g. DATA_NOT_LINKED_TO_YOU."),
      },
    },
    async ({ bundleId, categoryId, purposeId, dataProtectionId }) => {
      let session: IrisSession;

      try {
        session = resolveSession();
      } catch {
        return sessionMissing();
      }

      try {
        const adamId = await resolveAdamId(bundleId);

        return json(await createAppDataUsage(session, adamId, categoryId, purposeId, dataProtectionId));
      } catch (err: any) {
        return invalidInput(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_data_usage",
    {
      description:
        "Delete an App Privacy data usage entry via Apple's internal web API. " +
        "Use list_app_data_usages to find the usage ID. Requires a configured Apple web session.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
        usageId: z.string().describe("Data usage ID from list_app_data_usages."),
      },
    },
    async ({ bundleId, usageId }) => {
      let session: IrisSession;

      try {
        session = resolveSession();
      } catch {
        return sessionMissing();
      }

      try {
        const adamId = await resolveAdamId(bundleId);

        await deleteAppDataUsage(session, adamId, usageId);

        return json({ ok: true });
      } catch (err: any) {
        return irisError(err);
      }
    },
  );
}
