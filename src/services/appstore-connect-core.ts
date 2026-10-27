import axios, { AxiosInstance } from "./utils/http";
import { logger } from "../config";
import { prisma } from "../config/database";
import { generateASCToken } from "./utils/asc-token";
import type {
  ASCAppInfo,
  ASCAppInfoLocalization,
  ASCAppStoreVersion,
  ASCCredentials,
  ASCRateLimit,
  ASCVersionLocalization,
} from "./appstore-connect-types";
import { parseRateLimitHeader } from "./appstore-connect-types";

export class AppStoreConnectCore {
  public client: AxiosInstance;
  protected token: string | null = null;
  protected tokenExpiry: number = 0;
  protected readonly issuerId: string;
  protected readonly keyId: string;
  protected readonly privateKey: string;
  protected readonly teamId: string | null;
  protected rateLimit: ASCRateLimit | null = null;

  constructor(override?: Partial<ASCCredentials>, options?: { teamId?: string }) {
    const issuerId = override?.issuerId;
    const keyId = override?.keyId;
    const privateKey = override?.privateKey;

    if (!issuerId || !keyId || !privateKey) {
      throw new Error("App Store Connect credentials missing.");
    }

    this.issuerId = issuerId;
    this.keyId = keyId;
    this.privateKey = privateKey;
    this.teamId = options?.teamId ?? null;

    this.client = axios.create({
      baseURL: "https://api.appstoreconnect.apple.com/v1",
      headers: { "Content-Type": "application/json" },
    });

    this.client.interceptors.request.use(async (config) => {
      const token = await this.getToken();

      config.headers.Authorization = `Bearer ${token}`;

      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        const header = response.headers["x-rate-limit"];

        if (header) {
          const parsed = parseRateLimitHeader(header);

          if (parsed) {
            this.updateRateLimit(parsed.limit, parsed.remaining);
          }
        }

        return response;
      },
      (error: any) => {
        const header = error?.response?.headers?.["x-rate-limit"];

        if (header) {
          const parsed = parseRateLimitHeader(header);

          if (parsed) {
            this.updateRateLimit(parsed.limit, parsed.remaining);
          }
        }

        if (error?.response?.status === 429) {
          const rl = this.rateLimit;
          const retryAfterSec = parseInt(error.response.headers?.["retry-after"], 10);
          const hasRetryAfter = Number.isFinite(retryAfterSec);
          const quotaNote = rl
            ? rl.hourRemaining > 0
              ? ` (hourly quota still has ${rl.hourRemaining}/${rl.hourLimit} left — this is a short-term burst limit, not the hourly cap)`
              : ` (hourly quota exhausted: ${rl.hourRemaining}/${rl.hourLimit})`
            : "";
          const waitNote = hasRetryAfter ? `retry after ${retryAfterSec}s` : "retry shortly";

          const rateLimitErr = new Error(`ASC 429: rate limited${quotaNote}. ${waitNote}.`);

          if (hasRetryAfter) {
            (rateLimitErr as Error & { ascRetryAfterMs?: number }).ascRetryAfterMs = retryAfterSec * 1000;
          }

          throw rateLimitErr;
        }

        throw error;
      },
    );
  }

  private updateRateLimit(limit: number, remaining: number): void {
    this.rateLimit = { hourLimit: limit, hourRemaining: remaining, updatedAt: new Date() };
    const pct = Math.round((remaining / limit) * 100);

    logger.debug(`ASC rate limit: ${remaining}/${limit} remaining (${pct}%)`);

    if (this.teamId) {
      prisma.ascRateLimit
        .upsert({
          where: { teamId: this.teamId },
          update: { hourLimit: limit, hourRemaining: remaining },
          create: { teamId: this.teamId, hourLimit: limit, hourRemaining: remaining },
        })
        .catch((err: unknown) => logger.warn("Failed to persist ASC rate limit", err));
    }
  }

  getRateLimit(): ASCRateLimit | null {
    return this.rateLimit;
  }

