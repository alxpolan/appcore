import type { Job } from "pg-boss";
import { logger, prisma } from "../../config";
import { encrypt } from "../../config/encryption";
import { fetchNewInvites, type AscInviteEmail } from "../../services/asc-mailbox";
import { acceptInvite } from "../../services/asc-invite-acceptor";
import { generateIndividualKeyForTeam } from "../../services/asc-key-generator";
import { AppStoreConnectClient } from "../../services/appstore-connect";
import { INDIVIDUAL_KEY_ISSUER } from "../../services/utils/asc-token";
import {
  ascConnectCompleted,
  ascKeyGenerationFailed,
  ascKeyNeedsManualLink,
  ascInviteAcceptFailed,
  ascInviteNeedsManualAccept,
} from "../../services/notifications/templates";

export const QUEUE_NAME = "asc-mailbox-check";

async function provisionApiKey(invite: AscInviteEmail): Promise<void> {
  const keyResult = await generateIndividualKeyForTeam([invite.subject, invite.rawTextExcerpt]);
  if (!keyResult.ok || !keyResult.key) {
    await ascKeyGenerationFailed({
      subject: invite.subject,
      reason: keyResult.reason ?? "Unknown error",
      screenshotPath: keyResult.screenshotPath,
    });
    return;
  }
  const { keyId, privateKey, providerName, backupPath } = keyResult.key;

  try {
    await new AppStoreConnectClient({ issuerId: INDIVIDUAL_KEY_ISSUER, keyId, privateKey }).listApps();
  } catch (err) {
    await ascKeyGenerationFailed({
      subject: invite.subject,
      reason: `Individual key ${keyId} (ASC team "${providerName}") failed verification against the ASC API: ${err} (backup: ${backupPath})`,
    });
    return;
  }

  const pending = await prisma.teamSettings.findMany({
    where: { ascAccountConnectRequestedAt: { not: null }, ascAutoKeyId: null },
    include: { team: true },
    orderBy: { ascAccountConnectRequestedAt: "asc" },
  });

  if (pending.length === 1) {
    await prisma.teamSettings.update({
      where: { id: pending[0].id },
      data: { ascAutoKeyId: keyId, ascAutoPrivateKey: encrypt(privateKey), ascAutoConnectedAt: new Date() },
    });
    logger.info(`[asc-mailbox] Linked individual API key ${keyId} to team "${pending[0].team.name}"`);
    await ascConnectCompleted({ subject: invite.subject, teamName: pending[0].team.name, keyId });
  } else {
    await ascKeyNeedsManualLink({
      subject: invite.subject,
      keyId,
      backupPath,
      pendingTeams: pending.map((p) => p.team.name),
    });
  }
}

export async function handler([job]: Job<Record<string, never>>[]): Promise<void> {
  logger.info(`[BOSS] Starting "${QUEUE_NAME}" job ${job.id}…`);

  const invites = await fetchNewInvites();
  if (invites.length === 0) {
    logger.info(`[BOSS] "${QUEUE_NAME}" job ${job.id}: no new invites`);
    return;
  }

  for (const invite of invites) {
    if (!invite.inviteUrl) {
      logger.warn(`[asc-mailbox] Invite-looking email had no extractable link: "${invite.subject}"`);
      await ascInviteAcceptFailed({
        subject: invite.subject,
        from: invite.from,
        reason: "No App Store Connect link found in the email body",
        inviteUrl: null,
      }).catch((err) => logger.error("[asc-mailbox] Failed to send alert email", { err }));
      continue;
    }

    const result = await acceptInvite(invite.inviteUrl);

    if (result.accepted) {
      logger.info(`[asc-mailbox] Accepted invite: "${invite.subject}" — waiting 60s before key provisioning`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      await provisionApiKey(invite).catch((err) =>
        logger.error("[asc-mailbox] API key provisioning failed unexpectedly", { err }),
      );
    } else {
      logger.info(`[asc-mailbox] Auto-accept did not go through (expected): "${invite.subject}" — ${result.reason}`);
      await ascInviteNeedsManualAccept({
        subject: invite.subject,
        from: invite.from,
        inviteUrl: invite.inviteUrl,
      }).catch((err) => logger.error("[asc-mailbox] Failed to send alert email", { err }));
    }
  }

  logger.info(`[BOSS] "${QUEUE_NAME}" job ${job.id} completed (${invites.length} invite(s) processed)`);
}
