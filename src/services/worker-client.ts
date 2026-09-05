import axios, { AxiosInstance } from "./utils/http";
import { logger } from "../config";
import { env } from "../config/env";
import type { IncomingMessage } from "http";

export interface WorkerUploadBinaryResult {
  ok: boolean;
  logs: string[];
  errors: string[];
}

export interface WorkerSnapshotParams {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  bundleId: string;
  iosDir?: string;
  framework?: string;
  exportMethod?: string;
  buildBinary?: boolean;
  envVars?: Record<string, string>;
  // Split a single app run across workers; the worker filters its language share.
  splitIndex?: number;
  splitCount?: number;
}

export interface WorkerSnapshotResult {
  ok: boolean;
  logs: string[];
  errors: string[];
  screenshots: Record<string, Array<{ filename: string; data: string }>>;
  descriptions: Record<string, string>;
  config: Record<string, string>;
  xcresultLogs?: Array<{ filename: string; sizeBytes: number; data: string }>;
  ipaBuilt: boolean;
  ipaPath?: string;
}

export interface WorkerBuildParams {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  bundleId: string;
  iosDir?: string;
  framework?: string;
  gymScheme?: string;
  exportMethod?: string;
  signingCertP12?: string;
  signingCertPassword?: string;
  signingProvisioningProfile?: string;
  signingProvisioningProfiles?: string[];
  signingTeamId?: string;
  versionString?: string;
}

export interface WorkerBuildResult {
  ok: boolean;
  logs: string[];
  errors: string[];
  ipaBuilt: boolean;
  ipaBase64?: string;
  originalFilename?: string;
  sizeBytes?: number;
  appStoreInfoBase64?: string;
  buildNumber?: string;
}

export interface WorkerFrameitParams {
  images: Array<{ filename: string; data: string; title?: string }>;
  options: {
    subtitle?: string;
    title?: string;
    bgColor1?: string;
    bgColor2?: string;
    textColor?: string;
    includeUnframed?: boolean;
  };
}

export interface WorkerFrameitResult {
  ok: boolean;
  framedImages: Array<{ filename: string; data: string }>;
  unframedImages?: Array<{ filename: string; data: string }>;
  fontUsed?: string;
  error?: string;
}

export interface WorkerHealthResult {
  ok: boolean;
  fastlaneVersion?: string;
  hostname?: string;
  error?: string;
}

const FRAMEIT_TIMEOUT_MS = 15 * 60 * 1000;
const BUILD_TIMEOUT_MS = 25 * 60 * 1000;

const headersTimeoutFor = (timeoutMs: number) => timeoutMs + 60_000;

interface WorkerSlot {
  baseURL: string;
  client: AxiosInstance;
  busy: boolean;
}

class FastlaneWorkerClient {
  private slots: WorkerSlot[] | null = null;
  private waiters: Array<(slot: WorkerSlot) => void> = [];

  private getSlots(): WorkerSlot[] {
    if (!this.slots) {
      const secret = env.FASTLANE_WORKER_SECRET;
      const urls = (env.FASTLANE_WORKER_URLS ?? env.FASTLANE_WORKER_URL ?? "")
        .split(",")
        .map((u) => u.trim().replace(/\/+$/, ""))
        .filter(Boolean);

      if (urls.length === 0) {
        throw new Error("FASTLANE_WORKER_URL(S) not set. Cannot communicate with Fastlane worker.");
      }
      if (!secret) {
        throw new Error("FASTLANE_WORKER_SECRET not set. Cannot authenticate with Fastlane worker.");
      }

      this.slots = urls.map((baseURL) => ({
        baseURL,
        busy: false,
        client: axios.create({
          baseURL,
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          maxBodyLength: 500 * 1024 * 1024,
          maxContentLength: 500 * 1024 * 1024,
          timeout: 0,
        }),
      }));
    }
    return this.slots;
  }

