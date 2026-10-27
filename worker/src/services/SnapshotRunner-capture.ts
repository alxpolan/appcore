import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execAsync, resolveRepoWorkDir, findConfigFile } from "../routes/shared";
import { prepareNativeDeps } from "../native";
import {
  DEFAULT_DEVICES,
  DEFAULT_LANGUAGES,
  LOG_INTERESTING_RE,
  UDID_RE,
  XCODEBUILD_TIMEOUT_MS,
  plural,
} from "./SnapshotRunner-types";
import { SnapshotRunnerBase } from "./SnapshotRunner-base";

export class SnapshotRunner extends SnapshotRunnerBase {
  protected async execute(): Promise<void> {
    const { repoUrl, accessToken, branch, appName, iosDir, framework, envVars } = this.params;

    fs.mkdirSync(this.tmpDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.sweepOldArtifacts();
    this.push(`[repo] Cloning repo${branch ? ` @${branch}` : ""} ...`);

    if (!/^https:\/\/[^\s"'`$();|&<>]+$/.test(repoUrl)) {
      throw new Error(`Refusing to clone unsafe repoUrl: ${repoUrl}`);
    }

    if (branch && !/^[A-Za-z0-9._\-/]+$/.test(branch)) {
      throw new Error(`Refusing to clone unsafe branch ref: ${branch}`);
    }

    await execAsync(
      `git clone --depth 1 ${branch ? `--branch ${branch}` : ""} "${repoUrl.replace("https://", `https://x-access-token:${accessToken}@`)}" "${this.tmpDir}"`,
      { timeout: 120_000 },
    );

    this.push(`[repo] Clone complete`);

    const workDir = resolveRepoWorkDir(this.tmpDir, iosDir, this.logs);

    await prepareNativeDeps(this.tmpDir, workDir, (line) => this.push(line), framework);

    const configFile = findConfigFile(workDir);
    const { descriptions, frameConfig, effectiveDevices, effectiveLanguages, appearance, scheme, concurrency } =
      configFile
        ? this.loadConfig(configFile, workDir, appName, DEFAULT_DEVICES, DEFAULT_LANGUAGES)
        : (() => {
            this.push(
              `[config] No config.json found - using defaults (scheme: ${appName}, devices: ${DEFAULT_DEVICES.join(", ")})`,
            );

            return {
              descriptions: {},
              frameConfig: {},
              effectiveDevices: DEFAULT_DEVICES,
              effectiveLanguages: DEFAULT_LANGUAGES,
              appearance: "light" as const,
              scheme: appName,
              concurrency: 2,
            };
          })();

    let languages = effectiveLanguages;
    const { splitIndex, splitCount } = this.params;

    if (splitCount && splitCount > 1 && splitIndex !== undefined) {
      const sorted = [...effectiveLanguages].sort();

      languages = sorted.filter((_, i) => i % splitCount === splitIndex);
      this.push(`[split] Part ${splitIndex + 1}/${splitCount}: languages ${languages.join(", ") || "(none)"}`);

      if (languages.length === 0) {
        this.push("[split] Nothing to do for this part - finishing early");
        this.finish({
          ok: true,
          logs: this.logs,
          errors: this.errors,
          screenshots: {},
          descriptions,
          config: frameConfig,
          xcresultLogs: [],
        });

        return;
      }
    }

    this.skipTesting = [`${scheme}Tests`, `${scheme}UITests/${scheme}UITestsLaunchTests`];

    if (configFile) {
      try {
        const cfgSkip = (JSON.parse(fs.readFileSync(configFile, "utf8"))._config ?? {}).skipTesting;

        if (Array.isArray(cfgSkip)) {
          this.skipTesting = cfgSkip.filter((s: unknown): s is string => typeof s === "string");
        }
      } catch {
      }
    }

    if (this.skipTesting.length) this.push(`[capture] Skipping test targets: ${this.skipTesting.join(", ")}`);

    const simInfo = await SnapshotRunnerBase.getIosSimulatorInfo();

    this.push(`[capture] Detected iOS simulator version: ${simInfo?.version ?? "unknown"}`);

    const snapDevices = await this.resolveSnapDevices(effectiveDevices, simInfo);
    const entries = fs.readdirSync(workDir);
    const wsFile = entries.find((f) => f.endsWith(".xcworkspace"));
    const projFile = entries.find((f) => f.endsWith(".xcodeproj"));
    const projectArg = wsFile
      ? `-workspace "${wsFile}"`
      : projFile
        ? `-project "${projFile}"`
        : `-project "${scheme}.xcodeproj"`;

    const effectiveConcurrency = Math.max(1, Math.min(concurrency, snapDevices.length));

    await this.bootSimulators(snapDevices, appearance);

    const screenshots = await this.captureScreenshots(
      languages,
      snapDevices,
      scheme,
      projectArg,
      workDir,
      envVars,
      effectiveConcurrency,
    );

    this.push("[capture] Snapshot completed");
    const totalFiles = Object.values(screenshots).reduce((n, a) => n + a.length, 0);

    this.push(
      `[capture] Total: ${plural(totalFiles, "screenshot")} across ${plural(Object.keys(screenshots).length, "language")}`,
    );

    this.finish({
      ok: true,
      logs: this.logs,
      errors: this.errors,
      screenshots,
      descriptions,
      config: frameConfig,
      xcresultLogs: this.xcresultLogs,
    });
  }

  private async captureScreenshots(
    effectiveLanguages: string[],
    snapDevices: string[],
    scheme: string,
    projectArg: string,
    workDir: string,
    envVars: Record<string, string> | undefined,
    concurrency: number,
  ): Promise<Record<string, Array<{ filename: string; data: string }>>> {
    const screenshots: Record<string, Array<{ filename: string; data: string }>> = {};

    const runDeviceLanguages = async (device: string): Promise<void> => {
      for (const lang of effectiveLanguages) {
        const [langCode, regionCode] = lang.split("-");
        const localeId = regionCode ? `${langCode}_${regionCode}` : langCode;

        const deviceLabel = this.getDeviceLabel(device);
        const destination = UDID_RE.test(device)
          ? `-destination 'id=${device}'`
          : `-destination 'platform=iOS Simulator,name=${device}'`;

        const derivedDataPath = this.persistentDerivedDataPathFor(device);

        this.clearStaleTestLogsOnce(derivedDataPath);
        const testLogsDir = path.join(derivedDataPath, "Logs", "Test");

        const shutdownDevice = async () => {
          if (!UDID_RE.test(device)) return;
          try {
            await execAsync(`xcrun simctl shutdown "${device}"`, { timeout: 30_000 });
            await this.waitForSimulatorShutdown(device);
          } catch {
          }
        };

        if (UDID_RE.test(device)) {
          await this.setDeviceLanguage(device, lang, localeId, deviceLabel);
        }

        this.push(`[capture] [${deviceLabel}] ${lang} - running UI tests ...`);

        let testFailed = await this.runXcodebuild(
          scheme,
          projectArg,
          destination,
          derivedDataPath,
          workDir,
          lang,
          localeId,
          deviceLabel,
          envVars,
        );

        if (testFailed) {
          await shutdownDevice();
          this.push(`[capture] [${deviceLabel}] ${lang} - retrying after failure ...`);
          testFailed = await this.runXcodebuild(
            scheme,
            projectArg,
            destination,
            derivedDataPath,
            workDir,
            lang,
            localeId,
            deviceLabel,
            envVars,
          );
        }

        await shutdownDevice();

        if (fs.existsSync(testLogsDir)) {
          await this.extractScreenshots(testLogsDir, lang, device, screenshots, testFailed, deviceLabel);
        } else {
          this.push(`[capture] [${deviceLabel}] ${lang}: no test logs directory at ${testLogsDir}`);
        }
      }
    };

    const queue = [...snapDevices];
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (queue.length > 0) {
        const device = queue.shift();
        if (device === undefined) return;
        await runDeviceLanguages(device);
      }
    });

    await Promise.all(workers);

    return screenshots;
  }

