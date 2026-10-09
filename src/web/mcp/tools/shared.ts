import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma, getEffectiveSettings } from "../../../config";
import { logActivity } from "../../../services/activity-log";

type EffectiveSettings = Awaited<ReturnType<typeof getEffectiveSettings>>;

export const mcpToolMessages = {
  noBundleIdConfigured: "No bundleId configured.",
  noBundleIdProvided: "No bundleId provided. Call list_apps to see available apps.",
  noBundleIdProvidedWithDefault:
    "No bundleId provided and no default configured. Call list_apps to see available apps.",
  appStoreConnectCredentialsNotConfigured: "App Store Connect credentials not configured.",
  appStoreConnectCredentialsNotConfiguredInSettings:
    "App Store Connect credentials not configured. Set them in Marteso settings.",
  noEditableVersionFound: "No editable version found. Use list_asc_versions to see available versions.",
};

export function appNotFoundWithListApps(bundleId: string) {
  return `App not found: ${bundleId}. Call list_apps to see valid bundle IDs.`;
}

export function appNotFound(bundleId: string) {
  return `App not found: ${bundleId}`;
}

export function couldNotResolveAscAppId(bundleId?: string) {
  return `Could not resolve ASC App ID for bundle ID: ${bundleId || "(none)"}`;
}

export async function getMcpUserTeamId(userId: string): Promise<string | null> {
  const membership = await prisma.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { teamId: true },
  });
  return membership?.teamId ?? null;
}

export async function getMcpAllowedAppIds(userId: string, teamId: string): Promise<string[] | null> {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { appAccess: { select: { appId: true } } },
  });

  if (!member) return [];
  if (member.role === "OWNER" || member.role === "ADMIN") return null;
  if (member.appAccess.length === 0) return null;
  return member.appAccess.map((a) => a.appId);
}

export async function verifyMcpAppAccess(userId: string, bundleId: string) {
  const app = await prisma.app.findUnique({ where: { bundleId } });
  if (!app) return null;
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return null;
  if (!app.teamId || app.teamId !== teamId) return null;
  const allowed = await getMcpAllowedAppIds(userId, teamId);
  if (allowed && !allowed.includes(app.id)) return null;
  return app;
}

export async function getSettingsWithBundleId(userId: string, bundleId?: string) {
  const settings = await getEffectiveSettings(userId);
  const resolvedBundleId = bundleId;
  return { settings, resolvedBundleId };
}

export { hasAscCredentials } from "../../../services/asc-client";

export async function createAscClient(settings: EffectiveSettings) {
  const { ascClientFromSettings } = await import("../../../services/asc-client");
  const asc = ascClientFromSettings(settings);
  
  if (!asc) throw new Error("App Store Connect credentials missing.");
  return asc;
}

export async function resolveAscAppId(
  asc: { getApp: (bundleId: string) => Promise<any> },
  settings: EffectiveSettings,
  resolvedBundleId?: string,
) {
  const appRecord = resolvedBundleId
    ? await prisma.app.findUnique({
        where: { bundleId: resolvedBundleId },
        select: { trackId: true },
      })
    : null;

  let ascAppId = appRecord?.trackId?.toString() || "";
  if (!ascAppId && resolvedBundleId) {
    const ascApp = await asc.getApp(resolvedBundleId);
    ascAppId = ascApp?.id ?? "";
  }

  return ascAppId;
}

export function formatAscError(err: any): string {
  const errors = err?.response?.data?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e: any) => e.detail || e.title || JSON.stringify(e)).join("; ");
  }
  return err?.message ?? String(err);
}

export interface ToolSummary {
  summary?: string;
  entityType?: string;
  entityId?: string;
  details?: unknown;
}

export type ToolSummarize = (args: any, resultText: string) => ToolSummary | void;

export interface MutatingToolOpts {
  /** Defaults to `mcp.<toolName>`. */
  action?: string;
  summarize?: ToolSummarize;
}

// Our tools return failures as text (not thrown errors); recognize those so
// the audit log records the real outcome.
const FAILURE_PATTERNS = [
  /requires the team admin role/i,
  /^invalid\b/i,
  /^nothing to do/i,
  /^no team\b/i,
  /is not connected/i,
  /request failed/i,
  /not found/i,
  /^failed/i,
  /^error/i,
];

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function defaultSummary(action: string, args: any): string {
  const flat = JSON.stringify(args ?? {});
  return flat && flat !== "{}" ? `${action} ${truncateText(flat, 200)}` : action;
}

async function logToolCall(
  userId: string,
  action: string,
  args: any,
  resultText: string | null,
  thrown: unknown,
  extra?: ToolSummary,
): Promise<void> {
  const teamId = await getMcpUserTeamId(userId);
  if (!teamId) return;
  let actor: string | undefined;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    actor = user?.email ?? undefined;
  } catch {
    // Actor label is best effort.
  }
  if (thrown) {
    const message = String((thrown as any)?.message ?? thrown);
    await logActivity({
      teamId,
      userId,
      source: "mcp",
      actor,
      action,
      summary: `${action} failed: ${truncateText(message, 200)}`,
      details: { args },
      status: "error",
      error: message,
    });
    return;
  }
  const text = resultText ?? "";
  const failed = text.trim().length === 0 || FAILURE_PATTERNS.some((re) => re.test(text.trim()));
  await logActivity({
    teamId,
    userId,
    source: "mcp",
    actor,
    action,
    entityType: extra?.entityType,
    entityId: extra?.entityId,
    summary: extra?.summary ?? defaultSummary(action, args),
    details: extra?.details ?? { args, result: truncateText(text, 2000) },
    status: failed ? "error" : "success",
    error: failed ? truncateText(text, 500) : null,
  });
}

/** Registers a state-changing tool and audit-logs every invocation (success
 * and failure). Read-only tools keep using `server.registerTool` directly. */
export function registerMutatingTool(
  server: McpServer,
  userId: string,
  name: string,
  config: { description?: string; inputSchema?: any; outputSchema?: any; annotations?: any },
  handler: (args: any, extra?: any) => Promise<any>,
  opts: MutatingToolOpts = {},
): void {
  const action = opts.action ?? `mcp.${name}`;
  (server as any).registerTool(name, config, async (args: any, extra: any) => {
    let result: any;
    try {
      result = await handler(args, extra);
    } catch (err) {
      await logToolCall(userId, action, args, null, err);
      throw err;
    }
    const text: string = result?.content?.[0]?.text ?? "";
    await logToolCall(userId, action, args, text, null, opts.summarize?.(args, text) ?? undefined);
    return result;
  });
}
