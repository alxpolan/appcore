import sharp from "sharp";
import http from "./utils/http";

export const RETENTION_MESSAGE_HEADER_MAX_LENGTH = 66;
export const RETENTION_MESSAGE_BODY_MAX_LENGTH = 144;
export const RETENTION_MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const RETENTION_MESSAGE_IMAGE_DIMENSIONS = [
  { width: 3840, height: 2160 },
  { width: 5244, height: 2950 },
] as const;

export interface RetentionMessageCreateInput {
  appId: string;
  referenceName: string;
}

export interface RetentionMessage {
  id: string;
  referenceName: string;
}

export interface RetentionMessageVersionCreateInput {
  retentionMessageId: string;
}

export interface RetentionMessageVersion {
  id: string;
  state: string | null;
}

export interface RetentionMessageLocalizationCreateInput {
  retentionMessageVersionId: string;
  locale: string;
  header?: string | null;
  body?: string | null;
}

export interface RetentionMessageLocalizationUpdateInput {
  id: string;
  header?: string | null;
  body?: string | null;
}

export interface RetentionMessageLocalization {
  id: string;
  locale: string;
  header: string | null;
  body: string | null;
}

function requireNonEmptyTrimmed(value: string, field: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${field} is required and must not be blank`);
  }

  return trimmed;
}

function requireMaxLength<T extends string | null | undefined>(value: T, max: number, field: string): T {
  if (value === undefined || value === null) return value;

  if (value.length > max) {
    throw new Error(`${field} must be at most ${max} characters, got ${value.length}`);
  }

  return value;
}

export function buildRetentionMessageCreateBody(input: RetentionMessageCreateInput) {
  const referenceName = requireNonEmptyTrimmed(input.referenceName, "referenceName");
  const appId = requireNonEmptyTrimmed(input.appId, "appId");

  return {
    data: {
      type: "retentionMessages",
      attributes: { referenceName },
      relationships: {
        app: { data: { type: "apps", id: appId } },
      },
    },
  };
}

export function buildRetentionMessageVersionCreateBody(input: RetentionMessageVersionCreateInput) {
  const retentionMessageId = requireNonEmptyTrimmed(input.retentionMessageId, "retentionMessageId");

  return {
    data: {
      type: "retentionMessageVersions",
      relationships: {
        retentionMessage: { data: { type: "retentionMessages", id: retentionMessageId } },
      },
    },
  };
}

export function buildRetentionMessageLocalizationCreateBody(input: RetentionMessageLocalizationCreateInput) {
  const retentionMessageVersionId = requireNonEmptyTrimmed(
    input.retentionMessageVersionId,
    "retentionMessageVersionId",
  );

  const locale = requireNonEmptyTrimmed(input.locale, "locale");
  const header = requireMaxLength(input.header, RETENTION_MESSAGE_HEADER_MAX_LENGTH, "header");
  const body = requireMaxLength(input.body, RETENTION_MESSAGE_BODY_MAX_LENGTH, "body");

  if (!header?.trim() && !body?.trim()) {
    throw new Error("At least one of header or body is required");
  }

  return {
    data: {
      type: "retentionMessageLocalizations",
      attributes: {
        locale,
        ...(header !== undefined ? { header } : {}),
        ...(body !== undefined ? { body } : {}),
      },
      relationships: {
        retentionMessageVersion: { data: { type: "retentionMessageVersions", id: retentionMessageVersionId } },
      },
    },
  };
}

export function buildRetentionMessageLocalizationUpdateBody(input: RetentionMessageLocalizationUpdateInput) {
  const id = requireNonEmptyTrimmed(input.id, "id");
  const attributes: Record<string, string | null> = {};

  if (input.header !== undefined) {
    attributes.header = requireMaxLength(input.header, RETENTION_MESSAGE_HEADER_MAX_LENGTH, "header") ?? null;
  }

  if (input.body !== undefined) {
    attributes.body = requireMaxLength(input.body, RETENTION_MESSAGE_BODY_MAX_LENGTH, "body") ?? null;
  }

  return {
    data: {
      type: "retentionMessageLocalizations",
      id,
      attributes,
    },
  };
}

export function buildRetentionMessagePlacementCreateBody(input: {
  imageId: string;
  retentionMessageVersionId: string;
}) {
  const imageId = requireNonEmptyTrimmed(input.imageId, "imageId");
  const retentionMessageVersionId = requireNonEmptyTrimmed(
    input.retentionMessageVersionId,
    "retentionMessageVersionId",
  );

  return {
    data: {
      type: "appAssetLibraryPlacements",
      attributes: { placementType: "RETENTION_MESSAGE_ASSET" },
      relationships: {
        image: { data: { type: "appAssetLibraryImages", id: imageId } },
        retentionMessageVersion: { data: { type: "retentionMessageVersions", id: retentionMessageVersionId } },
      },
    },
  };
}

export function toRetentionMessage(raw: any): RetentionMessage {
  if (typeof raw?.id !== "string" || typeof raw?.attributes?.referenceName !== "string") {
    throw new Error("ASC retentionMessages response missing required id or referenceName");
  }

  return { id: raw.id, referenceName: raw.attributes.referenceName };
}

export function toRetentionMessageVersion(raw: any): RetentionMessageVersion {
  if (typeof raw?.id !== "string") {
    throw new Error("ASC retentionMessageVersions response missing required id");
  }

  return { id: raw.id, state: raw.attributes?.state ?? null };
}

export function toRetentionMessageLocalization(raw: any): RetentionMessageLocalization {
  const attributes = raw?.attributes;

  if (typeof raw?.id !== "string" || typeof attributes?.locale !== "string") {
    throw new Error("ASC retentionMessageLocalizations response missing required id or locale");
  }

  return {
    id: raw.id,
    locale: attributes.locale,
    header: attributes.header ?? null,
    body: attributes.body ?? null,
  };
}

export interface RetentionMessageImageInput {
  imageDataUrl?: string;
  imageUrl?: string;
  fileName?: string;
}

export interface ResolvedRetentionMessageImageFile {
  fileName: string;
  bytes: Buffer;
}

interface UploadHttp {
  get<T>(url: string, config?: any): Promise<{ data: T; headers: Record<string, string> }>;
  put(url: string, data: any, config?: any): Promise<unknown>;
}

function fileNameFromImageUrl(imageUrl: string): string {
  const segment = imageUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "";

  if (/^[\w\-. ]+\.png$/i.test(segment)) return segment;

  return "retention-message.png";
}

export async function validateRetentionMessageImageDimensions(bytes: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const matches = RETENTION_MESSAGE_IMAGE_DIMENSIONS.some((d) => d.width === width && d.height === height);

  if (!matches) {
    const allowed = RETENTION_MESSAGE_IMAGE_DIMENSIONS.map((d) => `${d.width}x${d.height}`).join(" or ");

    throw new Error(`Retention message image must be ${allowed} pixels, got ${width}x${height}`);
  }

  if (meta.hasAlpha) {
    throw new Error("Retention message image must not have transparency");
  }

  return { width, height };
}

export async function resolveRetentionMessageImageFile(
  input: RetentionMessageImageInput,
  fetchHttp: UploadHttp = http,
): Promise<ResolvedRetentionMessageImageFile> {
  const hasDataUrl = (input.imageDataUrl?.trim() ?? "") !== "";
  const hasUrl = (input.imageUrl?.trim() ?? "") !== "";

  if (Number(hasDataUrl) + Number(hasUrl) !== 1) {
    throw new Error("Provide exactly one of imageDataUrl or imageUrl");
  }

  let bytes: Buffer;
  let fileName: string;

  if (hasDataUrl) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.imageDataUrl!.trim());

    if (!match) {
      throw new Error("Expected a PNG data URL image");
    }

    bytes = Buffer.from(match[1], "base64");
    fileName = input.fileName?.trim() || "retention-message.png";
  } else {
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

    if (!contentType.startsWith("image/png")) {
      throw new Error(`Image URL must serve a PNG image, got "${contentType || "unknown content type"}"`);
    }

    bytes = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data as any);
    fileName = input.fileName?.trim() || fileNameFromImageUrl(parsed.toString());
  }

  if (bytes.length === 0 || bytes.length > RETENTION_MESSAGE_IMAGE_MAX_BYTES) {
    throw new Error(`Image must be non-empty and smaller than ${RETENTION_MESSAGE_IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
  }

  await validateRetentionMessageImageDimensions(bytes);

  return { fileName, bytes };
}

