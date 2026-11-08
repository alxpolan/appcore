import http from "./utils/http";

export const REVIEW_ATTACHMENT_MAX_BYTES = 500 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:(video\/(mp4|quicktime)|image\/(png|jpe?g));base64,([A-Za-z0-9+/=]+)$/;

export interface ReviewAttachmentInput {
  fileDataUrl?: string;
  fileUrl?: string;
  fileName?: string;
}

export interface ReviewAttachment {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  assetDeliveryState: string | null;
}

export interface ResolvedReviewAttachmentFile {
  fileName: string;
  bytes: Buffer;
}

interface UploadHttp {
  get<T>(url: string, config?: any): Promise<{ data: T; headers: Record<string, string> }>;
  put(url: string, data: any, config?: any): Promise<unknown>;
}

function fileNameFromUrl(fileUrl: string, contentType: string): string {
  const segment = fileUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "";

  if (/^[\w\-. ]+\.(mp4|mov|png|jpe?g)$/i.test(segment)) return segment;

  return contentType.startsWith("video/") ? "screen-recording.mp4" : "review-attachment.png";
}

function defaultFileName(mime: string): string {
  if (mime === "video/quicktime") return "screen-recording.mov";
  if (mime.startsWith("video/")) return "screen-recording.mp4";
  if (mime === "image/jpeg") return "review-attachment.jpg";

  return "review-attachment.png";
}

function checkSize(bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > REVIEW_ATTACHMENT_MAX_BYTES) {
    throw new Error("File must be non-empty and smaller than 500 MB");
  }
}

export async function resolveReviewAttachmentFile(
  input: ReviewAttachmentInput,
  fetchHttp: UploadHttp = http,
): Promise<ResolvedReviewAttachmentFile> {
  const hasDataUrl = (input.fileDataUrl?.trim() ?? "") !== "";
  const hasUrl = (input.fileUrl?.trim() ?? "") !== "";

  if (Number(hasDataUrl) + Number(hasUrl) !== 1) {
    throw new Error("Provide exactly one of fileDataUrl or fileUrl");
  }

  if (hasDataUrl) {
    const match = DATA_URL_PATTERN.exec(input.fileDataUrl!.trim());

    if (!match) {
      throw new Error("Expected an MP4, MOV, PNG or JPEG data URL file");
    }

    const bytes = Buffer.from(match[4], "base64");

    checkSize(bytes);

    const fallback = input.fileName?.trim() || defaultFileName(match[1]);

    return { fileName: fallback, bytes };
  }

  let parsed: URL;

  try {
    parsed = new URL(input.fileUrl!.trim());
  } catch {
    throw new Error("Invalid file URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("File URL must be http or https");
  }

  let res;

  try {
    res = await fetchHttp.get<Buffer>(parsed.toString(), { responseType: "arraybuffer", timeout: 60000 });
  } catch (err) {
    throw new Error(`Could not fetch file URL: ${(err as Error).message}`);
  }

  const contentType = (res.headers["content-type"] ?? "").split(";")[0].trim();

  if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
    throw new Error(`File URL must serve a video or image, got "${contentType || "unknown content type"}"`);
  }

  const bytes = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data as any);

  checkSize(bytes);

  return { fileName: input.fileName?.trim() || fileNameFromUrl(parsed.toString(), contentType), bytes };
}

export async function uploadReviewAttachment(
  asc: { client: { post(url: string, body: any): Promise<any>; patch(url: string, body: any): Promise<any> } },
  reviewDetailId: string,
  file: ResolvedReviewAttachmentFile,
  putHttp: UploadHttp = http,
): Promise<string> {
  const { data: createResp } = await asc.client.post("/appStoreReviewAttachments", {
    data: {
      type: "appStoreReviewAttachments",
      attributes: { fileName: file.fileName, fileSize: file.bytes.length },
      relationships: {
        appStoreReviewDetail: { data: { type: "appStoreReviewDetails", id: reviewDetailId } },
      },
    },
  });

  const attachmentId = createResp.data.id;
  const uploadOps: any[] = createResp.data.attributes?.uploadOperations ?? [];

  for (const op of uploadOps) {
    const chunk = file.bytes.slice(op.offset, op.offset + op.length);

    await putHttp.put(op.url, chunk, {
      headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
    });
  }

  await asc.client.patch(`/appStoreReviewAttachments/${attachmentId}`, {
    data: {
      type: "appStoreReviewAttachments",
      id: attachmentId,
      attributes: { uploaded: true },
    },
  });

  return attachmentId;
}

export function toReviewAttachment(raw: any): ReviewAttachment {
  const attributes = raw?.attributes;

  if (!attributes) {
    throw new Error("ASC appStoreReviewAttachments response missing required attributes");
  }

  if (typeof raw?.id !== "string") {
    throw new Error("ASC appStoreReviewAttachments response missing required id");
  }

  return {
    id: raw.id,
    fileName: attributes.fileName ?? null,
    fileSize: attributes.fileSize ?? null,
    assetDeliveryState: attributes.assetDeliveryState ?? null,
  };
}
