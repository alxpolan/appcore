export const ipaDownloadTokens = new Map<string, string>();
export const appStoreInfoTokens = new Map<string, string>();

export interface SubmissionPreview {
  appId: string;
  bundleId: string;
  appName: string;
  versionString: string | null;
  appStoreState: string | null;
  isEditable: boolean;
  locales: {
    locale: string;
    name: string;
    subtitle: string;
    keywords: string;
    description: string;
    whatsNew: string;
    promotionalText: string;
  }[];
}

export interface SubmissionResult {
  ok: boolean;
  jobId: string;
  action: SubmitAction;
  versionString: string | null;
  logs: string[];
  errors: string[];
}

export type SubmitAction = "metadata" | "submit_for_review" | "binary" | "screenshots";

export interface LocaleEntry {
  name: string;
  subtitle: string;
  keywords: string;
  description: string;
  whatsNew: string;
  promotionalText: string;
  supportUrl: string;
  marketingUrl: string;
}

export type PhaseState = "pending" | "running" | "done" | "skipped" | "failed";

export interface PhaseProgress {
  state: PhaseState;
  current: number;
  total: number;
}

export interface SubmissionPhases {
  binary: PhaseProgress;
  metadata: PhaseProgress;
  screenshots: PhaseProgress;
}

export interface ActiveSubmission {
  jobId: string;
  logs: string[];
  errors: string[];
  status: "preparing" | "running" | "completed" | "failed";
  startedAt: Date;
  action: SubmitAction;
  phases: SubmissionPhases;
}

export function initialPhases(action: SubmitAction): SubmissionPhases {
  return {
    binary: { state: action === "screenshots" ? "skipped" : "pending", current: 0, total: 1 },
    metadata: { state: action === "binary" || action === "screenshots" ? "skipped" : "pending", current: 0, total: 0 },
    screenshots: { state: action === "binary" ? "skipped" : "pending", current: 0, total: 0 },
  };
}

export const FALLBACK_LOCALES = ["en-US", "en-GB"];
export const SUBMISSION_TTL_MS = 60 * 60 * 1000;
export const activeSubmissions = new Map<string, ActiveSubmission>();
export let latestJobId: string | undefined;

export function setLatestJobId(jobId: string): void {
  latestJobId = jobId;
}

export function getActiveSubmission(jobId: string): ActiveSubmission | undefined {
  return activeSubmissions.get(jobId);
}

export function getLatestSubmission(): ActiveSubmission | undefined {
  return latestJobId ? activeSubmissions.get(latestJobId) : undefined;
}