  private async runXcodebuild(
    scheme: string,
    projectArg: string,
    destination: string,
    derivedDataPath: string,
    workDir: string,
    lang: string,
    localeId: string,
    deviceLabel: string,
    envVars: Record<string, string> | undefined,
  ): Promise<boolean> {
    const testStart = Date.now();

    try {
      const skipArgs = this.skipTesting.map((t) => `-skip-testing:"${t.replace(/[^a-zA-Z0-9 _./\-]/g, "")}"`).join(" ");
      const xcodebuildCmd = `xcodebuild ${projectArg} -scheme "${scheme}" ${destination} -derivedDataPath "${derivedDataPath}" -parallel-testing-enabled NO ${skipArgs} TEST_RUNNER_XCUITESTS_LANGUAGE=${lang} TEST_RUNNER_XCUITESTS_LOCALE=${localeId} build test`;

      const { stdout } = await execAsync(`${xcodebuildCmd} 2>&1`, {
        cwd: workDir,
        timeout: XCODEBUILD_TIMEOUT_MS,
        env: { ...process.env, ...(envVars ?? {}) },
        maxBuffer: 20 * 1024 * 1024,
      });

      const elapsed = Math.round((Date.now() - testStart) / 1000);
      const failed = /FAILED/.test(SnapshotRunnerBase.findTestResultLine(stdout) ?? "");

      this.push(`[capture] [${deviceLabel}] ${lang}: tests ${failed ? "failed" : "passed"} in ${elapsed}s`);

      return false;
    } catch (execErr) {
      const elapsed = Math.round((Date.now() - testStart) / 1000);
      const eOut = execErr as { stdout?: string; stderr?: string };
      const combined = `${eOut.stdout ?? ""}${eOut.stderr ?? ""}`;

      const allPassed = /Test Suite '(All tests|Selected tests)' passed/.test(combined);
      const runnerHung = /hung before establishing connection/.test(combined);
      const realFailures = /Executed \d+ tests?, with [1-9]\d* failures/.test(combined);

      if (allPassed && runnerHung && !realFailures) {
        this.push(`[capture] [${deviceLabel}] ${lang}: tests passed in ${elapsed}s (ignoring post-suite runner hang)`);

        return false;
      }

      this.push(`[capture] [${deviceLabel}] ${lang}: tests failed in ${elapsed}s`);

      const e = execErr as { stdout?: string; stderr?: string };
      const allLines = `${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").filter(Boolean);
      const interesting = allLines.filter((l) => LOG_INTERESTING_RE.test(l));
      for (const l of (interesting.length ? interesting : allLines).slice(-15)) {
        this.push(`[capture]   [${deviceLabel}] ${l.trim()}`);
      }

      return true;
    }
  }

  private async extractScreenshots(
    testLogsDir: string,
    lang: string,
    device: string,
    screenshots: Record<string, Array<{ filename: string; data: string }>>,
    testFailed: boolean,
    deviceLabel: string,
  ): Promise<void> {
    const xcResults = fs.readdirSync(testLogsDir).filter((n) => n.endsWith(".xcresult"));
    const collected: string[] = [];
    const LANG_PREFIX_RE = /^[a-z]{2}(?:[-_][A-Za-z]{2})?__/;

    for (const xcName of xcResults) {
      const xcPath = path.join(testLogsDir, xcName);
      let nameMap: Map<string, string>;

      try {
        nameMap = await this.buildAttachmentNameMap(xcPath);
      } catch (e) {
        this.push(`[capture] Warning: could not parse xcresult JSON for ${xcName}: ${e}`);
        continue;
      }

      const relevant = [...nameMap.entries()].filter(([, name]) => LANG_PREFIX_RE.test(name));

      for (const [payloadId, attName] of relevant) {
        const baseName = path.basename(attName.replace(LANG_PREFIX_RE, ""));
        const deviceNameWithSize = this.getDeviceNameWithSize(device);
        const cleanName = `${baseName}__${deviceNameWithSize}.png`;
        const outPath = path.join(this.tmpDir, `snap-${this.runId}-${cleanName}`);

        try {
          for (const sub of ["export object --legacy", "export object", "export --legacy", "export"]) {
            try {
              await execAsync(
                `xcrun xcresulttool ${sub} --path "${xcPath}" --output-path "${outPath}" --type file --id "${payloadId}"`,
                { timeout: 30_000 },
              );
              if (fs.existsSync(outPath)) break;
            } catch {
            }
          }

          if (fs.existsSync(outPath)) {
            const raw = fs.readFileSync(outPath);
            const exportSize = this.exportSizeMap.get(device);
            const data = exportSize
              ? await sharp(raw)
                  .resize(exportSize.width, exportSize.height, { fit: "cover", position: "top" })
                  .png()
                  .toBuffer()
              : raw;

            (screenshots[lang] ??= []).push({
              filename: cleanName,
              data: data.toString("base64"),
            });
            collected.push(cleanName);
            fs.unlinkSync(outPath);
          } else {
            this.push(`[capture] Warning: export produced no file for "${attName}"`);
          }
        } catch (e) {
          this.push(`[capture] Warning: could not export "${attName}": ${e}`);
        }
      }
    }

    this.push(
      `[capture] [${deviceLabel}] ${lang}: ${plural(collected.length, "screenshot")} captured${testFailed ? " (some tests failed)" : ""}`,
    );

    for (const xcName of xcResults) {
      const xcPath = path.join(testLogsDir, xcName);

      await this.archiveXcresult(xcPath, xcName, device, lang, deviceLabel);
      fs.rmSync(xcPath, { recursive: true, force: true });
    }
  }

  private async archiveXcresult(
    xcPath: string,
    xcName: string,
    device: string,
    lang: string,
    deviceLabel: string,
  ): Promise<void> {
    const tag = this.getDeviceTag(device, true);
    const safeLang = this.sanitizeTag(lang, true);
    const safeXcName = this.sanitizeTag(xcName, true);
    const zipName = `${tag}-${safeLang}-${safeXcName}.zip`;

    fs.mkdirSync(this.artifactsDir, { recursive: true });
    const zipPath = path.join(this.artifactsDir, zipName);

    try {
      await execAsync(`zip -rq "${zipPath}" "${path.basename(xcPath)}"`, {
        cwd: path.dirname(xcPath),
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (fs.existsSync(zipPath)) {
        const sizeBytes = fs.statSync(zipPath).size;

        this.xcresultLogs.push({ filename: zipName, sizeBytes });
        this.push(
          `[capture] [${deviceLabel}] ${lang}: archived xcresult → ${zipName} (${Math.round(sizeBytes / 1024)} KB)`,
        );
      }
    } catch (e) {
      this.push(`[capture] Warning: could not zip xcresult ${xcName}: ${e}`);
    }
  }

  private async buildAttachmentNameMap(xcPath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    const getJson = async (id?: string): Promise<unknown> => {
      const idArg = id ? ` --id "${id}"` : "";
      const opts = { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 };

      for (const sub of ["get object --legacy ", "get object ", "get --legacy ", "get "]) {
        try {
          const { stdout } = await execAsync(`xcrun xcresulttool ${sub}--path "${xcPath}" --format json${idArg}`, opts);

          return JSON.parse(stdout);
        } catch {
        }
      }
      throw new Error("xcresulttool get failed for all flag variants");
    };

    const asObj = (v: unknown): Record<string, unknown> | null =>
      v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    const asArr = (v: unknown): unknown[] | null =>
      Array.isArray(v) ? v : ((asObj(v)?._values as unknown[] | undefined) ?? null);
    const asStr = (v: unknown): string | undefined =>
      typeof v === "string" ? v : (asObj(v)?._value as string | undefined);

    const extractAttachments = (node: unknown): void => {
      const arr = asArr(node);

      if (arr) arr.forEach(extractAttachments);

      const obj = asObj(node);

      if (!obj) return;

      const typeName = asStr(asObj(obj._type)?._name);
      const payloadRef = asObj(obj.payloadRef);

      if ((typeName === "ActionTestAttachment" || payloadRef) && obj.name && payloadRef?.id) {
        const name = asStr(obj.name);
        const payloadId = asStr(payloadRef.id);

        if (name && payloadId && name.length > 0) {
          map.set(payloadId.replace(/\.(png|jpg|jpeg)$/i, ""), name);
        }
      }

      for (const val of Object.values(obj)) {
        if (val && typeof val === "object") extractAttachments(val);
      }
    };

    const collectRefIds = (root: unknown, key: string): string[] => {
      const ids: string[] = [];
      const walk = (n: unknown): void => {
        const arr = asArr(n);

        if (arr) arr.forEach(walk);

        const obj = asObj(n);

        if (!obj) return;

        const id = asStr(asObj(obj[key])?.id);

        if (id) ids.push(id);

        for (const val of Object.values(obj)) {
          if (val && typeof val === "object") walk(val);
        }
      };

      walk(root);

      return [...new Set(ids)];
    };

    const root = await getJson();

    extractAttachments(root);

    for (const refId of collectRefIds(root, "testsRef")) {
      try {
        const sub = await getJson(refId);

        extractAttachments(sub);
        for (const summaryId of collectRefIds(sub, "summaryRef")) {
          try {
            extractAttachments(await getJson(summaryId));
          } catch {
          }
        }
      } catch {
        continue;
      }
    }

    return map;
  }
}
