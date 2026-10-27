import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { ProxyAgent, request as undiciRequest } from "undici";
import { logger, prisma } from "../config";
import type { EffectiveSettings } from "../config";
import { type AppStoreConnectClient, type ASCAppStoreVersion } from "./appstore-connect";
import { ascClientFromSettings } from "./asc-client";
import { getEffectiveFramed } from "./screenshot-studio";
import { Prisma } from "@prisma/client";
import { FALLBACK_LOCALES, type LocaleEntry } from "./fastlane-types";

const DIMENSION_TO_DISPLAY_TYPE: Record<string, string> = {
  "1320x2868": "APP_IPHONE_67",
  "2868x1320": "APP_IPHONE_67",
  "1290x2796": "APP_IPHONE_67",
  "2796x1290": "APP_IPHONE_67",
  "1206x2622": "APP_IPHONE_61",
  "2622x1206": "APP_IPHONE_61",
  "1284x2778": "APP_IPHONE_65",
  "2778x1284": "APP_IPHONE_65",
  "1242x2688": "APP_IPHONE_65",
  "2688x1242": "APP_IPHONE_65",
  "1179x2556": "APP_IPHONE_61",
  "2556x1179": "APP_IPHONE_61",
  "1170x2532": "APP_IPHONE_61",
  "2532x1170": "APP_IPHONE_61",
  "1125x2436": "APP_IPHONE_58",
  "2436x1125": "APP_IPHONE_58",
  "1242x2208": "APP_IPHONE_55",
  "2208x1242": "APP_IPHONE_55",
  "750x1334": "APP_IPHONE_47",
  "1334x750": "APP_IPHONE_47",
  "2064x2752": "APP_IPAD_PRO_3GEN_129",
  "2752x2064": "APP_IPAD_PRO_3GEN_129",
  "2048x2732": "APP_IPAD_PRO_3GEN_129",
  "2732x2048": "APP_IPAD_PRO_3GEN_129",
  "1668x2388": "APP_IPAD_PRO_3GEN_11",
  "2388x1668": "APP_IPAD_PRO_3GEN_11",
  "1668x2224": "APP_IPAD_105",
  "2224x1668": "APP_IPAD_105",
  "1536x2048": "APP_IPAD_97",
  "2048x1536": "APP_IPAD_97",
};

const FILENAME_DISPLAY_TYPE_PATTERNS: [RegExp, string][] = [
  [/iphone[_.\s]6\.9/i, "APP_IPHONE_67"],
  [/iphone[_.\s]6\.7/i, "APP_IPHONE_67"],
  [/iphone[_.\s]6\.5/i, "APP_IPHONE_65"],
  [/iphone[_.\s]6\.3/i, "APP_IPHONE_61"],
  [/iphone[_.\s]6\.1/i, "APP_IPHONE_61"],
  [/iphone[_.\s]5\.8/i, "APP_IPHONE_58"],
  [/iphone[_.\s]5\.5/i, "APP_IPHONE_55"],
  [/iphone[_.\s]4\.7/i, "APP_IPHONE_47"],
  [/ipad.pro.12\.9/i, "APP_IPAD_PRO_3GEN_129"],
  [/ipad.pro.11/i, "APP_IPAD_PRO_3GEN_11"],
  [/ipad.10\.5/i, "APP_IPAD_105"],
  [/ipad.9\.7/i, "APP_IPAD_97"],
];

