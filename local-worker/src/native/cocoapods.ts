import fs from "fs";
import path from "path";
import { execAsync, nativeEnv, runNative, type LogFn } from "./command";

const POD_CANDIDATES = [process.env.POD_PATH, "/opt/homebrew/bin/pod", "/usr/local/bin/pod", "pod"].filter(
  Boolean,
) as string[];

const POD_ENV = { COCOAPODS_DISABLE_STATS: "1" };

export function hasPodfile(dir: string): boolean {
  return fs.existsSync(path.join(dir, "Podfile"));
}

export async function findPod(): Promise<string> {
  for (const candidate of POD_CANDIDATES) {
    try {
      await execAsync(`${candidate} --version`, { env: nativeEnv() });

      return candidate;
    } catch {
    }
  }
  throw new Error(
    `CocoaPods 'pod' not found (tried ${POD_CANDIDATES.join(", ")}). Install it or override with POD_PATH env var.`,
  );
}

export async function installPods(workDir: string, log: LogFn): Promise<void> {
  log("[pods] Podfile detected — running pod install ...");
  const pod = await findPod();
  const start = Date.now();

  try {
    await runNative(`${pod} install`, workDir, log, "pod install", { env: POD_ENV });
  } catch {
    log("[pods] pod install failed — retrying with --repo-update ...");
    await runNative(`${pod} install --repo-update`, workDir, log, "pod install", { env: POD_ENV });
  }

  log(`[pods] pod install complete in ${Math.round((Date.now() - start) / 1000)}s`);
}
