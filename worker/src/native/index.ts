import { type LogFn } from "./command";
import { hasPackageJson, installNodeModules } from "./node";
import { isCapacitorProject, syncCapacitor } from "./capacitor";
import { hasPodfile, installPods } from "./cocoapods";

export type Framework = "capacitor" | "native";

export async function prepareNativeDeps(
  repoDir: string,
  workDir: string,
  log: LogFn,
  framework?: string,
): Promise<void> {
  const isCapacitor = framework ? framework === "capacitor" : isCapacitorProject(repoDir);

  log(`[deps] Framework: ${isCapacitor ? "capacitor" : "native"}${framework ? " (configured)" : " (auto-detected)"}`);

  if (isCapacitor) {
    if (hasPackageJson(repoDir)) {
      await installNodeModules(repoDir, log);
    }

    await syncCapacitor(repoDir, log);

    return;
  }

  if (hasPodfile(workDir)) {
    await installPods(workDir, log);
  }
}

export { hasPodfile, installPods } from "./cocoapods";
export { isCapacitorProject } from "./capacitor";
