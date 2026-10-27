export interface SnapshotParams {
  repoUrl: string;
  accessToken: string;
  branch?: string;
  appName: string;
  iosDir?: string;
  framework?: string;
  envVars?: Record<string, string>;
  splitIndex?: number;
  splitCount?: number;
}

interface CaptureSubstitution {
  captureDevice: string;
  exportWidth: number;
  exportHeight: number;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const LOG_INTERESTING_RE =
  /Test (case|suite)|Testing (started|failed|passed|completed)|TEST (BUILD|EXECUTE|SUCCEEDED|FAILED)|encountered an error|error:|warning:|^\*\*|fatal|timed out|Compile|Linking|CodeSign|^Run-|FAIL/i;

export const UDID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
export const XCODEBUILD_TIMEOUT_MS = 12 * 60_000;

export const DEFAULT_LANGUAGES = ["en-US"];

export const DEFAULT_DEVICES = [
  "iPhone 16 Pro Max",
  "iPhone 16",
  "iPhone SE (3rd generation)",
  "iPad Pro (12.9-inch) (4th generation)",
];

const PRO_MAX_RE = /\bPro Max\b/;

const IPAD_SIZE_RE = /\b(11-inch|12\.9-inch|13-inch)\b/;

export function resolveCaptureSubstitution(
  requested: string,
  available: Array<{ name: string }>,
): CaptureSubstitution | null {
  if (PRO_MAX_RE.test(requested)) {
    const sibling = requested.replace(PRO_MAX_RE, "Pro").toLowerCase();
    const found = available.find((d) => d.name.toLowerCase() === sibling);

    return found ? { captureDevice: found.name, exportWidth: 1320, exportHeight: 2868 } : null;
  }

  const sizeMatch = requested.match(IPAD_SIZE_RE);

  if (requested.startsWith("iPad Pro") && sizeMatch && sizeMatch[1] !== "11-inch") {
    const sibling = available.find((d) => /^ipad pro\b/i.test(d.name) && /11-inch/i.test(d.name) && /\(m4\)/i.test(d.name));

    if (!sibling) return null;

    const is13Inch = sizeMatch[1] === "13-inch";

    return {
      captureDevice: sibling.name,
      exportWidth: is13Inch ? 2064 : 2048,
      exportHeight: is13Inch ? 2752 : 2732,
    };
  }

  return null;
}
