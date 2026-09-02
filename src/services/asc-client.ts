import { getEffectiveSettings, getEffectiveSettingsForTeam, type EffectiveSettings } from "../config";
import { AppStoreConnectClient } from "./appstore-connect";

export function hasAscCredentials(settings: EffectiveSettings): boolean {
  return Boolean(settings.ascIssuerId && settings.ascKeyId && settings.ascPrivateKey);
}

/**
 * Builds an ASC client from effective settings (manual team keys or individual
 * auto-connect keys, both already decrypted). Returns null when no credentials
 * are configured so each caller can decide how to fail.
 */
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
