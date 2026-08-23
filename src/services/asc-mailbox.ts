import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env, logger } from "../config";

export interface AscInviteEmail {
  uid: number;
  subject: string;
  from: string;
  receivedAt: Date | null;
  inviteUrl: string | null;
  rawTextExcerpt: string;
}

// Verified against a real invite (2026-08-23): from noreply@email.apple.com,
// subject "You've been invited to App Store Connect.", link
// https://appstoreconnect.apple.com/activation_ds?key=<hex>. Kept loose rather
// than pinned to that exact shape — better to pick up a false positive
// (harmless, the acceptor will fail closed and alert) than to miss a real invite
// if Apple tweaks subject wording or the link path.
const SENDER_HINT = /apple\.com/i;
const SUBJECT_HINT = /invit/i;
const INVITE_LINK = /https:\/\/appstoreconnect\.apple\.com\/[^\s"'<>]+/i;

export function isConfigured(): boolean {
  return !!(env.ASC_MAILBOX_IMAP_HOST && env.ASC_MAILBOX_IMAP_USER && env.ASC_MAILBOX_IMAP_PASSWORD);
}

// Fetches unseen, apparently-Apple-invite messages and marks them \Seen so they
// aren't reprocessed. Callers are responsible for acting on (or alerting about)
// each returned invite — this function's only job is "find and mark as read".
export async function fetchNewInvites(): Promise<AscInviteEmail[]> {
  if (!isConfigured()) {
    logger.warn("[asc-mailbox] Not configured (ASC_MAILBOX_IMAP_* missing) — skipping");
    return [];
  }

  const client = new ImapFlow({
    host: env.ASC_MAILBOX_IMAP_HOST!,
    port: env.ASC_MAILBOX_IMAP_PORT,
    secure: true,
    auth: {
      user: env.ASC_MAILBOX_IMAP_USER!,
      pass: env.ASC_MAILBOX_IMAP_PASSWORD!,
    },
    logger: false,
  });

  const found: AscInviteEmail[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return found;

      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const from = msg.envelope?.from?.[0]?.address ?? "";
        const subject = msg.envelope?.subject ?? "";
        const looksLikeInvite = SENDER_HINT.test(from) && SUBJECT_HINT.test(subject);

        if (looksLikeInvite) {
          const parsed = await simpleParser(msg.source);
          const html = parsed.html || "";
          const text = parsed.text || "";
          const linkMatch = INVITE_LINK.exec(html) ?? INVITE_LINK.exec(text);

          found.push({
            uid,
            subject,
            from,
            receivedAt: msg.envelope?.date ?? null,
            inviteUrl: linkMatch?.[0] ?? null,
            rawTextExcerpt: (text || html.replace(/<[^>]+>/g, " ")).slice(0, 500),
          });
        }

        // Mark every scanned message \Seen regardless of match — leaving
        // unrelated mail unread would make this scan the whole inbox every run.
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return found;
}
