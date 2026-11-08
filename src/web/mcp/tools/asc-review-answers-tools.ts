import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EDITABLE_STATES } from "../../api/asc-shared";
import {
  REVIEW_ANSWER_FIELDS,
  formatReviewAnswers,
  normalizeReviewAnswers,
} from "../../../services/review-answers";
import {
  createAscClient,
  formatAscError,
  getSettingsWithBundleId,
  hasAscCredentials,
  mcpToolMessages,
} from "./shared";
import { prisma } from "../../../config";

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
        text: `Invalid review answers: ${err?.message ?? "unknown error"}`,
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

export function registerAscReviewAnswersTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "get_app_review_answers",
    {
      description:
        "Get the saved App Review answers for an app: the standard questionnaire (Siri Shortcuts, devices tested, purpose, setup, external services, ...) " +
        "that gets formatted into the App Review notes. Returns the answers plus the field catalog. " +
        "This mirrors the App Review Answers form in the web UI.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
      },
    },
    async ({ bundleId }) => {
      const stored = await prisma.appReviewAnswers.findUnique({ where: { bundleId } });

      return json({ answers: stored?.answers ?? {}, fields: REVIEW_ANSWER_FIELDS });
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_review_answers",
    {
      description:
        "Save App Review answers for an app. " +
        "Pass only the fields to set; blank strings clear a field. " +
        "Returns the saved answers plus the formatted notes preview. " +
        "Use attach_app_review_answers to write the formatted notes into App Store Connect.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
        answers: z
          .record(z.string(), z.string())
          .describe("Answers by field key, e.g. { siriShortcuts: \"No\", devicesTested: \"iPhone 16, iOS 26\" }."),
      },
    },
    async ({ bundleId, answers }) => {
      let normalized: ReturnType<typeof normalizeReviewAnswers>;

      try {
        normalized = normalizeReviewAnswers(answers ?? {});
      } catch (err: any) {
        return invalidInput(err);
      }

      await prisma.appReviewAnswers.upsert({
        where: { bundleId },
        create: { bundleId, answers: normalized },
        update: { answers: normalized },
      });

      return json({ answers: normalized, preview: formatReviewAnswers(normalized) });
    },
  );

  // @ts-ignore
  server.registerTool(
    "attach_app_review_answers",
    {
      description:
        "Format the saved App Review answers into the numbered notes shape and write them into the App Review notes " +
        "of the app's currently editable version. Existing contact and demo account details are preserved. " +
        "Fails when no answers are saved yet.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
      },
    },
    async ({ bundleId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      const stored = await prisma.appReviewAnswers.findUnique({ where: { bundleId } });
      const notes = formatReviewAnswers((stored?.answers as Record<string, string>) ?? {});

      if (!notes) {
        return invalidInput(new Error("No review answers saved for this app yet"));
      }

      try {
        const asc = await createAscClient(settings);
        const app = await asc.getApp(bundleId);

        if (!app) return invalidInput(new Error("App not found in App Store Connect"));

        const versions = await asc.listVersions(app.id);
        const version = versions.find((v: any) => EDITABLE_STATES.has(v.attributes?.appStoreState));

        if (!version) {
          return invalidInput(new Error("No editable app version found in App Store Connect"));
        }

        const detail = await asc.getReviewDetail(version.id);
        const newDetailId = await asc.upsertReviewDetail(version.id, detail?.id ?? null, {
          firstName: detail?.firstName ?? "",
          lastName: detail?.lastName ?? "",
          phone: detail?.phone ?? "",
          email: detail?.email ?? "",
          demoAccountRequired: detail?.demoAccountRequired ?? false,
          demoAccountName: detail?.demoAccountName,
          demoAccountPassword: detail?.demoAccountPassword,
          notes,
        });

        await prisma.appStoreVersion.upsert({
          where: { id: version.id },
          create: {
            id: version.id,
            bundleId,
            ascAppId: app.id,
            appName: app.attributes.name,
            versionString: version.attributes.versionString,
            appStoreState: version.attributes.appStoreState,
            platform: version.attributes.platform,
            reviewDetailId: newDetailId,
          },
          update: { reviewDetailId: newDetailId },
        });

        return json({ ok: true, versionId: version.id, notes });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
