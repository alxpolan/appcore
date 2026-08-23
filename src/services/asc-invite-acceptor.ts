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
  return fs.existsSync(env.ASC_MAILBOX_PROFILE_DIR);
}

export async function acceptInvite(inviteUrl: string): Promise<AcceptResult> {
  if (!hasSession()) {
    return {
      accepted: false,
      reason: `No saved Chrome profile at ${env.ASC_MAILBOX_PROFILE_DIR} — run "npm run asc-mailbox:login" once.`,
    };
  }

  const context = await chromium.launchPersistentContext(env.ASC_MAILBOX_PROFILE_DIR, {
    headless: true,
    channel: "chrome",
  });

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(inviteUrl, { waitUntil: "networkidle", timeout: 30_000 });

    const signInBtn = page.getByRole("button", { name: /sign in with apple account/i });
    const signInBtnVisible = await signInBtn
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (signInBtnVisible) {
      await signInBtn.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    if (/idmsa\.apple\.com/i.test(page.url())) {
      await context.close();
      return {
        accepted: false,
        reason:
          "Redirected to Apple ID sign-in even from the persistent profile — session expired, re-run npm run asc-mailbox:login",
      };
    }

    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await acceptButton.waitFor({ state: "visible", timeout: 15_000 });
    await acceptButton.click();

    await page.waitForTimeout(2000);

    await context.close();
    return { accepted: true };
  } catch (err) {
    const screenshotPath = path.join(env.ASC_MAILBOX_PROFILE_DIR, `..`, `asc-invite-failure-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    logger.error("[asc-invite-acceptor] Failed to accept invite", { err, inviteUrl });
    await context.close();
    return { accepted: false, reason: String(err), screenshotPath };
  }
}
