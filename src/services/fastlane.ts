import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import sharp from "sharp";
import { ProxyAgent, request as undiciRequest } from "undici";
import { Prisma } from "@prisma/client";
import { logger, prisma } from "../config";
import { env } from "../config/env";
import type { EffectiveSettings } from "../config";
import { type AppStoreConnectClient, type ASCAppStoreVersion } from "./appstore-connect";
import { ascClientFromSettings } from "./asc-client";
import { workerClient } from "./worker-client";

export const ipaDownloadTokens = new Map<string, string>();
export const appStoreInfoTokens = new Map<string, string>();

export interface SubmissionPreview {
  appId: string;
  bundleId: string;
  appName: string;
  versionString: string | null;
  appStoreState: string | null;
  isEditable: boolean;
  locales: {
    locale: string;
    name: string;
    subtitle: string;
    keywords: string;
    description: string;
    whatsNew: string;
    promotionalText: string;
  }[];
}

export interface SubmissionResult {
  ok: boolean;
  jobId: string;
  action: SubmitAction;
  versionString: string | null;
  logs: string[];
  errors: string[];
}

type SubmitAction = "metadata" | "submit_for_review" | "binary";

interface LocaleEntry {
  name: string;
  subtitle: string;
  keywords: string;
  description: string;
  whatsNew: string;
  promotionalText: string;
  supportUrl: string;
  marketingUrl: string;
}

export type PhaseState = "pending" | "running" | "done" | "skipped" | "failed";

export interface PhaseProgress {
  state: PhaseState;
  current: number;
  total: number;
}

export interface SubmissionPhases {
  binary: PhaseProgress;
  metadata: PhaseProgress;
  screenshots: PhaseProgress;
}

interface ActiveSubmission {
  jobId: string;
  logs: string[];
  errors: string[];
  status: "preparing" | "running" | "completed" | "failed";
  startedAt: Date;
  action: SubmitAction;
  phases: SubmissionPhases;
}

function initialPhases(action: SubmitAction): SubmissionPhases {
  return {
    binary: { state: "pending", current: 0, total: 1 },
    metadata: { state: action === "binary" ? "skipped" : "pending", current: 0, total: 0 },
    screenshots: { state: action === "binary" ? "skipped" : "pending", current: 0, total: 0 },
  };
}