  private async acquire(): Promise<WorkerSlot> {
    const free = this.getSlots().find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(slot: WorkerSlot): void {
    const next = this.waiters.shift();
    if (next) {
      next(slot);
    } else {
      slot.busy = false;
    }
  }

  /** Workers not currently running a job - callers use this to decide whether splitting pays off. */
  freeSlotCount(): number {
    return this.getSlots().filter((s) => !s.busy).length;
  }

  async health(): Promise<WorkerHealthResult> {
    let lastError: WorkerHealthResult | null = null;
    for (const slot of this.getSlots()) {
      try {
        const res = await slot.client.get("/worker/health", { timeout: 15_000 });
        if (res.data?.ok) return res.data;
        lastError = res.data;
      } catch (err) {
        lastError = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return lastError ?? { ok: false, error: "no workers configured" };
  }

  async snapshot(params: WorkerSnapshotParams, onLog?: (line: string) => void): Promise<WorkerSnapshotResult> {
    const slot = await this.acquire();
    try {
      return await this.snapshotOnSlot(slot, params, onLog);
    } finally {
      this.release(slot);
    }
  }

  private async snapshotOnSlot(
    slot: WorkerSlot,
    params: WorkerSnapshotParams,
    onLog?: (line: string) => void,
  ): Promise<WorkerSnapshotResult> {
    logger.info(`[WorkerClient] Sending snapshot task to worker ${slot.baseURL} (async+stream)...`);

    const startRes = await slot.client.post<{ ok: boolean; runId: string }>("/worker/snapshot", params, {
      timeout: 30_000,
    });
    const { runId } = startRes.data;
    logger.info(`[WorkerClient] Snapshot job started: runId=${runId} on ${slot.baseURL}`);

    return new Promise((resolve, reject) => {
      const baseURL = slot.baseURL;
      const secret = env.FASTLANE_WORKER_SECRET!;
      const url = `${baseURL}/worker/snapshot/${runId}/stream`;

      axios
        .get<IncomingMessage>(url, {
          headers: { Authorization: `Bearer ${secret}` },
          responseType: "stream",
          timeout: 40 * 60 * 1000,
        })
        .then(({ data: stream }) => {
          let buf = "";

          stream.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";

            for (const block of parts) {
              let event = "message";
              let data = "";
              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7).trim();
                else if (line.startsWith("data: ")) data = line.slice(6);
              }
              if (!data) continue;

              if (event === "log") {
                const line = JSON.parse(data) as string;
                onLog?.(line);
              } else if (event === "result") {
                const result = JSON.parse(data) as WorkerSnapshotResult;
                stream.destroy();
                this.fetchXcresultLogs(slot, runId, result, onLog)
                  .then(() => resolve(result))
                  .catch((err: Error) => {
                    onLog?.(`[snapshot] Warning: could not download xcresult logs: ${err.message ?? err}`);
                    resolve(result);
                  });
              }
            }
          });

          stream.on("end", () => {
            reject(new Error("Worker SSE stream ended without a result event"));
          });

          stream.on("error", (err: Error) => {
            reject(new Error(`Worker SSE stream error: ${err.message}`));
          });
        })
        .catch(reject);
    });
  }

  private async fetchXcresultLogs(
    slot: WorkerSlot,
    runId: string,
    result: WorkerSnapshotResult,
    onLog?: (line: string) => void,
  ): Promise<void> {
    if (!result.xcresultLogs || result.xcresultLogs.length === 0) return;

    const baseURL = slot.baseURL;
    const secret = env.FASTLANE_WORKER_SECRET!;

    for (const meta of result.xcresultLogs) {
      try {
        const url = `${baseURL}/worker/snapshot/${encodeURIComponent(runId)}/xcresult/${encodeURIComponent(meta.filename)}`;
        const res = await axios.get<ArrayBuffer>(url, {
          headers: { Authorization: `Bearer ${secret}` },
          responseType: "arraybuffer",
          timeout: 10 * 60 * 1000,
          maxContentLength: 500 * 1024 * 1024,
          maxBodyLength: 500 * 1024 * 1024,
        });
        meta.data = Buffer.from(res.data).toString("base64");
        onLog?.(`[snapshot] Downloaded xcresult ${meta.filename} (${Math.round(meta.sizeBytes / 1024)} KB)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onLog?.(`[snapshot] Warning: failed to download ${meta.filename}: ${msg}`);
      }
    }
  }

  async frameit(params: WorkerFrameitParams): Promise<WorkerFrameitResult> {
    const slot = await this.acquire();
    try {
      logger.info(`[WorkerClient] Sending frameit task to worker ${slot.baseURL}...`);
      const res = await slot.client.post("/worker/frameit", params, {
        timeout: FRAMEIT_TIMEOUT_MS,
        headersTimeout: headersTimeoutFor(FRAMEIT_TIMEOUT_MS),
        validateStatus: () => true,
      });
      return res.data;
    } finally {
      this.release(slot);
    }
  }

  async build(params: WorkerBuildParams): Promise<WorkerBuildResult> {
    const slot = await this.acquire();
    try {
      logger.info(`[WorkerClient] Sending build task to worker ${slot.baseURL}...`);
      const res = await slot.client.post("/worker/build", params, {
        timeout: BUILD_TIMEOUT_MS,
        headersTimeout: headersTimeoutFor(BUILD_TIMEOUT_MS),
      });
      return res.data;
    } finally {
      this.release(slot);
    }
  }

  async uploadBinary(
    params: { ipaUrl: string; keyId: string; issuerId: string; privateKey: string; appStoreInfoUrl?: string },
    onLog?: (line: string) => void,
  ): Promise<WorkerUploadBinaryResult> {
    logger.info("[WorkerClient] Starting binary upload on worker via iTMSTransporter...");

    const baseURL = env.TRANSPORTER_WORKER_URL ?? env.FASTLANE_WORKER_URL;
    const secret = env.FASTLANE_WORKER_SECRET!;

    if (!baseURL) throw new Error("No worker URL configured for upload-binary.");

    const uploadClient = axios.create({
      baseURL,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      timeout: 60_000,
    });

    const startRes = await uploadClient.post<{ ok: boolean; runId: string }>(
      "/worker/upload-binary",
      params as object,
      {
        timeout: 60_000,
      },
    );

    const { runId } = startRes.data;
    logger.info(`[WorkerClient] Binary upload job started: runId=${runId}`);

    return new Promise((resolve, reject) => {
      axios
        .get<IncomingMessage>(`${baseURL}/worker/upload-binary/${runId}/stream`, {
          headers: { Authorization: `Bearer ${secret}` },
          responseType: "stream",
          timeout: 30 * 60 * 1000,
        })
        .then(({ data: stream }) => {
          let buf = "";
          stream.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            const parts = buf.split("\n\n");
            buf = parts.pop() ?? "";

            for (const block of parts) {
              let event = "message";
              let data = "";

              for (const line of block.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7).trim();
                else if (line.startsWith("data: ")) data = line.slice(6);
              }

              if (!data) continue;
              if (event === "log") {
                onLog?.(JSON.parse(data) as string);
              } else if (event === "result") {
                stream.destroy();
                resolve(JSON.parse(data) as WorkerUploadBinaryResult);
              }
            }
          });
          stream.on("end", () => reject(new Error("Worker SSE stream ended without a result event")));
          stream.on("error", (err: Error) => reject(new Error(`Worker SSE stream error: ${err.message}`)));
        })
        .catch(reject);
    });
  }
}

export const workerClient = new FastlaneWorkerClient();