  private async getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.token && this.tokenExpiry > now + 60) {
      return this.token;
    }

    this.token = generateASCToken({
      issuerId: this.issuerId,
      keyId: this.keyId,
      privateKey: this.privateKey,
    });
    this.tokenExpiry = now + 20 * 60;

    logger.debug("Generated new ASC JWT token");

    return this.token;
  }

  async listApps(): Promise<ASCAppInfo[]> {
    const { data } = await this.client.get("/apps", {
      params: {
        "fields[apps]": "name,bundleId,sku,primaryLocale",
        limit: 200,
      },
    });

    return data.data ?? [];
  }

  async getApp(bundleId?: string): Promise<ASCAppInfo | null> {
    const bid = bundleId;
    const { data } = await this.client.get("/apps", {
      params: {
        "filter[bundleId]": bid,
        "fields[apps]": "name,bundleId,sku,primaryLocale",
      },
    });

    return data.data?.[0] ?? null;
  }

  async getAppInfoLocalizations(appId: string, appInfoId?: string, locale?: string): Promise<ASCAppInfoLocalization[]> {
    let resolvedAppInfoId = appInfoId;

    if (!resolvedAppInfoId) {
      resolvedAppInfoId = (await this.getAppInfoId(appId)) ?? undefined;
    }

    if (!resolvedAppInfoId) return [];

    const params: Record<string, string> = {
      "fields[appInfoLocalizations]": "locale,name,subtitle,privacyPolicyUrl",
    };

    if (locale) {
      params["filter[locale]"] = locale;
    }

    const { data } = await this.client.get(`/appInfos/${resolvedAppInfoId}/appInfoLocalizations`, {
      params,
    });

    return data.data ?? [];
  }

  async getLiveVersion(appId: string): Promise<ASCAppStoreVersion | null> {
    const { data } = await this.client.get(`/apps/${appId}/appStoreVersions`, {
      params: {
        "filter[appStoreState]": "READY_FOR_SALE",
        "filter[platform]": "IOS",
        "fields[appStoreVersions]": "versionString,appStoreState,platform,releaseType,copyright",
      },
    });

    return data.data?.[0] ?? null;
  }

  async listVersions(appId: string): Promise<ASCAppStoreVersion[]> {
    const { data } = await this.client.get(`/apps/${appId}/appStoreVersions`, {
      params: {
        "filter[platform]": "IOS",
        "fields[appStoreVersions]": "versionString,appStoreState,platform,releaseType,copyright",
        limit: 50,
      },
    });

    return data.data ?? [];
  }

  async updateVersionAttributes(versionId: string, updates: { copyright?: string }): Promise<void> {
    try {
      await this.client.patch(`/appStoreVersions/${versionId}`, {
        data: {
          type: "appStoreVersions",
          id: versionId,
          attributes: updates,
        },
      });
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async getVersionLocalizations(versionId: string, locale?: string): Promise<ASCVersionLocalization[]> {
    const params: Record<string, string> = {
      "fields[appStoreVersionLocalizations]":
        "locale,description,keywords,whatsNew,promotionalText,marketingUrl,supportUrl",
    };

    if (locale) {
      params["filter[locale]"] = locale;
    }

    const { data } = await this.client.get(`/appStoreVersions/${versionId}/appStoreVersionLocalizations`, { params });

    return data.data ?? [];
  }

  protected throwASCError(err: any): never {
    const ascErrors = err?.response?.data?.errors;

    if (ascErrors?.length) {
      const detail = ascErrors.map((e: any) => e.detail ?? e.title ?? JSON.stringify(e)).join("; ");
      throw new Error(`ASC ${err.response.status}: ${detail}`);
    }

    throw err;
  }

  async updateAppInfoLocalization(
    localizationId: string,
    updates: { name?: string; subtitle?: string; privacyPolicyUrl?: string },
  ): Promise<void> {
    try {
      await this.client.patch(`/appInfoLocalizations/${localizationId}`, {
        data: {
          type: "appInfoLocalizations",
          id: localizationId,
          attributes: updates,
        },
      });
      logger.info(`Updated app info localization ${localizationId}`, updates);
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async updateVersionLocalization(
    localizationId: string,
    updates: {
      description?: string;
      keywords?: string;
      whatsNew?: string;
      promotionalText?: string;
      supportUrl?: string;
      marketingUrl?: string;
    },
  ): Promise<void> {
    try {
      await this.client.patch(`/appStoreVersionLocalizations/${localizationId}`, {
        data: {
          type: "appStoreVersionLocalizations",
          id: localizationId,
          attributes: updates,
        },
      });
      logger.info(`Updated version localization ${localizationId}`, updates);
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async getAppInfoId(appId: string): Promise<string | null> {
    const { data } = await this.client.get(`/apps/${appId}/appInfos`, {
      params: { "fields[appInfos]": "appStoreState" },
    });

    const infos: any[] = data.data ?? [];
    const editableStates = new Set([
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
      "WAITING_FOR_REVIEW",
      "WAITING_FOR_EXPORT_COMPLIANCE",
      "PENDING_DEVELOPER_RELEASE",
      "IN_REVIEW",
    ]);
    const editable = infos.find((i) => editableStates.has(i.attributes?.appStoreState));

    return editable?.id ?? infos[0]?.id ?? null;
  }

  async createAppInfoLocalization(appInfoId: string, locale: string, name: string): Promise<ASCAppInfoLocalization> {
    try {
      const { data } = await this.client.post("/appInfoLocalizations", {
        data: {
          type: "appInfoLocalizations",
          attributes: { locale, name },
          relationships: {
            appInfo: { data: { type: "appInfos", id: appInfoId } },
          },
        },
      });

      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async createVersionLocalization(versionId: string, locale: string): Promise<ASCVersionLocalization> {
    try {
      const { data } = await this.client.post("/appStoreVersionLocalizations", {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale },
          relationships: {
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionId },
            },
          },
        },
      });

      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async deleteAppInfoLocalization(localizationId: string): Promise<void> {
    try {
      await this.client.delete(`/appInfoLocalizations/${localizationId}`);
    } catch (err: any) {
      if (err?.response?.status === 500) return;
      this.throwASCError(err);
    }
  }

  async deleteVersionLocalization(localizationId: string): Promise<void> {
    try {
      await this.client.delete(`/appStoreVersionLocalizations/${localizationId}`);
    } catch (err: any) {
      if (err?.response?.status === 500) return;
      this.throwASCError(err);
    }
  }

  async getEditableVersion(appId: string): Promise<ASCAppStoreVersion | null> {
    const editableStates = [
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
      "WAITING_FOR_REVIEW",
    ];

    const { data } = await this.client.get(`/apps/${appId}/appStoreVersions`, {
      params: {
        "filter[appStoreState]": editableStates.join(","),
        "filter[platform]": "IOS",
        "fields[appStoreVersions]": "versionString,appStoreState,platform,releaseType,copyright",
        limit: 5,
      },
    });

    return data.data?.[0] ?? null;
  }

  async createNewVersion(
    appId: string,
    versionString: string,
    releaseType: "MANUAL" | "AFTER_APPROVAL" = "MANUAL",
  ): Promise<ASCAppStoreVersion> {
    const { data } = await this.client.post("/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: {
          versionString,
          platform: "IOS",
          releaseType,
        },
        relationships: {
          app: {
            data: { type: "apps", id: appId },
          },
        },
      },
    });

    logger.info(`Created new App Store version ${versionString} (${data.data.id})`);

    return data.data;
  }

  async getOrCreateEditableVersion(appId: string): Promise<ASCAppStoreVersion> {
    const editable = await this.getEditableVersion(appId);

    if (editable) {
      logger.info(
        `Found editable version: ${editable.attributes.versionString} (${editable.attributes.appStoreState})`,
      );

      return editable;
    }

    const live = await this.getLiveVersion(appId);
    let nextVersion = "1.0.1";

    if (live) {
      const parts = live.attributes.versionString.split(".").map(Number);

      parts[parts.length - 1]++;
      nextVersion = parts.join(".");
    }

    logger.info(`No editable version found. Creating v${nextVersion}...`);

    return this.createNewVersion(appId, nextVersion);
  }
}
