import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { env, logger } from "../config";
import { hasSession, launchMailboxContext, persistSessionCookies } from "./asc-invite-acceptor";

export interface IndividualKey {
  keyId: string;
  privateKey: string;
  providerName: string;
  backupPath: string;
}

export interface GenerateKeyResult {
  ok: boolean;
  key?: IndividualKey;
  reason?: string;
  screenshotPath?: string;
}

interface Provider {
  providerId: number;
  name: string;
}

const SESSION_EXPIRED_REASON =
  "Redirected to Apple ID sign-in even from the persistent profile — session expired, re-run npm run asc-mailbox:login";

function backupKey(key: Omit<IndividualKey, "backupPath">): string {
  const dir = path.dirname(env.ASC_MAILBOX_PROFILE_DIR);
  const file = path.join(dir, `asc-individual-key-${key.keyId}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...key, generatedAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });
  return file;
}

async function getProviders(page: Page): Promise<{ current: Provider | null; available: Provider[] }> {
  const session = await page.evaluate(async () => {
    const res = await fetch("https://appstoreconnect.apple.com/olympus/v1/session", { credentials: "include" });
    if (!res.ok) throw new Error(`olympus/v1/session returned ${res.status}`);
    return res.json();
  });
  return { current: session?.provider ?? null, available: session?.availableProviders ?? [] };
}

async function switchProvider(page: Page, providerId: number): Promise<void> {
  await page.evaluate(async (id) => {
    const res = await fetch("https://appstoreconnect.apple.com/olympus/v1/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: { providerId: id } }),
    });
    if (!res.ok) throw new Error(`Provider switch returned ${res.status}`);
  }, providerId);
}

function pickProvider(current: Provider | null, available: Provider[], hints: string[]): Provider | null {
  const matches = available.filter((p) => hints.some((h) => h.toLowerCase().includes(p.name.toLowerCase())));
  if (matches.length === 1) return matches[0];
  if (available.length === 1) return available[0];
  if (current) {
    logger.warn(
      `[asc-key-generator] No unique team match in invite text — falling back to current team "${current.name}"`,
    );
    return current;
  }
  return null;
}

async function downloadKeyFile(page: Page): Promise<{ keyId: string | null; privateKey: string }> {
  const downloadBtn = page.getByRole("button", { name: /download api key/i }).first();
  await downloadBtn.waitFor({ state: "visible", timeout: 15_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadBtn.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /download/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => {});

  const download = await downloadPromise;
  const filePath = await download.path();
  const privateKey = fs.readFileSync(filePath, "utf8");
  const keyId = /(?:Auth|Api)Key_([A-Z0-9]+)\.p8/i.exec(download.suggestedFilename())?.[1] ?? null;
  return { keyId, privateKey };
}

async function scrapeKeyId(page: Page): Promise<string | null> {
  const cell = page.getByText(/^[A-Z0-9]{10}$/).first();
  return (await cell.textContent({ timeout: 5_000 }).catch(() => null))?.trim() ?? null;
}

export async function generateIndividualKeyForTeam(hints: string[]): Promise<GenerateKeyResult> {
  if (!hasSession()) {
    return {
      ok: false,
      reason: `No saved Chrome profile at ${env.ASC_MAILBOX_PROFILE_DIR} — run "npm run asc-mailbox:login" once.`,
    };
  }

  const context = await launchMailboxContext(true);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto("https://appstoreconnect.apple.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });

    const menuBtn = page.getByRole("button", { name: /account name menu/i }).first();
    await menuBtn.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});

    if (/idmsa\.apple\.com/i.test(page.url())) {
      await context.close();
      return { ok: false, reason: SESSION_EXPIRED_REASON };
    }

    const { current, available } = await getProviders(page);
    const target = pickProvider(current, available, hints);
    if (!target) {
      throw new Error(
        `Could not determine which ASC team the invite came from. Teams available: ${
          available.map((p) => p.name).join(", ") || "(none)"
        }`,
      );
    }

    if (current?.providerId !== target.providerId) {
      await switchProvider(page, target.providerId);
      await page.goto("https://appstoreconnect.apple.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await menuBtn.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    }

    const generateBtn = page.getByRole("button", { name: /^generate key$/i }).first();
    const downloadBtn = page.getByRole("button", { name: /download api key/i }).first();
    const revokeBtn = page.getByRole("button", { name: /revoke/i }).first();
    const errorPage = page.getByText(/can't process your request/i).first();

    let sectionReady = false;
    let spentKeyError: Error | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3 && !sectionReady && !spentKeyError; attempt++) {
      if (attempt > 1) {
        logger.warn(`[asc-key-generator] Retrying profile page (attempt ${attempt}) — ${lastErr}`);
        await page.waitForTimeout(15_000);
        await page.goto("https://appstoreconnect.apple.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
        await menuBtn.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
      }
      await menuBtn.click();
      await page.getByText("Edit Profile", { exact: true }).first().click();
      try {
        await generateBtn
          .or(downloadBtn)
          .or(revokeBtn)
          .or(errorPage)
          .first()
          .waitFor({ state: "visible", timeout: 60_000 });
        if (await errorPage.isVisible().catch(() => false)) {
          lastErr = new Error(`ASC served its transient "We can't process your request." error page`);
          continue;
        }
        if (
          !(await generateBtn.isVisible().catch(() => false)) &&
          !(await downloadBtn.isVisible().catch(() => false))
        ) {
          const existingKeyId = await scrapeKeyId(page);
          spentKeyError = new Error(
            `An individual API key${existingKeyId ? ` (${existingKeyId})` : ""} already exists on team "${target.name}" but its .p8 was never captured and Apple only allows one download. Revoke it in App Store Connect and re-run.`,
          );
          continue;
        }
        sectionReady = true;
      } catch (err) {
        lastErr = err;
      }
    }

    if (spentKeyError) throw spentKeyError;
    if (!sectionReady) {
      throw new Error(
        `Individual API Key section did not load after 3 attempts — asc@marteso.com may be missing the "Generate Individual API Keys" permission on team "${target.name}": ${lastErr}`,
      );
    }

    if (await generateBtn.isVisible().catch(() => false)) {
      await generateBtn.click();
    }

    const { keyId: fileKeyId, privateKey } = await downloadKeyFile(page);

    const keyId = fileKeyId ?? (await scrapeKeyId(page));
    if (!keyId) {
      throw new Error("Downloaded the .p8 but could not determine its Key ID (filename or page)");
    }

    if (!/BEGIN PRIVATE KEY/.test(privateKey)) {
      throw new Error("Downloaded file does not look like a .p8 private key");
    }

    const backupPath = backupKey({ keyId, privateKey, providerName: target.name });
    logger.info(
      `[asc-key-generator] Generated individual API key ${keyId} on ASC team "${target.name}" (backup: ${backupPath})`,
    );

    await persistSessionCookies(context);
    await context.close();
    return { ok: true, key: { keyId, privateKey, providerName: target.name, backupPath } };
  } catch (err) {
    const screenshotPath = path.join(env.ASC_MAILBOX_PROFILE_DIR, `..`, `asc-key-failure-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    logger.error("[asc-key-generator] Failed to generate individual API key", { err });
    await persistSessionCookies(context);
    await context.close();
    return { ok: false, reason: String(err), screenshotPath };
  }
}