const cdnAgent = new ProxyAgent({
  uri: "http://192.168.88.253:3128",
  connectTimeout: 30_000,
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

async function uploadChunk(url: string, method: string, headers: Record<string, string>, data: Buffer): Promise<void> {
  try {
    const { statusCode, body } = await undiciRequest(url, {
      method: method as "PUT" | "POST" | "GET" | "DELETE" | "PATCH" | "HEAD",
      headers: { ...headers, "content-length": String(data.length) },
      body: data,
      dispatcher: cdnAgent,
    });

    await body.dump();

    if (statusCode >= 400) {
      throw new Error(`CDN upload failed: HTTP ${statusCode}`);
    }
  } catch (err: any) {
    const cause = err?.cause?.message ?? err?.cause?.code ?? "";

    throw new Error(
      `CDN upload failed: ${err?.message ?? err}${cause ? ` (cause: ${cause})` : ""} — URL host: ${new URL(url).hostname}`,
    );
  }
}

async function getDisplayType(
  imagePath: string,
): Promise<{ displayType: string | null; width?: number; height?: number }> {
  const { width, height } = await sharp(imagePath).metadata();

  if (width && height) {
    const byDim = DIMENSION_TO_DISPLAY_TYPE[`${width}x${height}`];
    if (byDim) return { displayType: byDim, width, height };
  }

  const filename = path.basename(imagePath);
  for (const [pattern, type] of FILENAME_DISPLAY_TYPE_PATTERNS) {
    if (pattern.test(filename)) return { displayType: type, width, height };
  }

  return { displayType: null, width, height };
}

export class FastlaneUploads {
  protected readonly bundleId: string;
  protected settings: EffectiveSettings;
  protected asc: AppStoreConnectClient;

  constructor(bundleId: string, settings: EffectiveSettings) {
    this.bundleId = bundleId;
    this.settings = settings;

    const asc = ascClientFromSettings(settings);

    if (!asc) {
      throw new Error("App Store Connect credentials not configured. Set them in Settings.");
    }

    this.asc = asc;
  }

  protected async resolveAppId(): Promise<string | null> {
    const app = await prisma.app.findFirst({
      where: { bundleId: this.bundleId },
      select: { id: true },
    });

    return app?.id ?? null;
  }

  protected async loadFramedScreenshotPaths(): Promise<Record<
    string,
    Array<{ filename: string; absPath: string }>
  > | null> {
    try {
      const appId = await this.resolveAppId();
      if (!appId) return null;

      const app = await prisma.app.findUnique({ where: { id: appId }, select: { selectedScreenshotJobId: true } });

      const selected = app?.selectedScreenshotJobId
        ? await prisma.screenshotJob.findFirst({
            where: {
              id: app.selectedScreenshotJobId,
              appId,
              status: "COMPLETED",
              framedByLocale: { not: Prisma.AnyNull },
            },
            select: { id: true },
          })
        : null;

      const job =
        selected ??
        (await prisma.screenshotJob.findFirst({
          where: {
            appId,
            status: "COMPLETED",
            framedByLocale: { not: Prisma.AnyNull },
          },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        }));

      if (!job) return null;

      const { framedByLocale } = await getEffectiveFramed(job.id);
      const screenshots: Record<string, Array<{ filename: string; absPath: string }>> = {};

      for (const [locale, urls] of Object.entries(framedByLocale)) {
        const images: Array<{ filename: string; absPath: string }> = [];

        for (const url of urls) {
          const absPath = path.join(process.cwd(), url);

          if (fs.existsSync(absPath)) {
            images.push({ filename: path.basename(absPath), absPath });
          }
        }

        if (images.length > 0) screenshots[locale] = images;
      }

      return Object.keys(screenshots).length > 0 ? screenshots : null;
    } catch (err) {
      logger.warn("[Fastlane] Could not load framed screenshot paths:", err);

      return null;
    }
  }

  protected async loadLatestIpaPath(): Promise<string | null> {
    try {
      const appId = await this.resolveAppId();
      if (!appId) return null;

      const app = await prisma.app.findUnique({ where: { id: appId }, select: { selectedBuildJobId: true } });

      const selected = app?.selectedBuildJobId
        ? await prisma.buildJob.findFirst({
            where: { id: app.selectedBuildJobId, appId, status: "COMPLETED", ipaPath: { not: null } },
            select: { ipaPath: true },
          })
        : null;

      const buildJob =
        selected ??
        (await prisma.buildJob.findFirst({
          where: { appId, status: "COMPLETED", ipaPath: { not: null } },
          orderBy: { completedAt: "desc" },
          select: { ipaPath: true },
        }));

      if (!buildJob?.ipaPath) return null;

      return fs.existsSync(buildJob.ipaPath) ? buildJob.ipaPath : null;
    } catch (err) {
      logger.warn("[Fastlane] Could not load latest IPA path:", err);

      return null;
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async withAscRetry<T>(label: string, onLog: (line: string) => void, fn: () => Promise<T>): Promise<T> {
    const retryDelaysMs = [5000, 15000, 30000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTransientServerError = /ASC 5\d\d:/.test(msg);
        if (!isTransientServerError || attempt >= retryDelaysMs.length) throw err;

        const delay = retryDelaysMs[attempt];
        onLog(
          `[Screenshots] ${label} failed (${msg}). Retrying in ${delay / 1000}s… (attempt ${attempt + 2}/${retryDelaysMs.length + 1})`,
        );
        await this.sleep(delay);
      }
    }
  }

  protected async uploadScreenshotsViaASC(
    screenshotPaths: Record<string, Array<{ filename: string; absPath: string }>>,
    locales: string[],
    onLog: (line: string) => void,
    onScreenshotDone?: () => void,
  ): Promise<void> {
    const app = await this.asc.getApp(this.bundleId);
    if (!app) throw new Error("App not found in App Store Connect");

    const editable = await this.asc.getEditableVersion(app.id);
    if (!editable) throw new Error("No editable version found for screenshot upload");

    const versionLocales = await this.asc.getVersionLocalizations(editable.id);
    const localeToLocId = Object.fromEntries(versionLocales.map((l) => [l.attributes.locale, l.id]));
    const fallbackLocale = FALLBACK_LOCALES.find((l) => screenshotPaths[l]) ?? Object.keys(screenshotPaths)[0];
    const fallbackImages = fallbackLocale ? screenshotPaths[fallbackLocale] : undefined;

    const logRateLimit = () => {
      const rl = this.asc.getRateLimit();

      if (rl) {
        const pct = Math.round((rl.hourRemaining / rl.hourLimit) * 100);

        onLog(`[Screenshots] ASC Rate Limit: ${rl.hourRemaining}/${rl.hourLimit} remaining (${pct}%)`);

        if (rl.hourRemaining < 100) {
          onLog(`[Screenshots] Rate limit critically low (${rl.hourRemaining} left). Upload may fail.`);
        }
      }
    };

    logRateLimit();

    for (const locale of locales) {
      const localizationId = localeToLocId[locale];

      if (!localizationId) {
        onLog(`[Screenshots] No localization found for ${locale}, skipping`);
        continue;
      }

      const images = screenshotPaths[locale] ?? fallbackImages;
      if (!images || images.length === 0) continue;

      const isFallback = !screenshotPaths[locale];
      onLog(
        `[Screenshots] ${locale}: ${images.length} image(s)${isFallback ? ` (fallback from ${fallbackLocale})` : ""}`,
      );

      const existingSets = await this.withAscRetry(`${locale}: list screenshot sets`, onLog, () =>
        this.asc.listScreenshotSets(localizationId),
      );

      await Promise.all(
        existingSets.map((s) =>
          this.withAscRetry(`${locale}: delete screenshot set`, onLog, () => this.asc.deleteScreenshotSet(s.id)),
        ),
      );

      if (existingSets.length > 0) {
        onLog(`[Screenshots] ${locale}: removed ${existingSets.length} existing set(s)`);
      }

      onLog(`[Screenshots] ${locale}: detecting display types...`);
      const byDisplayType = new Map<string, Array<{ filename: string; absPath: string }>>();
      for (const img of images) {
        const { displayType, width, height } = await getDisplayType(img.absPath);

        if (!displayType) {
          onLog(`[Screenshots] Cannot determine display type for ${img.filename} (${width}x${height}), skipping`);
          continue;
        }

        onLog(`[Screenshots] ${locale}: ${img.filename} → ${displayType}`);
        if (!byDisplayType.has(displayType)) byDisplayType.set(displayType, []);
        byDisplayType.get(displayType)!.push(img);
      }

      for (const [displayType, imgs] of byDisplayType) {
        onLog(`[Screenshots] ${locale}: creating set for ${displayType} (${imgs.length} image(s))...`);
        const set = await this.withAscRetry(`${locale}: create screenshot set`, onLog, () =>
          this.asc.createScreenshotSet(localizationId, displayType),
        );

        onLog(`[Screenshots] ${locale}: set created (${set.id})`);

        for (const img of imgs) {
          const fileData = await fs.promises.readFile(img.absPath);
          const md5 = createHash("md5").update(fileData).digest("hex");

          onLog(`[Screenshots] ${locale}: reserving slot for ${img.filename} (${fileData.length} bytes)...`);
          const reserved = await this.withAscRetry(`${locale}: reserve ${img.filename}`, onLog, () =>
            this.asc.reserveScreenshot(set.id, img.filename, fileData.length),
          );

          onLog(`[Screenshots] ${locale}: uploading ${reserved.attributes.uploadOperations.length} chunk(s)...`);

          for (let i = 0; i < reserved.attributes.uploadOperations.length; i++) {
            const op = reserved.attributes.uploadOperations[i];
            const chunk = Buffer.from(fileData.subarray(op.offset, op.offset + op.length));
            const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));

            onLog(
              `[Screenshots] ${locale}: chunk ${i + 1}/${reserved.attributes.uploadOperations.length} → ${op.method} (${chunk.length} bytes)`,
            );
            await uploadChunk(op.url, op.method, headers, chunk);
          }

          onLog(`[Screenshots] ${locale}: committing ${img.filename}...`);
          await this.withAscRetry(`${locale}: commit ${img.filename}`, onLog, () =>
            this.asc.commitScreenshot(reserved.id, md5),
          );
          onLog(`[Screenshots] ${locale}: done ${img.filename} (${displayType})`);
          onScreenshotDone?.();
          logRateLimit();
        }
      }
    }

    onLog("[Screenshots] All screenshots uploaded successfully");
  }

  protected async uploadMetadataViaASC(
    localeData: Record<string, LocaleEntry>,
    version: ASCAppStoreVersion,
    appId: string,
    onLog: (line: string) => void,
    onLocaleDone?: () => void,
  ): Promise<void> {
    onLog("Uploading metadata via App Store Connect API...");

    await this.asc.updateVersionAttributes(version.id, {
      copyright: `© ${new Date().getFullYear()} Fringelo Group`,
    });
    onLog("[Metadata] Copyright updated");

    const [appInfoLocalizations, versionLocalizations] = await Promise.all([
      this.asc.getAppInfoLocalizations(appId),
      this.asc.getVersionLocalizations(version.id),
    ]);

    const infoLocByLocale = new Map(appInfoLocalizations.map((l) => [l.attributes.locale, l]));
    const versionLocByLocale = new Map(versionLocalizations.map((l) => [l.attributes.locale, l]));

    for (const [locale, data] of Object.entries(localeData)) {
      onLog(`[Metadata] Processing locale: ${locale}`);

      const infoLoc = infoLocByLocale.get(locale);

      if (infoLoc) {
        const updates: { name?: string; subtitle?: string } = {};
        if (data.name) updates.name = data.name;
        if (data.subtitle !== undefined) updates.subtitle = data.subtitle;

        if (Object.keys(updates).length > 0) {
          await this.asc.updateAppInfoLocalization(infoLoc.id, updates);
          onLog(`[Metadata] ${locale}: name/subtitle updated`);
        }
      } else {
        onLog(`[Metadata] ${locale}: no app info localization found, skipping name/subtitle`);
      }

      let versionLoc = versionLocByLocale.get(locale);

      if (!versionLoc) {
        onLog(`[Metadata] ${locale}: creating version localization...`);
        versionLoc = await this.asc.createVersionLocalization(version.id, locale);
        onLog(`[Metadata] ${locale}: version localization created (${versionLoc.id})`);
      }

      const versionUpdates: {
        description?: string;
        keywords?: string;
        whatsNew?: string;
        promotionalText?: string;
        supportUrl?: string;
        marketingUrl?: string;
      } = {};
      if (data.description) versionUpdates.description = data.description;
      if (data.keywords) versionUpdates.keywords = data.keywords;
      if (data.whatsNew) versionUpdates.whatsNew = data.whatsNew;
      if (data.promotionalText) versionUpdates.promotionalText = data.promotionalText;
      if (data.supportUrl) versionUpdates.supportUrl = data.supportUrl;
      if (data.marketingUrl) versionUpdates.marketingUrl = data.marketingUrl;

      if (Object.keys(versionUpdates).length > 0) {
        await this.asc.updateVersionLocalization(versionLoc.id, versionUpdates);
        onLog(`[Metadata] ${locale}: version localization updated`);
      }

      onLocaleDone?.();
    }

    onLog("[Metadata] All metadata uploaded successfully");
  }
}
