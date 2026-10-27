import { logger } from "../config";
import type {
  ASCAppInfoLocalization,
  ASCScreenshot,
  ASCScreenshotSet,
  ASCScreenshotWithAsset,
  ASCVersionLocalization,
  ASCCustomProductPage,
  ASCCustomProductPageLocalization,
  ASCCustomProductPageVersion,
} from "./appstore-connect-types";
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
import { AppStoreConnectCore } from "./appstore-connect-core";

export class AppStoreConnectClient extends AppStoreConnectCore {
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
