import fs from "fs";
import { randomUUID } from "crypto";
import { logger } from "../config";
import { env } from "../config/env";
import { type ASCAppStoreVersion } from "./appstore-connect";
import { workerClient } from "./worker-client";
import { FastlaneUploads } from "./fastlane-uploads";
import {
  activeSubmissions,
  appStoreInfoTokens,
  FALLBACK_LOCALES,
  initialPhases,
  ipaDownloadTokens,
  setLatestJobId,
  SUBMISSION_TTL_MS,
  type ActiveSubmission,
  type LocaleEntry,
  type SubmissionPhases,
  type SubmissionPreview,
  type SubmissionResult,
  type SubmitAction,
} from "./fastlane-types";

export class FastlaneService extends FastlaneUploads {
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
    setLatestJobId(jobId);

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
      } else if (action === "screenshots") {
        submission.status = "running";
        submission.phases.screenshots.state = "running";
        const screenshotsResult = await this.runScreenshotsUpload({
          phases: submission.phases,
          onLog: (line) => submission.logs.push(line),
          onError: (line) => submission.errors.push(line),
        });

        submission.phases.screenshots.state = screenshotsResult.errors.length > 0 ? "failed" : "done";
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
        const fallbackLocale = FALLBACK_LOCALES.find((l) => screenshotPaths[l]) ?? Object.keys(screenshotPaths)[0];
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
      const appStoreInfoPath = ipaPath.replace(/\.ipa$/, ".appstoreinfo.plist");
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

  private async runScreenshotsUpload(opts: {
    phases: SubmissionPhases;
    onLog?: (line: string) => void;
    onError?: (line: string) => void;
  }): Promise<{ logs: string[]; errors: string[] }> {
    const { phases, onLog, onError } = opts;
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
      const screenshotPaths = await this.loadFramedScreenshotPaths();

      if (!screenshotPaths || Object.keys(screenshotPaths).length === 0) {
        throw new Error("No framed screenshots found. Generate screenshots first.");
      }

      const locales = Object.keys(screenshotPaths);
      const total = locales.reduce((sum, loc) => sum + (screenshotPaths[loc]?.length ?? 0), 0);

      phases.screenshots.total = total;
      phases.screenshots.current = 0;

      pushLog(`Uploading screenshots for ${locales.length} locale(s): ${locales.join(", ")}`);
      await this.uploadScreenshotsViaASC(screenshotPaths, locales, pushLog, () => {
        phases.screenshots.current += 1;
      });

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
