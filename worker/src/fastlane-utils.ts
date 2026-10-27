import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const FASTLANE_BIN = process.env.FASTLANE_PATH ?? "/opt/homebrew/bin/fastlane";

export async function findFastlane(): Promise<string> {
  try {
    await execAsync(`${FASTLANE_BIN} --version`);

    return FASTLANE_BIN;
  } catch {
    throw new Error(`Fastlane not found at ${FASTLANE_BIN}. Override with FASTLANE_PATH env var.`);
  }
}
