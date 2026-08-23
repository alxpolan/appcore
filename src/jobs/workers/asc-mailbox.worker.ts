import type { Job } from "pg-boss";
import { logger } from "../../config";
import { fetchNewInvites } from "../../services/asc-mailbox";
import { acceptInvite } from "../../services/asc-invite-acceptor";
import { ascInviteAccepted, ascInviteAcceptFailed } from "../../services/notifications/templates";

export const QUEUE_NAME = "asc-mailbox-check";

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
      logger.info(`[asc-mailbox] Accepted invite: "${invite.subject}"`);
      await ascInviteAccepted({ subject: invite.subject, from: invite.from }).catch((err) =>
        logger.error("[asc-mailbox] Failed to send confirmation email", { err }),
      );
    } else {
      logger.warn(`[asc-mailbox] Could not accept invite: "${invite.subject}" — ${result.reason}`);
      await ascInviteAcceptFailed({
        subject: invite.subject,
        from: invite.from,
        reason: result.reason ?? "Unknown error",
        inviteUrl: invite.inviteUrl,
      }).catch((err) => logger.error("[asc-mailbox] Failed to send alert email", { err }));
    }
  }

  logger.info(`[BOSS] "${QUEUE_NAME}" job ${job.id} completed (${invites.length} invite(s) processed)`);
}
