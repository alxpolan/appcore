import fs from "fs";
import path from "path";
import { runNative, type LogFn } from "./command";

export interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function hasPackageJson(repoDir: string): boolean {
  return fs.existsSync(path.join(repoDir, "package.json"));
}

export function readPackageJson(repoDir: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

export async function installNodeModules(repoDir: string, log: LogFn): Promise<void> {
  log("[deps] package.json detected — installing node modules ...");
  const start = Date.now();
  const hasLock = fs.existsSync(path.join(repoDir, "package-lock.json"));

  try {
    await runNative(hasLock ? "npm ci --include=dev" : "npm install --include=dev", repoDir, log, "npm install");
  } catch (err) {
    if (!hasLock) throw err;
    log("[deps] npm ci failed — retrying with npm install ...");
    await runNative("npm install --include=dev", repoDir, log, "npm install");
  }

  log(`[deps] node modules installed in ${Math.round((Date.now() - start) / 1000)}s`);
}
