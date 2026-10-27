import fs from "fs";
import path from "path";
import { runNative, type LogFn } from "./command";
import { readPackageJson } from "./node";

const CONFIG_FILES = ["capacitor.config.ts", "capacitor.config.js", "capacitor.config.json"];

export function isCapacitorProject(repoDir: string): boolean {
  const pkg = readPackageJson(repoDir);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps["@capacitor/core"] || deps["@capacitor/ios"]) return true;

  return CONFIG_FILES.some((f) => fs.existsSync(path.join(repoDir, f)));
}

export async function syncCapacitor(repoDir: string, log: LogFn): Promise<void> {
  const pkg = readPackageJson(repoDir);

  if (pkg?.scripts?.build) {
    log("[capacitor] Building web assets (npm run build) ...");
    await runNative("npm run build", repoDir, log, "npm run build");
  } else {
    log("[capacitor] No build script found — using committed web assets");
  }

  log("[capacitor] Running npx cap sync ios ...");
  await runNative("npx cap sync ios", repoDir, log, "cap sync");
  log("[capacitor] Sync complete (pods installed)");
}
