import { exec } from "child_process";
import { promisify } from "util";

export const execAsync = promisify(exec);

const NATIVE_PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`;

export function nativeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: NATIVE_PATH,
    LANG: "en_US.UTF-8",
    LANGUAGE: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    ...extra,
  };
}

export type LogFn = (line: string) => void;

export async function runNative(
  cmd: string,
  cwd: string,
  log: LogFn,
  label: string,
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  try {
    await execAsync(cmd, {
      cwd,
      timeout: opts.timeout ?? 900_000,
      env: nativeEnv(opts.env),
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    if (e.stdout)
      e.stdout
        .split("\n")
        .filter(Boolean)
        .forEach((l) => log(l));
    if (e.stderr)
      e.stderr
        .split("\n")
        .filter(Boolean)
        .forEach((l) => log(`[stderr] ${l}`));
    log(`[deps] ${label} FAILED — exit code: ${e.code ?? "unknown"}`);
    throw new Error(`${label} failed (exit ${e.code ?? "unknown"})`);
  }
}
