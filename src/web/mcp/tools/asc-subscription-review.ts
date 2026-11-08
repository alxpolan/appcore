import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveReviewScreenshotFile,
  toReviewScreenshot,
  uploadReviewScreenshot,
} from "../../../services/asc-review-screenshots";
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
        text: `Invalid input: ${err?.message ?? "unknown error"}`,
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

export function registerAscSubscriptionReviewTools(server: McpServer, userId: string) {
  // @ts-ignore
  server.registerTool(
    "get_app_subscription_review",
    {
      description:
        "Get the App Review state of a subscription: the review note for App Review and the current review screenshot, if any. " +
        "This mirrors the Review tab in the web UI.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
      },
    },
    async ({ subscriptionId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);
        const [{ data: subResp }, { data: shotResp }] = await Promise.all([
          asc.client.get(`/subscriptions/${subscriptionId}`, {
            params: { "fields[subscriptions]": "reviewNote" },
          }),
          asc.client.get(`/subscriptions/${subscriptionId}/appStoreReviewScreenshot`, {
            params: {
              "fields[subscriptionAppStoreReviewScreenshots]":
                "fileName,fileSize,sourceFileChecksum,imageAsset,assetToken,assetType,uploadOperations,assetDeliveryState",
            },
          }),
        ]);

        return json({
          reviewNote: subResp.data.attributes?.reviewNote ?? null,
          screenshot: toReviewScreenshot(shotResp.data),
        });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "update_app_subscription_review_note",
    {
      description:
        "Set the review note for App Review on a subscription. " +
        "Pass an empty string to clear the note. This mirrors the Review tab in the web UI.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        reviewNote: z.string().describe("Notes for App Review. Empty string clears the note."),
      },
    },
    async ({ subscriptionId, reviewNote }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.patch(`/subscriptions/${subscriptionId}`, {
          data: {
            type: "subscriptions",
            id: subscriptionId,
            attributes: { reviewNote: reviewNote.trim() ? reviewNote : null },
          },
        });

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "upload_app_subscription_review_screenshot",
    {
      description:
        "Upload the App Review screenshot for a subscription. " +
        "Provide exactly one of imageDataUrl (PNG or JPEG as a data URL) or imageUrl (a public http(s) URL, fetched server-side like screenshot studio overlays). " +
        "The image is uploaded through Apple's upload operations and confirmed automatically.",
      inputSchema: {
        subscriptionId: z.string().describe("Subscription ID from list_app_subscription_groups."),
        imageDataUrl: z
          .string()
          .optional()
          .describe("The image as a data URL, e.g. 'data:image/png;base64,iVBORw0KG...'. Provide this or imageUrl, not both."),
        imageUrl: z
          .string()
          .optional()
          .describe("A public http(s) URL to fetch the image from, as an alternative to imageDataUrl."),
        fileName: z.string().optional().describe("File name for the screenshot. Derived from the URL when omitted."),
      },
    },
    async ({ subscriptionId, imageDataUrl, imageUrl, fileName }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      let file;

      try {
        file = await resolveReviewScreenshotFile({ imageDataUrl, imageUrl, fileName });
      } catch (err: any) {
        return invalidInput(err);
      }

      try {
        const asc = await createAscClient(settings);
        const id = await uploadReviewScreenshot(asc, subscriptionId, file);

        return json({ id, ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );

  // @ts-ignore
  server.registerTool(
    "delete_app_subscription_review_screenshot",
    {
      description:
        "Delete the App Review screenshot of a subscription. " +
        "Use get_app_subscription_review to find the screenshot ID.",
      inputSchema: {
        screenshotId: z.string().describe("Review screenshot ID from get_app_subscription_review."),
      },
    },
    async ({ screenshotId }) => {
      const { settings } = await getSettingsWithBundleId(userId);
      if (!hasAscCredentials(settings)) return credentialsMissing();

      try {
        const asc = await createAscClient(settings);

        await asc.client.delete(`/subscriptionAppStoreReviewScreenshots/${screenshotId}`);

        return json({ ok: true });
      } catch (err: any) {
        return ascError(err);
      }
    },
  );
}
