import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { env, logger } from "../config";

export interface AcceptResult {
  accepted: boolean;
  reason?: string;
  screenshotPath?: string;
}

export function hasSession(): boolean {
  return fs.existsSync(env.ASC_MAILBOX_SESSION_PATH);
}

// Requires a Playwright storage state captured by `npm run asc-mailbox:login`
// (a manual, one-time Apple ID sign-in — Apple ID + 2FA can't be scripted
// blind). Fails closed and reports why whenever the session looks stale or the
// ASC invite page doesn't look like we expect, rather than guessing.
export async function acceptInvite(inviteUrl: string): Promise<AcceptResult> {
  if (!hasSession()) {
    return {
      accepted: false,
      reason: `No saved Apple ID session at ${env.ASC_MAILBOX_SESSION_PATH} — run "npm run asc-mailbox:login" once.`,
    };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: env.ASC_MAILBOX_SESSION_PATH });
  const page = await context.newPage();

  try {
    await page.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (/idmsa\.apple\.com|signin/i.test(page.url())) {
      await browser.close();
      return {
        accepted: false,
        reason: "Redirected to Apple ID sign-in — saved session expired, re-run npm run asc-mailbox:login",
      };
    }

    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await acceptButton.waitFor({ state: "visible", timeout: 15_000 });
    await acceptButton.click();

    // Apple shows a confirmation state after accepting; give it a moment before
    // we persist cookies and close, so the click has actually registered.
    await page.waitForTimeout(2000);

    await context.storageState({ path: env.ASC_MAILBOX_SESSION_PATH });
    await browser.close();
    return { accepted: true };
  } catch (err) {
    const screenshotPath = path.join(
      path.dirname(env.ASC_MAILBOX_SESSION_PATH),
      `asc-invite-failure-${Date.now()}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    logger.error("[asc-invite-acceptor] Failed to accept invite", { err, inviteUrl });
    await browser.close();
    return { accepted: false, reason: String(err), screenshotPath };
  }
}
