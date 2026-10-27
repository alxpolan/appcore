import fs from "fs";
import path from "path";
import os from "os";
import { execAsync } from "../routes/shared";
import { type SnapshotJobResult } from "../log-bus";
import {
  LOG_INTERESTING_RE,
  UDID_RE,
  plural,
  resolveCaptureSubstitution,
  type SnapshotParams,
} from "./SnapshotRunner-types";

export abstract class SnapshotRunnerBase {
  protected readonly runId: string;
  protected readonly params: SnapshotParams;
  protected readonly emitLog: (line: string) => void;
  protected readonly finish: (result: SnapshotJobResult) => void;
  protected readonly tmpDir: string;
  protected readonly logsDir: string;
  protected readonly logFile: string;
  protected readonly artifactsDir: string;
  protected readonly logs: string[] = [];
  protected readonly errors: string[] = [];
  protected skipTesting: string[] = [];
  protected readonly xcresultLogs: Array<{ filename: string; sizeBytes: number }> = [];
  protected readonly deviceNameMap: Map<string, string> = new Map();
  protected readonly exportSizeMap: Map<string, { width: number; height: number }> = new Map();
  private readonly derivedDataPathsClearedOfStaleTestLogs = new Set<string>();

  protected persistentDerivedDataPathFor(device: string): string {
    const cacheRoot = path.join(os.homedir(), "Library", "Caches", "appcore-worker-derived-data");
    const key = `${this.sanitizeTag(this.params.appName)}-${device.replace(/[^a-zA-Z0-9]/g, "_")}`;

    return path.join(cacheRoot, key);
  }

  protected clearStaleTestLogsOnce(derivedDataPath: string): void {
    if (this.derivedDataPathsClearedOfStaleTestLogs.has(derivedDataPath)) return;

    this.derivedDataPathsClearedOfStaleTestLogs.add(derivedDataPath);
    fs.rmSync(path.join(derivedDataPath, "Logs", "Test"), { recursive: true, force: true });
  }

  protected sanitizeTag(text: string, allowDots = false): string {
    const pattern = allowDots ? /[^a-zA-Z0-9._-]/g : /[^a-zA-Z0-9]/g;

    return text.replace(pattern, "_");
  }

  protected getDeviceTag(device: string, allowDots = false): string {
    const truncated = UDID_RE.test(device) ? device.slice(0, 8) : device;

    return this.sanitizeTag(truncated, allowDots);
  }

  protected getDeviceLabel(device: string): string {
    return this.deviceNameMap.get(device) ?? (UDID_RE.test(device) ? device.slice(0, 8) + "..." : device);
  }

