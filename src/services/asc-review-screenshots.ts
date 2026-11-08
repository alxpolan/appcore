import http from "./utils/http";

export const REVIEW_SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;

export interface ReviewScreenshotInput {
  imageDataUrl?: string;
  imageUrl?: string;
  fileName?: string;
}

export interface ReviewScreenshot {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  assetDeliveryState: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface ResolvedReviewScreenshotFile {
  fileName: string;
  bytes: Buffer;
}

interface UploadHttp {
  get<T>(url: string, config?: any): Promise<{ data: T; headers: Record<string, string> }>;
  put(url: string, data: any, config?: any): Promise<unknown>;
}

function fileNameFromUrl(imageUrl: string): string {
  const segment = imageUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "";

  if (/^[\w\-. ]+\.(png|jpe?g)$/i.test(segment)) return segment;

  return "review-screenshot.png";
}

export async function resolveReviewScreenshotFile(
  input: ReviewScreenshotInput,
  fetchHttp: UploadHttp = http,
): Promise<ResolvedReviewScreenshotFile> {
  const hasDataUrl = (input.imageDataUrl?.trim() ?? "") !== "";
  const hasUrl = (input.imageUrl?.trim() ?? "") !== "";

  if (Number(hasDataUrl) + Number(hasUrl) !== 1) {
    throw new Error("Provide exactly one of imageDataUrl or imageUrl");
  }

  if (hasDataUrl) {
    const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(input.imageDataUrl!.trim());

    if (!match) {
      throw new Error("Expected a PNG or JPEG data URL image");
    }

    const bytes = Buffer.from(match[2], "base64");

    if (bytes.length === 0 || bytes.length > REVIEW_SCREENSHOT_MAX_BYTES) {
      throw new Error("Image must be non-empty and smaller than 10 MB");
    }

    return { fileName: input.fileName?.trim() || "review-screenshot.png", bytes };
  }

  let parsed: URL;

  try {
    parsed = new URL(input.imageUrl!.trim());
  } catch {
    throw new Error("Invalid image URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Image URL must be http or https");
  }

  let res;

  try {
    res = await fetchHttp.get<Buffer>(parsed.toString(), { responseType: "arraybuffer", timeout: 15000 });
  } catch (err) {
    throw new Error(`Could not fetch image URL: ${(err as Error).message}`);
  }

  const contentType = res.headers["content-type"] ?? "";

  if (!contentType.startsWith("image/")) {
    throw new Error(`Image URL must serve an image, got "${contentType || "unknown content type"}"`);
  }

  const bytes = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data as any);

  if (bytes.length === 0 || bytes.length > REVIEW_SCREENSHOT_MAX_BYTES) {
    throw new Error("Image must be non-empty and smaller than 10 MB");
  }

  return { fileName: input.fileName?.trim() || fileNameFromUrl(parsed.toString()), bytes };
}

export async function uploadReviewScreenshot(
  asc: { client: { post(url: string, body: any): Promise<any>; patch(url: string, body: any): Promise<any> } },
  subscriptionId: string,
  file: ResolvedReviewScreenshotFile,
  putHttp: UploadHttp = http,
): Promise<string> {
  const { data: createResp } = await asc.client.post("/subscriptionAppStoreReviewScreenshots", {
    data: {
      type: "subscriptionAppStoreReviewScreenshots",
      attributes: { fileName: file.fileName, fileSize: file.bytes.length },
      relationships: {
        subscription: { data: { type: "subscriptions", id: subscriptionId } },
      },
    },
  });

  const screenshotId = createResp.data.id;
  const uploadOps: any[] = createResp.data.attributes?.uploadOperations ?? [];

  for (const op of uploadOps) {
    const chunk = file.bytes.slice(op.offset, op.offset + op.length);

    await putHttp.put(op.url, chunk, {
      headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
    });
  }

  await asc.client.patch(`/subscriptionAppStoreReviewScreenshots/${screenshotId}`, {
    data: {
      type: "subscriptionAppStoreReviewScreenshots",
      id: screenshotId,
      attributes: { uploaded: true },
    },
  });

  return screenshotId;
}

export function toReviewScreenshot(raw: any): ReviewScreenshot | null {
  if (!raw) return null;

  const attributes = raw.attributes;

  if (!attributes) {
    throw new Error("ASC subscriptionAppStoreReviewScreenshots response missing required attributes");
  }

  if (typeof raw.id !== "string") {
    throw new Error("ASC subscriptionAppStoreReviewScreenshots response missing required id");
  }

  const asset = attributes.imageAsset ?? null;

  return {
    id: raw.id,
    fileName: attributes.fileName ?? null,
    fileSize: attributes.fileSize ?? null,
    assetDeliveryState: attributes.assetDeliveryState ?? null,
    imageUrl: asset?.templateUrl
      ? asset.templateUrl
          .replace("{w}", String(asset.width ?? 320))
          .replace("{h}", String(asset.height ?? 180))
          .replace("{f}", "png")
      : null,
    width: asset?.width ?? null,
    height: asset?.height ?? null,
  };
}
