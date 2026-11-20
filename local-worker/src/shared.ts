import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

export const execAsync = promisify(exec);

export function findConfigFile(dir: string, maxDepth = 4): string | null {
  if (maxDepth <= 0) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "fastlane" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = findConfigFile(full, maxDepth - 1);
      if (found) return found;
    } else if (entry.name === "config.json") return full;
  }

  return null;
}

export function resolveRepoWorkDir(repoDir: string, iosDir: string | undefined, logs: string[]): string {
  const raw = iosDir?.trim();
  if (!raw) return repoDir;

  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return repoDir;

  const workDir = path.resolve(repoDir, normalized);
  const relative = path.relative(repoDir, workDir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid iosDir path: ${iosDir}`);
  }

  if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
    throw new Error(`Configured iosDir not found in repo: ${normalized}`);
  }

  logs.push(`[repo] Using iOS subdirectory: ${normalized}`);

  return workDir;
}
