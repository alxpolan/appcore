import axios, { AxiosInstance } from "./utils/http";
import { logger, env } from "../config";
import { prisma } from "../config/database";
import { generateASCToken } from "./utils/asc-token";
import {
  buildCreateLocalizationBody,
  buildCreatePageBody,
  buildCreateScreenshotSetBody,
  buildCreateVersionBody,
  buildReviewSubmissionBody,
  buildReviewSubmissionItemBody,
  buildSubmitReviewSubmissionBody,
  buildUpdateLocalizationBody,
  buildUpdatePageBody,
  buildUpdateVersionBody,
} from "./utils/custom-product-pages";

interface ASCAppInfo {
  id: string;
  type: string;
  attributes: {
    name: string;
    bundleId: string;
    sku: string;
    primaryLocale: string;
  };
}

interface ASCAppInfoLocalization {
  id: string;
  attributes: {
    locale: string;
    name: string;
    subtitle?: string;
    privacyPolicyUrl?: string;
  };
}

export interface ASCAppStoreVersion {
  id: string;
  attributes: {
    versionString: string;
    appStoreState: string;
    platform: string;
    releaseType: string;
    copyright?: string;
  };
}

interface ASCVersionLocalization {
  id: string;
  attributes: {
    locale: string;
    description?: string;
    keywords?: string;
    whatsNew?: string;
    promotionalText?: string;
    marketingUrl?: string;
    supportUrl?: string;
  };
}

export interface ASCScreenshotSet {
  id: string;
  attributes: {
    screenshotDisplayType: string;
  };
}

export interface ASCUploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: { name: string; value: string }[];
}

export interface ASCScreenshot {
  id: string;
  attributes: {
    uploadOperations: ASCUploadOperation[];
  };
}

export interface ASCImageAsset {
  templateUrl: string;
  width: number;
  height: number;
}

export interface ASCScreenshotWithAsset {
  id: string;
  attributes: {
    fileName?: string;
    fileSize?: number;
    sourceFileChecksum?: string;
    imageAsset?: ASCImageAsset | null;
    assetDeliveryState?: { state?: string } | null;
  };
}

export interface ASCCustomProductPage {
  id: string;
  attributes: {
    name: string;
    url?: string;
    visible?: boolean;
  };
}

export interface ASCCustomProductPageVersion {
  id: string;
  attributes: {
    version?: string;
    state?: string;
    deepLink?: string;
  };
}

export interface ASCCustomProductPageLocalization {
  id: string;
  attributes: {
    locale: string;
    promotionalText?: string;
  };
}

export interface ASCCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export interface ASCRateLimit {
  hourLimit: number;
  hourRemaining: number;
  updatedAt: Date;
}

function parseRateLimitHeader(header: string): { limit: number; remaining: number } | null {
  const lim = header.match(/user-hour-lim:(\d+)/)?.[1];
  const rem = header.match(/user-hour-rem:(\d+)/)?.[1];
  if (!lim || !rem) return null;
  return { limit: parseInt(lim, 10), remaining: parseInt(rem, 10) };
}

export class AppStoreConnectClient {
  public client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiry: number = 0;
  private readonly issuerId: string;
  private readonly keyId: string;
  private readonly privateKey: string;
  private readonly teamId: string | null;
  private rateLimit: ASCRateLimit | null = null;

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
          const limitStr = rl ? ` (${rl.hourRemaining}/${rl.hourLimit} remaining)` : "";
          throw new Error(`ASC rate limit exceeded${limitStr}. Warte ~1 Stunde und versuche es erneut.`);
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

