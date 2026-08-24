import { prisma } from "./database";
import { decryptNullable } from "./encryption";
import { INDIVIDUAL_KEY_ISSUER } from "../services/utils/asc-token";

export interface EffectiveSettings {
  teamId: string;
  ascIssuerId: string;
  ascKeyId: string;
  ascPrivateKey: string;
  ascVendorNumber: string;
}

async function getTeamIdForUser(userId: string): Promise<string | null> {
  const membership = await prisma.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return membership?.teamId ?? null;
}

export async function getTeamSettings(teamId: string) {
  return prisma.teamSettings.findUnique({ where: { teamId } });
}

export async function getEffectiveSettingsForTeam(teamId: string): Promise<EffectiveSettings> {
  const s = await getTeamSettings(teamId);

  const hasManualKey = !!(s?.ascIssuerId && s?.ascKeyId && s?.ascPrivateKey);
  if (!hasManualKey && s?.ascAutoKeyId && s?.ascAutoPrivateKey) {
    return {
      teamId,
      ascIssuerId: INDIVIDUAL_KEY_ISSUER,
      ascKeyId: s.ascAutoKeyId,
      ascPrivateKey: decryptNullable(s.ascAutoPrivateKey) ?? "",
      ascVendorNumber: s.ascVendorNumber ?? "",
    };
  }

  return {
    teamId,
    ascIssuerId: s?.ascIssuerId ?? "",
    ascKeyId: s?.ascKeyId ?? "",
    ascPrivateKey: decryptNullable(s?.ascPrivateKey) ?? "",
    ascVendorNumber: s?.ascVendorNumber ?? "",
  };
}

export async function getEffectiveSettings(userId: string): Promise<EffectiveSettings> {
  const teamId = await getTeamIdForUser(userId);
  if (!teamId) return getEffectiveSettingsForTeam("");
  return getEffectiveSettingsForTeam(teamId);
}
