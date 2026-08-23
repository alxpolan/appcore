import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";
import { env, logger } from "../config";

export interface AscInviteEmail {
  uid: number;
  folder: string;
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
const ACTIVATION_LINK = /https:\/\/appstoreconnect\.apple\.com\/activation_ds\?[^\s"'<>]+/i;
const ASSET_LINK = /\.(png|gif|jpe?g|svg)(\?|$)/i;

// The email body is a marketing-style HTML table full of appstoreconnect.apple.com
// asset links (logo, spacer images) alongside the one real accept link — a plain
// "any appstoreconnect.apple.com URL" regex matches the logo before the link we
// actually want. Prefer the anchor whose visible text says "accept"; fall back to
// the known activation_ds path shape; last resort, any non-image ASC link.
export function extractInviteLink(html: string, text: string): string | null {
  if (html) {
    const $ = cheerio.load(html);
    const acceptAnchor = $("a")
      .filter((_, el) => /accept/i.test($(el).text()))
      .first();
    const href = acceptAnchor.attr("href");
    if (href && href.startsWith("http")) return href;
  }

  return ACTIVATION_LINK.exec(html)?.[0] ?? ACTIVATION_LINK.exec(text)?.[0] ?? findNonAssetLink(html) ?? findNonAssetLink(text);
}

function findNonAssetLink(source: string): string | null {
  const matches = source.match(/https:\/\/appstoreconnect\.apple\.com\/[^\s"'<>]+/gi) ?? [];
  return matches.find((url) => !ASSET_LINK.test(url)) ?? null;
}

// Mail providers auto-file Apple's invite into all sorts of places (Zoho put a
// real one straight into a "Notification" folder, not INBOX) — so every folder
// is scanned except these, where an invite would never land and where it'd be
// destructive to move mail out of (Trash/Drafts/Sent), plus our own archive.
const PROCESSED_FOLDER = "Archive";
const SKIP_FOLDERS = new Set([
  "Papierkorb",
  "Trash",
  "Gesendet",
  "Sent",
  "Sent Items",
  "Entwürfe",
  "Drafts",
  PROCESSED_FOLDER,
]);

export function isConfigured(): boolean {
  return !!(env.ASC_MAILBOX_IMAP_HOST && env.ASC_MAILBOX_IMAP_USER && env.ASC_MAILBOX_IMAP_PASSWORD);
}

function newClient(): ImapFlow {
  return new ImapFlow({
    host: env.ASC_MAILBOX_IMAP_HOST!,
    port: env.ASC_MAILBOX_IMAP_PORT,
    secure: true,
    auth: {
      user: env.ASC_MAILBOX_IMAP_USER!,
      pass: env.ASC_MAILBOX_IMAP_PASSWORD!,
    },
    logger: false,
  });
}

// Scans every folder (except the skip list) for apparently-Apple-invite
// messages and moves each match into the Archive folder as it's found — that
// both keeps this idempotent (Archive is never rescanned) and doubles as a
// human-readable audit trail of everything this pipeline has ever picked up.
// Deliberately does NOT rely on the \Seen flag: opening a message in webmail
// (e.g. to copy its contents) flips it to read and would otherwise make it
// invisible to an unseen-only search.
export async function fetchNewInvites(): Promise<AscInviteEmail[]> {
  if (!isConfigured()) {
    logger.warn("[asc-mailbox] Not configured (ASC_MAILBOX_IMAP_* missing) — skipping");
    return [];
  }

  const client = newClient();
  const found: AscInviteEmail[] = [];

  await client.connect();
  try {
    const folders = await client.list();

    for (const folder of folders) {
      if (SKIP_FOLDERS.has(folder.path)) continue;

      const lock = await client.getMailboxLock(folder.path);
      try {
        const uids = await client.search({ all: true }, { uid: true });
        if (!uids || uids.length === 0) continue;

        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.source) continue;

          const from = msg.envelope?.from?.[0]?.address ?? "";
          const subject = msg.envelope?.subject ?? "";
          if (!SENDER_HINT.test(from) || !SUBJECT_HINT.test(subject)) continue;

          const parsed = await simpleParser(msg.source);
          const html = parsed.html || "";
          const text = parsed.text || "";

          found.push({
            uid,
            folder: folder.path,
            subject,
            from,
            receivedAt: msg.envelope?.date ?? null,
            inviteUrl: extractInviteLink(html, text),
            rawTextExcerpt: (text || html.replace(/<[^>]+>/g, " ")).slice(0, 500),
          });

          await client.messageMove(uid, PROCESSED_FOLDER, { uid: true }).catch((err) => {
            logger.error(`[asc-mailbox] Failed to move message to ${PROCESSED_FOLDER}`, { err, folder: folder.path, uid });
          });
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return found;
}
