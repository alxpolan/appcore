import http from "./utils/http";
import { WebSessionExpiredError } from "./asc-web-analytics";

export const IRIS_BASE_URL = "https://appstoreconnect.apple.com/iris/v1";
export const IRIS_CSRF_TOKEN = "[asc-ui]";

export interface IrisHeaders {
  accept: string;
  contentType: string;
  csrfToken: string;
  teamId: string;
  teamType: string;
  referer: string;
  cookies: string;
}

export function buildIrisHeaders(input: IrisHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.api+json, application/json, text/csv",
    "content-type": "application/json",
    "x-csrf-itc": input.csrfToken,
    Referer: input.referer,
    Cookie: input.cookies,
  };

  if (input.teamId) headers["x-connect-team-id"] = input.teamId;
  if (input.teamType) headers["x-connect-team-type"] = input.teamType;

  return headers;
}

export function dataUsagesListUrl(appId: string): string {
  return `${IRIS_BASE_URL}/apps/${appId}/dataUsages?include=category,purpose,grouping,dataProtection&limit=500`;
}

export function dataUsagePublishStateUrl(appId: string): string {
  return `${IRIS_BASE_URL}/apps/${appId}/dataUsagePublishState`;
}

export function dataUsageCategoriesUrl(): string {
  return `${IRIS_BASE_URL}/appDataUsageCategories?include=grouping`;
}

export function dataUsagePurposesUrl(): string {
  return `${IRIS_BASE_URL}/appDataUsagePurposes`;
}

export function buildDataUsageCreateBody(
  appId: string,
  categoryId: string,
  purposeId?: string,
  dataProtectionId?: string,
) {
  const trimmedAppId = appId?.trim();
  const trimmedCategoryId = categoryId?.trim();
  const trimmedPurposeId = purposeId?.trim() || undefined;
  const trimmedDataProtectionId = dataProtectionId?.trim() || undefined;

  if (!trimmedAppId) {
    throw new Error("appId is required");
  }

  if (!trimmedCategoryId) {
    throw new Error("categoryId is required");
  }

  return {
    data: {
      type: "appDataUsages",
      relationships: {
        category: { data: { type: "appDataUsageCategories", id: trimmedCategoryId } },
        app: { data: { type: "apps", id: trimmedAppId } },
        ...(trimmedDataProtectionId
          ? { dataProtection: { data: { type: "appDataUsageDataProtections", id: trimmedDataProtectionId } } }
          : {}),
        ...(trimmedPurposeId
          ? { purpose: { data: { type: "appDataUsagePurposes", id: trimmedPurposeId } } }
          : {}),
      },
    },
  };
}

export function dataUsageDeleteUrl(usageId: string): string {
  const trimmed = usageId?.trim();

  if (!trimmed) {
    throw new Error("usageId is required");
  }

  return `${IRIS_BASE_URL}/appDataUsages/${encodeURIComponent(trimmed)}`;
}

export interface AppDataUsage {
  id: string;
  categoryId: string | null;
  purposeId: string | null;
  dataProtectionId: string | null;
  attributes: Record<string, unknown>;
}

function linkageId(raw: any, key: string): string | null {
  const data = raw?.relationships?.[key]?.data;

  if (!data) return null;

  if (typeof data.id !== "string" || typeof data.type !== "string") {
    throw new Error(`ASC appDataUsages response has an invalid "${key}" linkage`);
  }

  return data.id;
}

export function toDataUsage(raw: any): AppDataUsage {
  if (typeof raw?.id !== "string") {
    throw new Error("ASC appDataUsages response missing required id");
  }

  return {
    id: raw.id,
    categoryId: linkageId(raw, "category"),
    purposeId: linkageId(raw, "purpose"),
    dataProtectionId: linkageId(raw, "dataProtection"),
    attributes: { ...(raw.attributes ?? {}) },
  };
}

export interface AppDataUsageCategory {
  id: string;
  groupingId: string | null;
}

