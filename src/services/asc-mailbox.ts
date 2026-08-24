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

const SENDER_HINT = /apple\.com/i;
const SUBJECT_HINT = /invit/i;
const ACTIVATION_LINK = /https:\/\/appstoreconnect\.apple\.com\/activation_ds\?[^\s"'<>]+/i;
const ASSET_LINK = /\.(png|gif|jpe?g|svg)(\?|$)/i;

export function extractInviteLink(html: string, text: string): string | null {
  if (html) {
    const $ = cheerio.load(html);
    const acceptAnchor = $("a")
      .filter((_, el) => /accept/i.test($(el).text()))
      .first();
    const href = acceptAnchor.attr("href");
    if (href && href.startsWith("http")) return href;
  }

  return (
    ACTIVATION_LINK.exec(html)?.[0] ??
    ACTIVATION_LINK.exec(text)?.[0] ??
    findNonAssetLink(html) ??
    findNonAssetLink(text)
  );
}

function findNonAssetLink(source: string): string | null {
  const matches = source.match(/https:\/\/appstoreconnect\.apple\.com\/[^\s"'<>]+/gi) ?? [];
  return matches.find((url) => !ASSET_LINK.test(url)) ?? null;
}

const PROCESSED_FOLDER = "Archive";
const PROCESSED_KEYWORD = "MartesoProcessed";
const SKIP_FOLDERS = new Set(["Papierkorb", "Trash", "Gesendet", "Sent", "Sent Items", "Entwürfe", "Drafts"]);

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

export async function fetchNewInvites(): Promise<AscInviteEmail[]> {
  if (!isConfigured()) {
    logger.warn("[asc-mailbox] Not configured (ASC_MAILBOX_IMAP_* missing) — skipping");
    return [];
  }

  const client = newClient();
  const found: AscInviteEmail[] = [];
  const scanned: string[] = [];

  await client.connect();
  try {
    const folders = await client.list();

    for (const folder of folders) {
      if (SKIP_FOLDERS.has(folder.path)) continue;

      let lock;
      try {
        lock = await client.getMailboxLock(folder.path);
      } catch (err) {
        logger.error(`[asc-mailbox] Could not open folder "${folder.path}" — skipping it`, { err });
        continue;
      }
      try {
        const uids = (await client.search({ all: true }, { uid: true })) || [];
        scanned.push(`${folder.path}: ${uids.length}`);
        if (uids.length === 0) continue;

        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true, envelope: true, flags: true }, { uid: true });
          if (!msg || !msg.source) continue;
          if (msg.flags?.has(PROCESSED_KEYWORD)) continue;

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

          await client.messageFlagsAdd(uid, [PROCESSED_KEYWORD], { uid: true }).catch((err) => {
            logger.error(`[asc-mailbox] Failed to set ${PROCESSED_KEYWORD} flag`, {
              err,
              folder: folder.path,
              uid,
            });
          });
          if (folder.path !== PROCESSED_FOLDER) {
            await client.messageMove(uid, PROCESSED_FOLDER, { uid: true }).catch((err) => {
              logger.error(`[asc-mailbox] Failed to move message to ${PROCESSED_FOLDER}`, {
                err,
                folder: folder.path,
                uid,
              });
            });
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  logger.info(
    `[asc-mailbox] Scanned ${scanned.length} folder(s) (${scanned.join(", ")}) — ${found.length} invite candidate(s)`,
  );
  return found;
}
