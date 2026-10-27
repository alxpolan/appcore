import { getEffectiveSettings, getEffectiveSettingsForTeam, type EffectiveSettings } from "../config";
import { AppStoreConnectClient } from "./appstore-connect";

export function hasAscCredentials(settings: EffectiveSettings): boolean {
  return Boolean(settings.ascIssuerId && settings.ascKeyId && settings.ascPrivateKey);
}

export function ascClientFromSettings(settings: EffectiveSettings): AppStoreConnectClient | null {
  if (!hasAscCredentials(settings)) return null;

  return new AppStoreConnectClient(
    { issuerId: settings.ascIssuerId, keyId: settings.ascKeyId, privateKey: settings.ascPrivateKey },
    { teamId: settings.teamId || undefined },
  );
}

export async function ascClientForUser(userId: string): Promise<AppStoreConnectClient | null> {
  return ascClientFromSettings(await getEffectiveSettings(userId));
}

export async function ascClientForTeam(teamId: string): Promise<AppStoreConnectClient | null> {
  return ascClientFromSettings(await getEffectiveSettingsForTeam(teamId));
}