  protected getDeviceNameWithSize(device: string): string {
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

  protected abstract execute(): Promise<void>;

  protected loadConfig(
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

      const { bgColor1, bgColor2, textColor, textPosition } = cfg;
      const frameEntries = Object.entries({ bgColor1, bgColor2, textColor }).filter(([, v]) => v != null);

      if (textPosition === "top" || textPosition === "bottom") {
        frameEntries.push(["textPosition", textPosition]);
      }

      if (frameEntries.length > 0) {
        result.frameConfig = Object.fromEntries(frameEntries) as Record<string, string>;
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

  protected async resolveSnapDevices(
    effectiveDevices: string[],
    simInfo: { version: string; devices: Array<{ name: string; udid: string }> } | null,
  ): Promise<string[]> {
    const snapDevices: string[] = [];

    for (const d of effectiveDevices) {
      if (!simInfo) {
        snapDevices.push(d);
        continue;
      }

      const substitution = resolveCaptureSubstitution(d, simInfo.devices);
      const captureDevice = substitution?.captureDevice ?? d;
      const udid = SnapshotRunnerBase.resolveSimulatorUdid(captureDevice, simInfo.devices);

      if (!udid) {
        snapDevices.push(d);
        continue;
      }

      const matched = simInfo.devices.find((s) => s.udid === udid) ?? { name: captureDevice };

      this.deviceNameMap.set(udid, d);

      if (substitution) {
        this.exportSizeMap.set(udid, { width: substitution.exportWidth, height: substitution.exportHeight });
      }

      this.push(
        captureDevice !== d
          ? `[capture] Device "${d}" → captured on "${matched.name}" (${udid}), exported as "${d}"`
          : matched.name !== d
            ? `[capture] Device "${d}" → "${matched.name}" (${udid})`
            : `[capture] Device "${d}" → ${udid}`,
      );
      snapDevices.push(udid);
    }

    return snapDevices;
  }

  protected async bootSimulators(snapDevices: string[], appearance: "light" | "dark"): Promise<void> {
    for (const udid of snapDevices.filter((d) => UDID_RE.test(d))) {
      try {
        await execAsync(`xcrun simctl shutdown "${udid}"`, { timeout: 30_000 }).catch(() => undefined);
        await this.waitForSimulatorShutdown(udid);
        await execAsync(`xcrun simctl erase "${udid}"`, { timeout: 60_000 });
        await execAsync(`xcrun simctl bootstatus "${udid}" -b`, { timeout: 120_000 });
        await execAsync(`xcrun simctl ui "${udid}" appearance ${appearance}`);
        await execAsync(`xcrun simctl shutdown "${udid}"`);
        await this.waitForSimulatorShutdown(udid);
      } catch {
        this.push(`[capture] Warning: could not prepare ${udid}`);
      }
    }
  }

  protected async waitForSimulatorShutdown(udid: string, timeoutMs = 30_000): Promise<void> {
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

  protected async setDeviceLanguage(
    udid: string,
    lang: string,
    localeId: string,
    deviceLabel: string,
  ): Promise<void> {
    try {
      const prefsDir = path.join(
        os.homedir(),
        "Library/Developer/CoreSimulator/Devices",
        udid,
        "data/Library/Preferences",
      );

      fs.mkdirSync(prefsDir, { recursive: true });
      const domain = path.join(prefsDir, ".GlobalPreferences");

      await execAsync(`defaults write "${domain}" AppleLanguages -array "${lang}"`, { timeout: 15_000 });
      await execAsync(`defaults write "${domain}" AppleLocale -string "${localeId}"`, { timeout: 15_000 });
      this.push(`[capture] [${deviceLabel}] device language set to ${lang} (${localeId})`);
    } catch (err) {
      this.push(
        `[capture] [${deviceLabel}] Warning: could not set device language: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  protected push(line: string): void {
    this.logs.push(line);
    this.emitLog(line);
  }

  private writeLogs(): void {
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
      fs.writeFileSync(this.logFile, [...this.logs, ...this.errors].join("\n"), "utf8");
    } catch {
    }
  }

  private copyDebugArtifacts(): void {
    try {
      const debugDir = `/tmp/last-capture-debug-${this.runId}`;

      fs.rmSync(debugDir, { recursive: true, force: true });
      fs.mkdirSync(debugDir, { recursive: true });

      for (const derivedDataPath of this.derivedDataPathsClearedOfStaleTestLogs) {
        const entry = path.basename(derivedDataPath);
        const testLogsDir = path.join(derivedDataPath, "Logs", "Test");

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
    }
  }

  private cleanup(): void {
    try {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {
    }
  }

  protected sweepOldArtifacts(): void {
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
        }
      }
    } catch {
    }
  }

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

    const requestedWords = lower.split(/\s+/).filter((w) => !w.startsWith("("));

    return (
      find((d) => d.name === requested) ??
      find((d) => d.name.toLowerCase() === lower) ??
      (stripped && stripped !== lower ? find((d) => d.name.toLowerCase().startsWith(stripped)) : null) ??
      find((d) => {
        const candidateWords = d.name.toLowerCase().split(/\s+/);

        return candidateWords.length === requestedWords.length && requestedWords.every((w) => candidateWords.includes(w));
      })
    );
  }
}