const DIMENSION_TO_DISPLAY_TYPE: Record<string, string> = {
  "1320x2868": "APP_IPHONE_67", // 6.9" iPhone 16 Pro Max → uses 6.7" slot
  "2868x1320": "APP_IPHONE_67",
  "1290x2796": "APP_IPHONE_67",
  "2796x1290": "APP_IPHONE_67",
  "1206x2622": "APP_IPHONE_61", // 6.3" iPhone 16 Pro → uses 6.1" slot
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
  [/iphone[_.\s]6\.9/i, "APP_IPHONE_67"], // 6.9" device maps to 6.7" ASC slot
  [/iphone[_.\s]6\.7/i, "APP_IPHONE_67"],
  [/iphone[_.\s]6\.5/i, "APP_IPHONE_65"],
  [/iphone[_.\s]6\.3/i, "APP_IPHONE_61"], // 6.3" device maps to 6.1" ASC slot
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
  uri: "http://188.166.86.200:3128",
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

const FALLBACK_LOCALES = ["en-US", "en-GB"];
const SUBMISSION_TTL_MS = 60 * 60 * 1000;
const activeSubmissions = new Map<string, ActiveSubmission>();
let latestJobId: string | undefined;

export function getActiveSubmission(jobId: string): ActiveSubmission | undefined {
  return activeSubmissions.get(jobId);
}

export function getLatestSubmission(): ActiveSubmission | undefined {
  return latestJobId ? activeSubmissions.get(latestJobId) : undefined;
}

export class FastlaneService {
  private readonly bundleId: string;
  private settings: EffectiveSettings;
  private asc: AppStoreConnectClient;

  constructor(bundleId: string, settings: EffectiveSettings) {
    this.bundleId = bundleId;
    this.settings = settings;

    const asc = ascClientFromSettings(settings);
    if (!asc) {
      throw new Error("App Store Connect credentials not configured. Set them in Settings.");
    }
    this.asc = asc;
  }

  async preview(): Promise<SubmissionPreview> {
    const app = await this.asc.getApp(this.bundleId);
    if (!app) throw new Error("App not found in App Store Connect");

    const [editable, live, infoLocales] = await Promise.all([
      this.asc.getEditableVersion(app.id),
      this.asc.getLiveVersion(app.id),
      this.asc.getAppInfoLocalizations(app.id).catch(() => []),
    ]);

    const version = editable ?? live;
    const versionLocales = version ? await this.asc.getVersionLocalizations(version.id) : [];
    const locales = infoLocales.length > 0 ? infoLocales.map((l) => l.attributes.locale).filter(Boolean) : ["en-US"];

    const localeData: SubmissionPreview["locales"] = locales.map((locale) => {
      const iLoc = infoLocales.find((l) => l.attributes.locale === locale);
      const vLoc = versionLocales.find((l) => l.attributes.locale === locale);

      return {
        locale,
        name: iLoc?.attributes.name ?? "",
        subtitle: iLoc?.attributes.subtitle ?? "",
        keywords: vLoc?.attributes.keywords ?? "",
        description: vLoc?.attributes.description ?? "",
        whatsNew: vLoc?.attributes.whatsNew ?? "",
        promotionalText: vLoc?.attributes.promotionalText ?? "",
      };
    });

    return {
      appId: app.id,
      bundleId: app.attributes.bundleId,
      appName: app.attributes.name,
      versionString: version?.attributes.versionString ?? null,
      appStoreState: version?.attributes.appStoreState ?? null,
      isEditable: !!editable,
      locales: localeData,
    };
  }

  async submit(
    action: SubmitAction,
    overrides?: Record<
      string,
      {
        name?: string;
        subtitle?: string;
        keywords?: string;
        description?: string;
        whatsNew?: string;
        promotionalText?: string;
      }
    >,
  ): Promise<SubmissionResult> {
    const jobId = randomUUID();
    const submission: ActiveSubmission = {
      jobId,
      logs: [],
      errors: [],
      status: "preparing",
      startedAt: new Date(),
      action,
      phases: initialPhases(action),
    };

    activeSubmissions.set(jobId, submission);
    latestJobId = jobId;

    let versionString: string | null = null;
    try {
      if (action === "binary") {
        submission.status = "running";
        submission.phases.binary.state = "running";
        const binaryResult = await this.runBinaryUpload({
          onLog: (line) => submission.logs.push(line),
          onError: (line) => submission.errors.push(line),
        });
        submission.phases.binary.state = binaryResult.errors.length > 0 ? "failed" : "done";
        submission.phases.binary.current = submission.phases.binary.state === "done" ? 1 : 0;
      } else {
        submission.logs.push("Step 1: Uploading binary...");
        submission.status = "running";
        submission.phases.binary.state = "running";
        const binaryResult = await this.runBinaryUpload({
          onLog: (line) => submission.logs.push(line),
          onError: (line) => submission.errors.push(line),
        });

        if (binaryResult.errors.length > 0) {
          submission.phases.binary.state = "failed";
          throw new Error(`Binary upload failed: ${binaryResult.errors.join("; ")}`);
        }
        submission.phases.binary.state = "done";
        submission.phases.binary.current = 1;

        submission.logs.push("Step 2: Preparing metadata...");
        const prepared = await this.prepareMetadataLocales(action, overrides);
        versionString = prepared.versionString;

        submission.logs.push(
          `Metadata prepared for ${Object.keys(prepared.localeData).length} locale(s). Uploading via ASC API...`,
        );

        await this.runAscUpload({
          localeData: prepared.localeData,
          appId: prepared.appId,
          version: prepared.version,
          action,
          phases: submission.phases,
          onLog: (line) => submission.logs.push(line),
          onError: (line) => submission.errors.push(line),
        });
      }

      submission.status = submission.errors.length > 0 ? "failed" : "completed";
      return {
        ok: submission.errors.length === 0,
        jobId,
        action,
        versionString,
        logs: submission.logs,
        errors: submission.errors,
      };
    } catch (err) {
      const axiosErr = err as any;
      const cause = axiosErr?.cause?.message ?? axiosErr?.cause?.code ?? "";
      const code = axiosErr?.code ?? "";
      const status = axiosErr?.response?.status ?? "";
      const msg = `${err instanceof Error ? err.message : String(err)}${code ? ` [${code}]` : ""}${status ? ` HTTP ${status}` : ""}${cause ? ` (cause: ${cause})` : ""}`;

      submission.errors.push(msg);
      logger.error("[ASC] upload failed:", { message: msg, code, status, cause });
      submission.status = "failed";
      return {
        ok: false,
        jobId,
        action,
        versionString,
        logs: submission.logs,
        errors: submission.errors,
      };
    } finally {
      setTimeout(() => activeSubmissions.delete(jobId), SUBMISSION_TTL_MS);
    }
  }

  private async resolveAppId(): Promise<string | null> {
    const app = await prisma.app.findFirst({
      where: { bundleId: this.bundleId },
      select: { id: true },
    });
    return app?.id ?? null;
  }

  private async loadFramedScreenshotPaths(): Promise<Record<
    string,
    Array<{ filename: string; absPath: string }>
  > | null> {
    try {
      const appId = await this.resolveAppId();
      if (!appId) return null;

      const job = await prisma.screenshotJob.findFirst({
        where: {
          appId,
          status: "COMPLETED",
          framedByLocale: { not: Prisma.AnyNull },
        },
        orderBy: { completedAt: "desc" },
        select: { framedByLocale: true },
      });
      if (!job?.framedByLocale) return null;

      const framedByLocale = job.framedByLocale as Record<string, string[]>;
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

  private async loadLatestIpaPath(): Promise<string | null> {
    try {
      const appId = await this.resolveAppId();
      if (!appId) return null;

      const buildJob = await prisma.buildJob.findFirst({
        where: { appId, status: "COMPLETED", ipaPath: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { ipaPath: true },
      });
      if (!buildJob?.ipaPath) return null;

      return fs.existsSync(buildJob.ipaPath) ? buildJob.ipaPath : null;
    } catch (err) {
      logger.warn("[Fastlane] Could not load latest IPA path:", err);
      return null;
    }
  }

  private async uploadScreenshotsViaASC(
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

      const existingSets = await this.asc.listScreenshotSets(localizationId);
      await Promise.all(existingSets.map((s) => this.asc.deleteScreenshotSet(s.id)));

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
        const set = await this.asc.createScreenshotSet(localizationId, displayType);
        onLog(`[Screenshots] ${locale}: set created (${set.id})`);

        for (const img of imgs) {
          const fileData = await fs.promises.readFile(img.absPath);
          const md5 = createHash("md5").update(fileData).digest("hex");

          onLog(`[Screenshots] ${locale}: reserving slot for ${img.filename} (${fileData.length} bytes)...`);
          const reserved = await this.asc.reserveScreenshot(set.id, img.filename, fileData.length);
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
          await this.asc.commitScreenshot(reserved.id, md5);
          onLog(`[Screenshots] ${locale}: done ${img.filename} (${displayType})`);
          onScreenshotDone?.();
          logRateLimit();
        }
      }
    }

    onLog("[Screenshots] All screenshots uploaded successfully");
  }

  private async uploadMetadataViaASC(
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

  private async runAscUpload(opts: {
    localeData: Record<string, LocaleEntry>;
    appId: string;
    version: ASCAppStoreVersion;
    action: SubmitAction;
    phases: SubmissionPhases;
    onLog?: (line: string) => void;
    onError?: (line: string) => void;
  }): Promise<{ logs: string[]; errors: string[] }> {
    const { localeData, appId, version, action, phases, onLog, onError } = opts;
    const logs: string[] = [];
    const errors: string[] = [];

    const pushLog = (line: string) => {
      logs.push(line);
      onLog?.(line);
    };

    const pushError = (line: string) => {
      errors.push(line);
      onError?.(line);
    };

    try {
      phases.metadata.state = "running";
      phases.metadata.total = Object.keys(localeData).length;
      phases.metadata.current = 0;
      await this.uploadMetadataViaASC(localeData, version, appId, pushLog, () => {
        phases.metadata.current += 1;
      });
      phases.metadata.state = "done";
      phases.metadata.current = phases.metadata.total;

      const screenshotPaths = await this.loadFramedScreenshotPaths();
      if (screenshotPaths && Object.keys(screenshotPaths).length > 0) {
        pushLog("Uploading screenshots via App Store Connect API...");
        const targetLocales = Object.keys(localeData);
        const fallbackLocale =
          FALLBACK_LOCALES.find((l) => screenshotPaths[l]) ?? Object.keys(screenshotPaths)[0];
        const fallbackCount = fallbackLocale ? (screenshotPaths[fallbackLocale]?.length ?? 0) : 0;
        let totalScreenshots = 0;
        for (const loc of targetLocales) {
          totalScreenshots += (screenshotPaths[loc] ?? Array(fallbackCount).fill(null)).length;
        }
        phases.screenshots.state = "running";
        phases.screenshots.total = totalScreenshots;
        phases.screenshots.current = 0;

        try {
          await this.uploadScreenshotsViaASC(screenshotPaths, targetLocales, pushLog, () => {
            phases.screenshots.current += 1;
          });
          phases.screenshots.state = "done";
          phases.screenshots.current = phases.screenshots.total;
        } catch (ssErr: any) {
          const msg = ssErr instanceof Error ? ssErr.message : String(ssErr);
          pushLog(`[Screenshots] Upload failed (non-fatal): ${msg}`);
          pushLog("[Screenshots] Continuing. To fix: add Oracle Cloud egress rule for 17.0.0.0/8 HTTPS.");
          phases.screenshots.state = "failed";
        }
      } else {
        pushLog("No framed screenshots found, skipping screenshot upload.");
        phases.screenshots.state = "skipped";
      }

      if (action === "submit_for_review") {
        pushLog("Submitting for App Review...");
        await this.asc.submitForReview(version.id);
        pushLog("Submitted for App Review successfully.");
      }

      return { logs, errors };
    } catch (err: any) {
      const cause = err?.cause?.message ?? err?.cause?.code ?? "";
      pushError(`${err instanceof Error ? err.message : String(err)}${cause ? ` — cause: ${cause}` : ""}`);
      return { logs, errors };
    }
  }

  private async runBinaryUpload(opts: {
    onLog?: (line: string) => void;
    onError?: (line: string) => void;
  }): Promise<{ logs: string[]; errors: string[] }> {
    const { onLog, onError } = opts;
    const logs: string[] = [];
    const errors: string[] = [];

    const pushLog = (line: string) => {
      logs.push(line);
      onLog?.(line);
    };

    const pushError = (line: string) => {
      errors.push(line);
      onError?.(line);
    };

    try {
      const ipaPath = await this.loadLatestIpaPath();
      if (!ipaPath) throw new Error("No IPA found. Build the app first before uploading the binary.");
      pushLog(`IPA found: ${ipaPath}`);

      if (!env.SERVER_INTERNAL_URL) throw new Error("SERVER_INTERNAL_URL not set. Cannot serve IPA to worker.");
      const token = randomUUID();
      ipaDownloadTokens.set(token, ipaPath);
      setTimeout(() => ipaDownloadTokens.delete(token), 10 * 60 * 1000).unref();

      const ipaUrl = `${env.SERVER_INTERNAL_URL}/internal/ipa/${token}`;
      const appStoreInfoPath = path.join(path.dirname(ipaPath), "latest.appstoreinfo.plist");
      let appStoreInfoUrl: string | undefined;

      if (fs.existsSync(appStoreInfoPath)) {
        const infoToken = randomUUID();
        appStoreInfoTokens.set(infoToken, appStoreInfoPath);
        setTimeout(() => appStoreInfoTokens.delete(infoToken), 10 * 60 * 1000).unref();
        appStoreInfoUrl = `${env.SERVER_INTERNAL_URL}/internal/appstoreinfo/${infoToken}`;
      }

      pushLog(`IPA download URL created, sending job to transporter worker...`);

      const result = await workerClient.uploadBinary(
        {
          ipaUrl,
          appStoreInfoUrl,
          keyId: this.settings.ascKeyId!,
          issuerId: this.settings.ascIssuerId!,
          privateKey: this.settings.ascPrivateKey!,
        },
        pushLog,
      );

      for (const line of result.errors) pushError(line);

      return { logs, errors };
    } catch (err: any) {
      const cause = err?.cause?.message ?? err?.cause?.code ?? "";
      pushError(`${err instanceof Error ? err.message : String(err)}${cause ? ` — cause: ${cause}` : ""}`);
      return { logs, errors };
    }
  }

  private async prepareMetadataLocales(
    action: SubmitAction,
    overrides?: Record<
      string,
      {
        name?: string;
        subtitle?: string;
        keywords?: string;
        description?: string;
        whatsNew?: string;
        promotionalText?: string;
      }
    >,
  ): Promise<{
    localeData: Record<string, LocaleEntry>;
    versionString: string | null;
    appId: string;
    version: ASCAppStoreVersion;
  }> {
    const app = await this.asc.getApp(this.bundleId);
    if (!app) throw new Error("App not found in App Store Connect");

    const version = await this.asc.getOrCreateEditableVersion(app.id);

    const [versionLocalizations, appInfoLocalizations] = await Promise.all([
      this.asc.getVersionLocalizations(version.id),
      this.asc.getAppInfoLocalizations(app.id),
    ]);

    const allLocales = new Set<string>();
    for (const vl of versionLocalizations) allLocales.add(vl.attributes.locale);

    logger.info(`[ASC] Preparing metadata for ${allLocales.size} locale(s): ${[...allLocales].join(", ")}`);

    const localeData = new Map<string, LocaleEntry>();

    for (const locale of allLocales) {
      const vl = versionLocalizations.find((v) => v.attributes.locale === locale);
      const ai = appInfoLocalizations.find((a) => a.attributes.locale === locale);
      const ov = overrides?.[locale];

      localeData.set(locale, {
        name: ov?.name ?? ai?.attributes.name ?? "",
        subtitle: ov?.subtitle ?? ai?.attributes.subtitle ?? "",
        keywords: ov?.keywords ?? vl?.attributes.keywords ?? "",
        description: ov?.description ?? vl?.attributes.description ?? "",
        whatsNew: ov?.whatsNew ?? vl?.attributes.whatsNew ?? "",
        promotionalText: ov?.promotionalText ?? vl?.attributes.promotionalText ?? "",
        supportUrl: vl?.attributes.supportUrl ?? "",
        marketingUrl: vl?.attributes.marketingUrl ?? "",
      });
    }

    if (action === "submit_for_review") {
      const primaryLocale =
        [...localeData.entries()].find(([l]) => l === "en-US")?.[0] ??
        [...localeData.entries()].find(([, v]) => v.whatsNew)?.[0] ??
        [...localeData.keys()][0];

      const primary = primaryLocale ? localeData.get(primaryLocale) : undefined;

      //shit - remove primary locale fallback later
      const fallbackFields = ["whatsNew", "supportUrl", "description"] as const;
      for (const [locale, data] of localeData) {
        for (const field of fallbackFields) {
          if (!data[field] && primary?.[field]) {
            logger.info(`[ASC] locale "${locale}" missing ${field} - using "${primaryLocale}" as fallback`);
            data[field] = primary[field];
          }
        }
      }
    }

    return {
      localeData: Object.fromEntries(localeData) as Record<string, LocaleEntry>,
      versionString: version.attributes.versionString ?? null,
      appId: app.id,
      version,
    };
  }
}
