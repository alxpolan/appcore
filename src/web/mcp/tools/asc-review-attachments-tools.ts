import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EDITABLE_STATES } from "../../api/asc-shared";
import {
  resolveReviewAttachmentFile,
  toReviewAttachment,
  uploadReviewAttachment,
} from "../../../services/asc-review-attachments";
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
        text: `Invalid review attachment: ${err?.message ?? "unknown error"}`,
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

async function resolveEditableVersionId(
  asc: Awaited<ReturnType<typeof createAscClient>>,
  bundleId: string,
): Promise<{ appId: string; versionId: string }> {
  const app = await asc.getApp(bundleId);

  if (!app) throw new Error("App not found in App Store Connect");

  const versions = await asc.listVersions(app.id);
  const version = versions.find((v: any) => EDITABLE_STATES.has(v.attributes?.appStoreState));

  if (!version) throw new Error("No editable app version found in App Store Connect");

  return { appId: app.id, versionId: version.id };
}

async function resolveReviewDetailId(
  asc: Awaited<ReturnType<typeof createAscClient>>,
  versionId: string,
): Promise<string> {
  const detail = await asc.getReviewDetail(versionId);

  if (!detail) {
    throw new Error("No App Review detail exists yet - save reviewer info first");
  }

  return detail.id;
}

export function registerAscReviewAttachmentTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "list_app_review_attachments",
    {
      description:
        "List files attached to App Review for an app version (screen recordings, screenshots). " +
        "Each entry includes the attachment ID, file name, size, and delivery state.",
      inputSchema: {
        versionId: z.string().describe("App Store version ID from the Versions page."),
      },
    },
    async ({ versionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const detail = await asc.getReviewDetail(versionId);

        if (!detail) return json([]);

        const { data: resp } = await asc.client.get(
          `/appStoreReviewDetails/${detail.id}/appStoreReviewAttachments`,
          {
            params: {
              "fields[appStoreReviewAttachments]": "fileName,fileSize,assetDeliveryState",
              limit: 200,
            },
          },
        );

        return json((resp.data ?? []).map(toReviewAttachment));
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "upload_app_review_attachment",
    {
      description:
        "Upload a screen recording or screenshot as an App Review attachment. " +
        "Provide exactly one of fileDataUrl (MP4, MOV, PNG or JPEG as a data URL) or fileUrl " +
        "(a public http(s) URL, fetched server-side like screenshot studio overlays - use this for large videos). " +
        "The file is uploaded through Apple's upload operations and confirmed automatically. " +
        "Takes a bundleId and uses the currently editable version; reviewer info must exist.",
      inputSchema: {
        bundleId: z.string().describe("App bundle ID (e.g. 'com.example.myapp')."),
        fileDataUrl: z
          .string()
          .optional()
          .describe("The file as a data URL, e.g. 'data:video/mp4;base64,AAAA...'. Provide this or fileUrl, not both."),
        fileUrl: z
          .string()
          .optional()
          .describe("A public http(s) URL to fetch the file from, as an alternative to fileDataUrl."),
        fileName: z.string().optional().describe("File name. Derived from the URL when omitted."),
      },
    },
    async ({ bundleId, fileDataUrl, fileUrl, fileName }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let file;

      try {
        file = await resolveReviewAttachmentFile({ fileDataUrl, fileUrl, fileName });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const { versionId } = await resolveEditableVersionId(asc, bundleId);
        const detailId = await resolveReviewDetailId(asc, versionId);
        const id = await uploadReviewAttachment(asc, detailId, file);

        return json({ id, versionId, ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_review_attachment",
    {
      description:
        "Delete an App Review attachment. " + "Use list_app_review_attachments to find the attachment ID.",
      inputSchema: {
        attachmentId: z.string().describe("Attachment ID from list_app_review_attachments."),
      },
    },
    async ({ attachmentId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/appStoreReviewAttachments/${attachmentId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