export function toDataUsageCategory(raw: any): AppDataUsageCategory {
  if (typeof raw?.id !== "string") {
    throw new Error("ASC appDataUsageCategories response missing required id");
  }

  return { id: raw.id, groupingId: linkageId(raw, "grouping") };
}

export interface DataUsagePublishState {
  published: boolean;
  lastPublished: string | null;
  lastPublishedBy: string | null;
}

export function toDataUsagePublishState(raw: any): DataUsagePublishState {
  const attributes = raw?.data?.attributes ?? raw?.attributes;

  if (!attributes || typeof attributes.published !== "boolean") {
    throw new Error("ASC dataUsagePublishState response missing required published flag");
  }

  return {
    published: attributes.published,
    lastPublished: attributes.lastPublished ?? null,
    lastPublishedBy: attributes.lastPublishedBy ?? null,
  };
}

export interface IrisSession {
  cookies: string;
  teamId: string;
  teamType: string;
}

export function resolveIrisSession(env: {
  ASC_ANALYTICS_COOKIES?: string;
  ASC_IRIS_TEAM_ID?: string;
  ASC_IRIS_TEAM_TYPE?: string;
}): IrisSession {
  const cookies = env.ASC_ANALYTICS_COOKIES?.trim() ?? "";

  if (!cookies) {
    throw new Error("ASC_ANALYTICS_COOKIES is not configured");
  }

  return {
    cookies,
    teamId: env.ASC_IRIS_TEAM_ID?.trim() ?? "",
    teamType: env.ASC_IRIS_TEAM_TYPE?.trim() ?? "",
  };
}

export async function irisFetch(
  session: IrisSession,
  adamId: string,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<any> {
  let res;

  try {
    res = await http.request({
      method,
      url,
      data: body,
      headers: {
        ...buildIrisHeaders({
          accept: "",
          contentType: "",
          csrfToken: IRIS_CSRF_TOKEN,
          teamId: session.teamId,
          teamType: session.teamType,
          referer: `https://appstoreconnect.apple.com/apps/${adamId}/distribution/privacy`,
          cookies: session.cookies,
        }),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
      timeout: 60_000,
    });
  } catch (err: any) {
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      throw new WebSessionExpiredError(`ASC iris session rejected (${err.response.status})`);
    }

    throw err;
  }

  if (typeof res.data === "string") {
    throw new WebSessionExpiredError("ASC iris session returned a login page instead of JSON");
  }

  return res.data;
}

export async function listAppDataUsages(session: IrisSession, adamId: string): Promise<AppDataUsage[]> {
  const data = await irisFetch(session, adamId, "GET", dataUsagesListUrl(adamId));

  return ((data?.data ?? []) as any[]).map(toDataUsage);
}

export async function listDataUsageCategories(
  session: IrisSession,
  adamId: string,
): Promise<AppDataUsageCategory[]> {
  const data = await irisFetch(session, adamId, "GET", dataUsageCategoriesUrl());

  return ((data?.data ?? []) as any[]).map(toDataUsageCategory);
}

export async function getDataUsagePublishState(
  session: IrisSession,
  adamId: string,
): Promise<DataUsagePublishState> {
  const data = await irisFetch(session, adamId, "GET", dataUsagePublishStateUrl(adamId));

  return toDataUsagePublishState(data);
}

export async function createAppDataUsage(
  session: IrisSession,
  adamId: string,
  categoryId: string,
  purposeId?: string,
  dataProtectionId?: string,
): Promise<AppDataUsage> {
  const data = await irisFetch(
    session,
    adamId,
    "POST",
    `${IRIS_BASE_URL}/appDataUsages`,
    buildDataUsageCreateBody(adamId, categoryId, purposeId, dataProtectionId),
  );

  return toDataUsage(data?.data);
}

export async function deleteAppDataUsage(session: IrisSession, adamId: string, usageId: string): Promise<void> {
  await irisFetch(session, adamId, "DELETE", dataUsageDeleteUrl(usageId));
}