export interface AscClientLike {
  client: {
    get(url: string, config?: any): Promise<any>;
    post(url: string, body: any): Promise<any>;
    patch(url: string, body: any): Promise<any>;
  };
}

export async function uploadRetentionMessageImage(
  asc: AscClientLike,
  appId: string,
  file: ResolvedRetentionMessageImageFile,
  putHttp: UploadHttp = http,
): Promise<string> {
  const { data: libResp } = await asc.client.get(`/apps/${appId}/assetLibrary`);
  const assetLibraryId = libResp.data?.id;

  if (!assetLibraryId) {
    throw new Error("Could not resolve the app's asset library");
  }

  const { data: createResp } = await asc.client.post("/appAssetLibraryImages", {
    data: {
      type: "appAssetLibraryImages",
      attributes: {
        category: "CREATIVE_ASSETS",
        fileName: file.fileName,
        fileSize: file.bytes.length,
      },
      relationships: {
        assetLibrary: { data: { type: "appAssetLibraries", id: assetLibraryId } },
      },
    },
  });

  const imageId = createResp.data.id;
  const uploadOps: any[] = createResp.data.attributes?.uploadOperations ?? [];

  for (const op of uploadOps) {
    const chunk = file.bytes.slice(op.offset, op.offset + op.length);

    await putHttp.put(op.url, chunk, {
      headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
    });
  }

  await asc.client.patch(`/appAssetLibraryImages/${imageId}`, {
    data: { type: "appAssetLibraryImages", id: imageId, attributes: { uploaded: true } },
  });

  return imageId;
}
