import fs from "fs";
import path from "path";
import os from "os";
import { execAsync, resolveRepoWorkDir, findConfigFile } from "../routes/shared";
import { prepareNativeDeps } from "../native";
import { type SnapshotJobResult } from "../log-bus";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const LOG_INTERESTING_RE =
  /Test (case|suite)|Testing (started|failed|passed|completed)|TEST (BUILD|EXECUTE|SUCCEEDED|FAILED)|encountered an error|error:|warning:|^\*\*|fatal|timed out|Compile|Linking|CodeSign|^Run-|FAIL/i;

const UDID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const XCODEBUILD_TIMEOUT_MS = 12 * 60_000;

const DEFAULT_LANGUAGES = ["en-US"];
const DEFAULT_DEVICES = [
  "iPhone 16 Pro Max",
  "iPhone 16",
  "iPhone SE (3rd generation)",
  "iPad Pro (12.9-inch) (4th generation)",
];

export interface SnapshotParams {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  iosDir?: string;
  framework?: string;
  envVars?: Record<string, string>;
  // Split a run across workers: this part handles every language whose index
  // (in the sorted effective list) is ≡ splitIndex mod splitCount.
  splitIndex?: number;
  splitCount?: number;
}

export class SnapshotRunner {
  private readonly runId: string;
  private readonly params: SnapshotParams;
  private readonly emitLog: (line: string) => void;
  private readonly finish: (result: SnapshotJobResult) => void;
  private readonly tmpDir: string;
  private readonly logsDir: string;
  private readonly logFile: string;
  private readonly artifactsDir: string;
  private readonly logs: string[] = [];
  private readonly errors: string[] = [];
  private readonly xcresultLogs: Array<{ filename: string; sizeBytes: number }> = [];
  private readonly deviceNameMap: Map<string, string> = new Map();

  private sanitizeTag(text: string, allowDots = false): string {
    const pattern = allowDots ? /[^a-zA-Z0-9._-]/g : /[^a-zA-Z0-9]/g;
    return text.replace(pattern, "_");
  }

  private getDeviceTag(device: string, allowDots = false): string {
    const truncated = UDID_RE.test(device) ? device.slice(0, 8) : device;
    return this.sanitizeTag(truncated, allowDots);
  }

  private getDeviceLabel(device: string): string {
    return this.deviceNameMap.get(device) ?? (UDID_RE.test(device) ? device.slice(0, 8) + "..." : device);
  }

  private getDeviceNameWithSize(device: string): string {
    const deviceName = this.deviceNameMap.get(device) ?? device;

    const screenSizes: Record<string, string> = {
      "iPhone 16 Pro Max": "6.9",
      "iPhone 16 Pro": "6.3",
      "iPhone 16": "6.3",
      "iPhone 16 Plus": "6.7",
      "iPhone 15 Pro Max": "6.7",
      "iPhone 15 Pro": "6.1",
      "iPhone 15": "6.1",
      "iPhone 15 Plus": "6.7",
      "iPhone 14 Pro Max": "6.7",
      "iPhone 14 Pro": "6.1",
      "iPhone 14": "6.1",
      "iPhone 14 Plus": "6.7",
      "iPhone 13 Pro Max": "6.7",
      "iPhone 13 Pro": "6.1",
      "iPhone 13": "6.1",
      "iPhone 13 mini": "5.4",
      "iPhone 12 Pro Max": "6.7",
      "iPhone 12 Pro": "6.1",
      "iPhone 12": "6.1",
      "iPhone 12 mini": "5.4",
      "iPhone 11 Pro Max": "6.5",
      "iPhone 11 Pro": "5.8",
      "iPhone 11": "6.1",
      "iPhone SE": "4.7",
    };

    let deviceType = "";
    let screenSize = "";

    if (deviceName.includes("iPad")) {
      deviceType = "ipad";
      const sizeMatch = deviceName.match(/\((\d+(?:\.\d+)?)-inch\)/);

      if (sizeMatch) {
        screenSize = sizeMatch[1];
      }
    } else if (deviceName.includes("iPhone")) {
      deviceType = "iphone";

      for (const [name, size] of Object.entries(screenSizes)) {
        if (deviceName.includes(name)) {
          screenSize = size;
          break;
        }
      }
    }

    if (!screenSize) {
      screenSize = "unknown";
    }

    return `${deviceType}_${screenSize}`.toLowerCase();
  }