  private throwASCError(err: any): never {
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

  async getCurrentASOState(
    locale: string,
    bundleId: string,
  ): Promise<{
    title?: string;
    subtitle?: string;
    description?: string;
    keywords?: string;
    whatsNew?: string;
    promotionalText?: string;
    supportUrl?: string;
    marketingUrl?: string;
    appInfoLocalizationId?: string;
    versionLocalizationId?: string;
    appId?: string;
    versionId?: string;
    versionString?: string;
    appStoreState?: string;
  } | null> {
    const app = await this.getApp(bundleId);
    if (!app) {
      logger.error(`App ${bundleId} not found in App Store Connect`);
      return null;
    }

    const [infoLocalizations, editableVersion] = await Promise.all([
      this.getAppInfoLocalizations(app.id),
      this.getEditableVersion(app.id),
    ]);
    const infoLoc = infoLocalizations.find((l) => l.attributes.locale === locale);

    const version = editableVersion ?? (await this.getLiveVersion(app.id));

    let versionLoc: ASCVersionLocalization | undefined;
    if (version) {
      const versionLocalizations = await this.getVersionLocalizations(version.id, locale);
      versionLoc = versionLocalizations[0];
    }

    return {
      title: infoLoc?.attributes.name,
      subtitle: infoLoc?.attributes.subtitle,
      description: versionLoc?.attributes.description,
      keywords: versionLoc?.attributes.keywords,
      whatsNew: versionLoc?.attributes.whatsNew,
      promotionalText: versionLoc?.attributes.promotionalText,
      supportUrl: versionLoc?.attributes.supportUrl,
      marketingUrl: versionLoc?.attributes.marketingUrl,
      appInfoLocalizationId: infoLoc?.id,
      versionLocalizationId: versionLoc?.id,
      appId: app.id,
      versionId: version?.id,
      versionString: version?.attributes.versionString,
      appStoreState: version?.attributes.appStoreState,
    };
  }

  async applyASOChanges(
    changes: {
      title?: string;
      subtitle?: string;
      description?: string;
      keywords?: string;
      whatsNew?: string;
      promotionalText?: string;
    },
    locale: string,
    bundleId: string,
  ): Promise<{
    applied: string[];
    errors: string[];
    versionId: string;
    versionString: string;
  }> {
    const applied: string[] = [];
    const errors: string[] = [];

    const app = await this.getApp(bundleId);
    if (!app) {
      throw new Error(`App ${bundleId} not found in App Store Connect`);
    }

    const version = await this.getOrCreateEditableVersion(app.id);
    const versionId = version.id;
    const versionString = version.attributes.versionString;

    logger.info(`Applying ASO changes to version ${versionString} (${version.attributes.appStoreState})`);

    const needsInfo = !!(changes.title || changes.subtitle);
    const needsVersion = !!(changes.description || changes.keywords || changes.whatsNew || changes.promotionalText);

    const [infoLocalizations, versionLocs] = await Promise.all([
      needsInfo ? this.getAppInfoLocalizations(app.id) : Promise.resolve([] as ASCAppInfoLocalization[]),
      needsVersion ? this.getVersionLocalizations(versionId, locale) : Promise.resolve([] as ASCVersionLocalization[]),
    ]);

    if (needsInfo) {
      try {
        const infoLoc = infoLocalizations.find((l) => l.attributes.locale === locale);

        if (infoLoc) {
          const updates: { name?: string; subtitle?: string } = {};
          if (changes.title) updates.name = changes.title;
          if (changes.subtitle) updates.subtitle = changes.subtitle;

          await this.updateAppInfoLocalization(infoLoc.id, updates);

          if (changes.title) applied.push(`Title → "${changes.title}"`);
          if (changes.subtitle) applied.push(`Subtitle → "${changes.subtitle}"`);
        } else {
          errors.push(
            `No appInfoLocalization found for locale "${locale}". Available: ${infoLocalizations.map((l) => l.attributes.locale).join(", ")}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (changes.title) errors.push(`Title update failed: ${msg}`);
        if (changes.subtitle) errors.push(`Subtitle update failed: ${msg}`);
      }
    }

    if (needsVersion) {
      try {
        const versionLoc = versionLocs[0];

        if (versionLoc) {
          const updates: {
            description?: string;
            keywords?: string;
            whatsNew?: string;
            promotionalText?: string;
          } = {};
          if (changes.description) updates.description = changes.description;
          if (changes.keywords) updates.keywords = changes.keywords;
          if (changes.whatsNew) updates.whatsNew = changes.whatsNew;
          if (changes.promotionalText) updates.promotionalText = changes.promotionalText;

          await this.updateVersionLocalization(versionLoc.id, updates);

          if (changes.description) applied.push("Description updated");
          if (changes.keywords) applied.push(`Keywords → "${changes.keywords}"`);
          if (changes.whatsNew) applied.push("What's New updated");
          if (changes.promotionalText) applied.push("Promotional Text updated");
        } else {
          errors.push(`No versionLocalization found for locale "${locale}" on version ${versionString}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Version localization update failed: ${msg}`);
      }
    }

    return { applied, errors, versionId, versionString };
  }

  async listScreenshotSets(localizationId: string): Promise<ASCScreenshotSet[]> {
    const { data } = await this.client.get(`/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`, {
      params: { "fields[appScreenshotSets]": "screenshotDisplayType" },
    });
    return data.data ?? [];
  }

  async listScreenshotsInSet(setId: string): Promise<ASCScreenshotWithAsset[]> {
    const { data } = await this.client.get(`/appScreenshotSets/${setId}/appScreenshots`, {
      params: {
        "fields[appScreenshots]": "fileName,fileSize,sourceFileChecksum,imageAsset,assetDeliveryState",
        limit: 200,
      },
    });
    return data.data ?? [];
  }

  async deleteScreenshotSet(setId: string): Promise<void> {
    try {
      await this.client.delete(`/appScreenshotSets/${setId}`);
    } catch (err: any) {
      if (err?.response?.status === 404) return;
      this.throwASCError(err);
    }
  }

  async createScreenshotSet(localizationId: string, displayType: string): Promise<ASCScreenshotSet> {
    try {
      const { data } = await this.client.post("/appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: "appStoreVersionLocalizations", id: localizationId },
            },
          },
        },
      });
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async reserveScreenshot(setId: string, fileName: string, fileSize: number): Promise<ASCScreenshot> {
    try {
      const { data } = await this.client.post("/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileSize, fileName },
          relationships: {
            appScreenshotSet: {
              data: { type: "appScreenshotSets", id: setId },
            },
          },
        },
      });
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async commitScreenshot(screenshotId: string, md5Hex: string): Promise<void> {
    try {
      await this.client.patch(`/appScreenshots/${screenshotId}`, {
        data: {
          type: "appScreenshots",
          id: screenshotId,
          attributes: { sourceFileChecksum: md5Hex, uploaded: true },
        },
      });
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async submitForReview(versionId: string): Promise<void> {
    await this.client.post("/appStoreVersionSubmissions", {
      data: {
        type: "appStoreVersionSubmissions",
        relationships: {
          appStoreVersion: {
            data: { type: "appStoreVersions", id: versionId },
          },
        },
      },
    });
    logger.info(`Submitted version ${versionId} for App Review`);
  }

  async getReviewDetail(versionId: string): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    demoAccountRequired: boolean;
    demoAccountName: string;
    demoAccountPassword: string;
  } | null> {
    try {
      const { data } = await this.client.get(`/appStoreVersions/${versionId}/appStoreReviewDetail`, {
        params: {
          "fields[appStoreReviewDetails]":
            "contactFirstName,contactLastName,contactPhone,contactEmail,demoAccountRequired,demoAccountName,demoAccountPassword",
        },
      });
      if (!data.data) return null;
      const a = data.data.attributes;
      return {
        id: data.data.id,
        firstName: a.contactFirstName ?? "",
        lastName: a.contactLastName ?? "",
        phone: a.contactPhone ?? "",
        email: a.contactEmail ?? "",
        demoAccountRequired: a.demoAccountRequired ?? false,
        demoAccountName: a.demoAccountName ?? "",
        demoAccountPassword: a.demoAccountPassword ?? "",
      };
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      return null;
    }
  }

  async upsertReviewDetail(
    versionId: string,
    existingDetailId: string | null,
    info: {
      firstName: string;
      lastName: string;
      phone: string;
      email: string;
      demoAccountRequired: boolean;
      demoAccountName?: string;
      demoAccountPassword?: string;
    },
  ): Promise<string> {
    const attributes: Record<string, any> = {
      contactFirstName: info.firstName,
      contactLastName: info.lastName,
      contactPhone: info.phone,
      contactEmail: info.email,
      demoAccountRequired: info.demoAccountRequired,
    };
    if (info.demoAccountRequired) {
      attributes.demoAccountName = info.demoAccountName ?? "";
      attributes.demoAccountPassword = info.demoAccountPassword ?? "";
    }

    try {
      if (existingDetailId) {
        await this.client.patch(`/appStoreReviewDetails/${existingDetailId}`, {
          data: {
            type: "appStoreReviewDetails",
            id: existingDetailId,
            attributes,
          },
        });
        return existingDetailId;
      } else {
        const { data } = await this.client.post("/appStoreReviewDetails", {
          data: {
            type: "appStoreReviewDetails",
            attributes,
            relationships: {
              appStoreVersion: {
                data: { type: "appStoreVersions", id: versionId },
              },
            },
          },
        });
        return data.data.id;
      }
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Custom Product Pages
  // ---------------------------------------------------------------------------

  async listCustomProductPages(appId: string): Promise<ASCCustomProductPage[]> {
    const { data } = await this.client.get(`/apps/${appId}/appCustomProductPages`, {
      params: { "fields[appCustomProductPages]": "name,url,visible", limit: 200 },
    });
    return data.data ?? [];
  }

  async getCustomProductPage(pageId: string): Promise<ASCCustomProductPage> {
    const { data } = await this.client.get(`/appCustomProductPages/${pageId}`, {
      params: { "fields[appCustomProductPages]": "name,url,visible" },
    });
    return data.data;
  }

  async createCustomProductPage(
    appId: string,
    name: string,
    locale: string,
  ): Promise<ASCCustomProductPage> {
    try {
      const { data } = await this.client.post(
        "/appCustomProductPages",
        buildCreatePageBody(appId, name, locale),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async updateCustomProductPage(
    pageId: string,
    updates: { name?: string; visible?: boolean },
  ): Promise<ASCCustomProductPage> {
    try {
      const { data } = await this.client.patch(
        `/appCustomProductPages/${pageId}`,
        buildUpdatePageBody(pageId, updates),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async deleteCustomProductPage(pageId: string): Promise<void> {
    try {
      await this.client.delete(`/appCustomProductPages/${pageId}`);
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async listCustomProductPageVersions(pageId: string): Promise<ASCCustomProductPageVersion[]> {
    const { data } = await this.client.get(`/appCustomProductPages/${pageId}/appCustomProductPageVersions`, {
      params: { "fields[appCustomProductPageVersions]": "version,state,deepLink", limit: 200 },
    });
    return data.data ?? [];
  }

  async getCustomProductPageVersion(versionId: string): Promise<ASCCustomProductPageVersion> {
    const { data } = await this.client.get(`/appCustomProductPageVersions/${versionId}`, {
      params: { "fields[appCustomProductPageVersions]": "version,state,deepLink" },
    });
    return data.data;
  }

  async createCustomProductPageVersion(pageId: string): Promise<ASCCustomProductPageVersion> {
    try {
      const { data } = await this.client.post("/appCustomProductPageVersions", buildCreateVersionBody(pageId));
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async updateCustomProductPageVersion(
    versionId: string,
    deepLink: string,
  ): Promise<ASCCustomProductPageVersion> {
    try {
      const { data } = await this.client.patch(
        `/appCustomProductPageVersions/${versionId}`,
        buildUpdateVersionBody(versionId, deepLink),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async listCustomProductPageLocalizations(versionId: string): Promise<ASCCustomProductPageLocalization[]> {
    const { data } = await this.client.get(
      `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations`,
      { params: { "fields[appCustomProductPageLocalizations]": "locale,promotionalText", limit: 200 } },
    );
    return data.data ?? [];
  }

  async createCustomProductPageLocalization(
    versionId: string,
    locale: string,
  ): Promise<ASCCustomProductPageLocalization> {
    try {
      const { data } = await this.client.post(
        "/appCustomProductPageLocalizations",
        buildCreateLocalizationBody(versionId, locale),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<ASCCustomProductPageLocalization> {
    try {
      const { data } = await this.client.patch(
        `/appCustomProductPageLocalizations/${localizationId}`,
        buildUpdateLocalizationBody(localizationId, promotionalText),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async deleteCustomProductPageLocalization(localizationId: string): Promise<void> {
    try {
      await this.client.delete(`/appCustomProductPageLocalizations/${localizationId}`);
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async listCustomProductPageScreenshotSets(localizationId: string): Promise<ASCScreenshotSet[]> {
    const { data } = await this.client.get(
      `/appCustomProductPageLocalizations/${localizationId}/appScreenshotSets`,
      { params: { "fields[appScreenshotSets]": "screenshotDisplayType" } },
    );
    return data.data ?? [];
  }

  async createCustomProductPageScreenshotSet(
    localizationId: string,
    displayType: string,
  ): Promise<ASCScreenshotSet> {
    try {
      const { data } = await this.client.post(
        "/appScreenshotSets",
        buildCreateScreenshotSetBody(localizationId, displayType),
      );
      return data.data;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }

  async deleteScreenshot(screenshotId: string): Promise<void> {
    try {
      await this.client.delete(`/appScreenshots/${screenshotId}`);
    } catch (err: any) {
      if (err?.response?.status === 404) return;
      this.throwASCError(err);
    }
  }

  async submitCustomProductPageVersionForReview(appId: string, versionId: string): Promise<string> {
    try {
      const { data: submissionResp } = await this.client.post(
        "/reviewSubmissions",
        buildReviewSubmissionBody(appId),
      );
      const submissionId = submissionResp.data.id;
      await this.client.post(
        "/reviewSubmissionItems",
        buildReviewSubmissionItemBody(submissionId, versionId),
      );
      await this.client.patch(
        `/reviewSubmissions/${submissionId}`,
        buildSubmitReviewSubmissionBody(submissionId),
      );
      logger.info(`Submitted custom product page version ${versionId} for App Review`);
      return submissionId;
    } catch (err: any) {
      this.throwASCError(err);
    }
  }
}
