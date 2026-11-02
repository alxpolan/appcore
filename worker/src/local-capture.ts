import fs from "fs";
import os from "os";
import path from "path";
import { execAsync } from "./routes/shared";
import { SnapshotRunner, type SnapshotParams } from "./services/SnapshotRunner";
import type { SnapshotJobResult } from "./log-bus";

const RESULT_CACHE_PATH = path.join(process.cwd(), ".marteso-capture-result.json");

const apiUrl = (process.env.MARTESO_API_URL ?? "").replace(/\/+$/, "");
const apiToken = process.env.MARTESO_API_TOKEN;
const bundleId = process.env.BUNDLE_ID;

if (!apiUrl || !apiToken || !bundleId) {
  console.error("Usage: MARTESO_API_URL=... MARTESO_API_TOKEN=... BUNDLE_ID=... npm run capture:local");
  process.exit(1);
}

interface AppCaptureConfig {
  appName: string;
  iosDir?: string;
  framework?: string;
}

async function fetchAppConfig(): Promise<AppCaptureConfig> {
  const res = await fetch(`${apiUrl}/api/screenshots/local-capture/config?bundleId=${encodeURIComponent(bundleId!)}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch app config: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as AppCaptureConfig;
}

async function gitInfo(): Promise<{ commitSha: string; branch?: string }> {
  try {
    const { stdout: sha } = await execAsync("git rev-parse HEAD");
    const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD");

    return { commitSha: sha.trim(), branch: branch.trim() };
  } catch {
    return { commitSha: `local-${Date.now()}` };
  }
}

async function postChunk(body: Record<string, unknown>): Promise<{ ok: boolean; jobId: string }> {
  const res = await fetch(`${apiUrl}/api/screenshots/local-capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: any;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Delivery failed: ${res.status} ${text.slice(0, 300)}`);
  }

  if (!res.ok || !parsed.ok) {
    throw new Error(`Delivery failed: ${res.status} ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function deliver(result: SnapshotJobResult, branch: string | undefined, commitSha: string): Promise<void> {
  const locales = Object.entries(result.screenshots);
  let jobId: string | undefined;

  for (let i = 0; i < locales.length; i++) {
    const [locale, images] = locales[i];
    const isFirst = i === 0;
    const isLast = i === locales.length - 1;

    console.log(`[deliver] ${locale}: ${images.length} screenshot(s) (${i + 1}/${locales.length})`);

    const body = await postChunk({
      bundleId,
      ...(isFirst ? { commitSha, branch } : {}),
      ...(jobId ? { jobId } : {}),
      screenshots: { [locale]: images },
      ...(isLast ? { descriptions: result.descriptions, config: result.config, final: true } : {}),
    });

    jobId = body.jobId;
  }

  console.log(`\nDelivered. jobId=${jobId}`);
  console.log(`Open: ${apiUrl}/screenshots/studio/${jobId}`);
}

interface ResultCache {
  result: SnapshotJobResult;
  branch: string | undefined;
  commitSha: string;
}

async function runCapture(): Promise<ResultCache> {
  const appConfig = await fetchAppConfig();
  const { commitSha, branch } = await gitInfo();
  const runId = String(Date.now());

  const maxConcurrency = Number(process.env.MAX_CONCURRENCY) || Math.max(4, Math.min(8, os.cpus().length - 2));

  console.log(`[local-capture] Using maxConcurrency=${maxConcurrency} (${os.cpus().length} cores detected)`);

  const params: SnapshotParams = {
    localRepoDir: process.cwd(),
    branch,
    appName: appConfig.appName,
    iosDir: appConfig.iosDir,
    framework: appConfig.framework,
    maxConcurrency,
  };

  const result = await new Promise<SnapshotJobResult>((resolve, reject) => {
    const runner = new SnapshotRunner(
      runId,
      params,
      (line) => console.log(line),
      (finished) => resolve(finished),
    );

    runner.run().catch(reject);
  });

  if (!result.ok) {
    throw new Error(`Capture failed: ${result.errors.join("; ")}`);
  }

  return { result, branch, commitSha };
}

async function main(): Promise<void> {
  let cache: ResultCache;

  if (process.env.REDELIVER_ONLY) {
    if (!fs.existsSync(RESULT_CACHE_PATH)) {
      throw new Error(`REDELIVER_ONLY set but no cached result found at ${RESULT_CACHE_PATH}`);
    }

    console.log(`[local-capture] Re-delivering cached result from ${RESULT_CACHE_PATH} (skipping capture)`);
    cache = JSON.parse(fs.readFileSync(RESULT_CACHE_PATH, "utf8")) as ResultCache;
  } else {
    cache = await runCapture();
    fs.writeFileSync(RESULT_CACHE_PATH, JSON.stringify(cache));
    console.log(`[local-capture] Saved capture result to ${RESULT_CACHE_PATH} (safe to retry delivery with REDELIVER_ONLY=1 if this fails)`);
  }

  await deliver(cache.result, cache.branch, cache.commitSha);
  fs.rmSync(RESULT_CACHE_PATH, { force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
