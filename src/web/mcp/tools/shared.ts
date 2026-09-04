import { prisma, getEffectiveSettings } from "../../../config";

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