  constructor(
    runId: string,
    params: SnapshotParams,
    emitLog: (line: string) => void,
    finish: (result: SnapshotJobResult) => void,
  ) {
    this.runId = runId;
    this.params = params;
    this.emitLog = emitLog;
    this.finish = finish;
    this.tmpDir = path.join(os.tmpdir(), `worker-capture-${runId}`);
    this.logsDir = path.join(process.cwd(), "logs", "captures");
    this.logFile = path.join(this.logsDir, `capture-${runId}.log`);
    this.artifactsDir = path.join(this.logsDir, runId);
  }

  async run(): Promise<void> {
    try {
      await this.execute();
    } finally {
      this.writeLogs();
      this.copyDebugArtifacts();
      this.cleanup();
    }
  }

  // ---------------------------------------------------------------------------
  // Core execution
  // ---------------------------------------------------------------------------

  private async execute(): Promise<void> {
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

    const simInfo = await SnapshotRunner.getIosSimulatorInfo();
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

    //this.push(
    //`[capture] Running xcodebuild for ${plural(snapDevices.length, "device")} (concurrency: ${effectiveConcurrency}):\n           - ${snapDevices.join("\n           - ")}`,
    //);

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

  // ---------------------------------------------------------------------------
  // Config loading
  // ---------------------------------------------------------------------------

  private loadConfig(
    configFile: string,
    workDir: string,
    defaultScheme: string,
    defaultDevices: string[],
    defaultLanguages: string[],
  ): {
    descriptions: Record<string, string>;
    frameConfig: Record<string, string>;
    effectiveDevices: string[];
    effectiveLanguages: string[];
    appearance: "light" | "dark";
    scheme: string;
    concurrency: number;
  } {
    const result = {
      descriptions: {} as Record<string, string>,
      frameConfig: {} as Record<string, string>,
      effectiveDevices: defaultDevices,
      effectiveLanguages: defaultLanguages,
      appearance: "light" as const,
      scheme: defaultScheme,
      concurrency: 2,
    };

    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
      const cfg = parsed._config ?? {};

      if (cfg.scheme) {
        const sanitized = cfg.scheme.replace(/[^a-zA-Z0-9 _.\-]/g, "");
        if (sanitized !== cfg.scheme) {
          this.push(`[config] Warning: scheme name sanitized from "${cfg.scheme}" to "${sanitized}"`);
        }
        result.scheme = sanitized;
      }

      if (Array.isArray(cfg.devices) && cfg.devices.length) result.effectiveDevices = cfg.devices;
      if (Array.isArray(cfg.languages) && cfg.languages.length) result.effectiveLanguages = cfg.languages;
      if (cfg.appearance === "dark" || cfg.appearance === "light") result.appearance = cfg.appearance;
      if (Number.isFinite(cfg.concurrency) && cfg.concurrency >= 1) {
        result.concurrency = Math.floor(cfg.concurrency);
      }

      const { bgColor1, bgColor2, textColor } = cfg;
      if (bgColor1 || bgColor2 || textColor) {
        result.frameConfig = Object.fromEntries(
          Object.entries({ bgColor1, bgColor2, textColor }).filter(([, v]) => v != null),
        ) as Record<string, string>;
      }

      const { _config: _, ...rest } = parsed;
      result.descriptions = rest;
      const descCount = Object.keys(result.descriptions).length;

      this.push(
        [
          `[config] Loaded config.json from ${path.relative(workDir, configFile)}`,
          `         - scheme: ${result.scheme}`,
          `         - devices: ${result.effectiveDevices.join(", ")}`,
          `         - languages: ${result.effectiveLanguages.join(", ")}`,
          `         - appearance: ${result.appearance}`,
          `         - concurrency: ${result.concurrency}`,
          `         - ${plural(descCount, "description")}`,
        ].join("\n"),
      );
    } catch {
      this.push(`[config] Warning: could not parse ${path.relative(workDir, configFile)}`);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Simulator helpers
  // ---------------------------------------------------------------------------

  private async resolveSnapDevices(
    effectiveDevices: string[],
    simInfo: { version: string; devices: Array<{ name: string; udid: string }> } | null,
  ): Promise<string[]> {
    const snapDevices: string[] = [];

    for (const d of effectiveDevices) {
      if (!simInfo) {
        snapDevices.push(d);
        continue;
      }

      const udid = SnapshotRunner.resolveSimulatorUdid(d, simInfo.devices);
      if (!udid) {
        snapDevices.push(d);
        continue;
      }

      const matched = simInfo.devices.find((s) => s.udid === udid) ?? { name: d };
      this.deviceNameMap.set(udid, matched.name);
      this.push(
        matched.name !== d
          ? `[capture] Device "${d}" → "${matched.name}" (${udid})`
          : `[capture] Device "${d}" → ${udid}`,
      );
      snapDevices.push(udid);
    }

    return snapDevices;
  }

  private async bootSimulators(snapDevices: string[], appearance: "light" | "dark"): Promise<void> {
    for (const udid of snapDevices.filter((d) => UDID_RE.test(d))) {
      try {
        await execAsync(`xcrun simctl bootstatus "${udid}" -b`, { timeout: 120_000 });
        await execAsync(`xcrun simctl ui "${udid}" appearance ${appearance}`);
        await execAsync(`xcrun simctl shutdown "${udid}"`);
        await this.waitForSimulatorShutdown(udid);
      } catch {
        this.push(`[capture] Warning: could not set appearance on ${udid}`);
      }
    }
  }

  private async waitForSimulatorShutdown(udid: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { stdout } = await execAsync("xcrun simctl list devices --json", { timeout: 10_000 });
        const data = JSON.parse(stdout) as Record<string, unknown>;
        const devices = Object.values(data.devices as Record<string, unknown[]>).flat() as Array<{
          udid: string;
          state: string;
        }>;
        const device = devices.find((d) => d.udid === udid);
        if (!device || device.state === "Shutdown") return;
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  // ---------------------------------------------------------------------------
  // Screenshot capture
  // ---------------------------------------------------------------------------

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

        const derivedDataPath = path.join(this.tmpDir, `DerivedData-${device.replace(/[^a-zA-Z0-9]/g, "_")}`);
        const testLogsDir = path.join(derivedDataPath, "Logs", "Test");

        const shutdownDevice = async () => {
          if (!UDID_RE.test(device)) return;
          try {
            await execAsync(`xcrun simctl shutdown "${device}"`, { timeout: 30_000 });
            await this.waitForSimulatorShutdown(device);
          } catch {
            // ignore
          }
        };

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
      const xcodebuildCmd = `xcodebuild ${projectArg} -scheme "${scheme}" ${destination} -derivedDataPath "${derivedDataPath}" -parallel-testing-enabled NO TEST_RUNNER_XCUITESTS_LANGUAGE=${lang} TEST_RUNNER_XCUITESTS_LOCALE=${localeId} build test`;

      const { stdout } = await execAsync(`${xcodebuildCmd} 2>&1`, {
        cwd: workDir,
        timeout: XCODEBUILD_TIMEOUT_MS,
        env: { ...process.env, ...(envVars ?? {}) },
        maxBuffer: 20 * 1024 * 1024,
      });

      const elapsed = Math.round((Date.now() - testStart) / 1000);
      const failed = /FAILED/.test(SnapshotRunner.findTestResultLine(stdout) ?? "");
      this.push(`[capture] [${deviceLabel}] ${lang}: tests ${failed ? "failed" : "passed"} in ${elapsed}s`);
      return false;
    } catch (execErr) {
      const elapsed = Math.round((Date.now() - testStart) / 1000);
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
          await execAsync(
            `xcrun xcresulttool export --legacy --path "${xcPath}" --output-path "${outPath}" --type file --id "${payloadId}"`,
            { timeout: 30_000 },
          );
          if (fs.existsSync(outPath)) {
            (screenshots[lang] ??= []).push({
              filename: cleanName,
              data: fs.readFileSync(outPath).toString("base64"),
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
      for (const flags of ["--legacy ", ""]) {
        try {
          const { stdout } = await execAsync(
            `xcrun xcresulttool get ${flags}--path "${xcPath}" --format json${idArg}`,
            opts,
          );
          return JSON.parse(stdout);
        } catch {
          // try next variant
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
            /* ignore */
          }
        }
      } catch {
        continue;
      }
    }

    return map;
  }

  // ---------------------------------------------------------------------------
  // Cleanup & logging
  // ---------------------------------------------------------------------------

  private push(line: string): void {
    this.logs.push(line);
    this.emitLog(line);
  }

  private writeLogs(): void {
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
      fs.writeFileSync(this.logFile, [...this.logs, ...this.errors].join("\n"), "utf8");
    } catch {
      /* ignore */
    }
  }

  private copyDebugArtifacts(): void {
    try {
      const debugDir = `/tmp/last-capture-debug-${this.runId}`;
      fs.rmSync(debugDir, { recursive: true, force: true });
      fs.mkdirSync(debugDir, { recursive: true });

      for (const entry of fs.readdirSync(this.tmpDir).filter((e) => e.startsWith("DerivedData-"))) {
        const testLogsDir = path.join(this.tmpDir, entry, "Logs", "Test");
        if (fs.existsSync(testLogsDir)) {
          for (const xcEntry of fs.readdirSync(testLogsDir)) {
            if (xcEntry.endsWith(".xcresult")) {
              fs.cpSync(path.join(testLogsDir, xcEntry), path.join(debugDir, `${entry}-${xcEntry}`), {
                recursive: true,
              });
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private cleanup(): void {
    try {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  private sweepOldArtifacts(): void {
    const ttlMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      for (const entry of fs.readdirSync(this.logsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.logsDir, entry.name);
        try {
          if (now - fs.statSync(dir).mtimeMs > ttlMs) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch {
          /* ignore individual failures */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  static findTestResultLine(output: string | undefined): string | null {
    if (!output) return null;
    const match = output.split("\n").find((l) => /\*\* TEST (FAILED|SUCCEEDED) \*\*/.test(l));
    return match?.trim() ?? null;
  }

  static filterXcodebuildOutput(output: string | undefined, maxLines = 200): string[] {
    if (!output) return [];
    const lines = output.split("\n").filter(Boolean);
    const interesting = lines.filter((l) => LOG_INTERESTING_RE.test(l));

    if (interesting.length <= maxLines) return interesting;
    const dropped = interesting.length - maxLines;
    return [`[capture] (truncated ${plural(dropped, "line")} earlier filtered)`, ...interesting.slice(-maxLines)];
  }

  static async getIosSimulatorInfo(): Promise<{
    version: string;
    devices: Array<{ name: string; udid: string }>;
  } | null> {
    type Runtime = { identifier: string; platform: string; version: string; isAvailable: boolean };
    type Device = { name: string; udid: string; isAvailable: boolean };
    type SimctlList = { runtimes: Runtime[]; devices: Record<string, Device[]> };

    try {
      const { stdout } = await execAsync("xcrun simctl list --json");
      const data = JSON.parse(stdout) as SimctlList;
      const runtime = data.runtimes
        .filter((r) => r.platform === "iOS" && r.isAvailable)
        .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];

      if (!runtime) return null;

      const devices = (data.devices[runtime.identifier] ?? [])
        .filter((d) => d.isAvailable)
        .map((d) => ({ name: d.name, udid: d.udid }));
      return { version: runtime.version, devices };
    } catch {
      return null;
    }
  }

  static resolveSimulatorUdid(requested: string, available: Array<{ name: string; udid: string }>): string | null {
    const lower = requested.toLowerCase();
    const find = (pred: (d: { name: string }) => boolean) => available.find(pred)?.udid ?? null;

    const stripped = requested
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toLowerCase();

    return (
      find((d) => d.name === requested) ??
      find((d) => d.name.toLowerCase() === lower) ??
      (stripped && stripped !== lower ? find((d) => d.name.toLowerCase().startsWith(stripped)) : null) ??
      find((d) =>
        lower
          .split(/\s+/)
          .filter((w) => !w.startsWith("("))
          .every((w) => d.name.toLowerCase().includes(w)),
      )
    );
  }
}
