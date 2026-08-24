import fs from "fs";
import path from "path";
import { chromium, type BrowserContext } from "playwright";
import { env, logger } from "../config";

export interface AcceptResult {
  accepted: boolean;
  reason?: string;
  screenshotPath?: string;
}

export function hasSession(): boolean {
  return fs.existsSync(env.ASC_MAILBOX_PROFILE_DIR);
}

export async function persistSessionCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((c) => c.expires === -1);
    if (sessionCookies.length === 0) return;
    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    await context.addCookies(sessionCookies.map((c) => ({ ...c, expires })));
  } catch (err) {
    logger.warn("[asc-invite-acceptor] Could not persist session cookies", { err });
  }
}

let cachedUserAgent: string | undefined;
async function getRealChromeUserAgent(): Promise<string> {
  if (!cachedUserAgent) {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    await browser.close();
    cachedUserAgent = ua.replace("HeadlessChrome", "Chrome");
  }
  return cachedUserAgent;
}

export async function launchMailboxContext(headless: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(env.ASC_MAILBOX_PROFILE_DIR, {
    headless,
    channel: "chrome",
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled"],
    ...(headless ? { userAgent: await getRealChromeUserAgent() } : {}),
  });
}

export async function acceptInvite(inviteUrl: string): Promise<AcceptResult> {
  if (!hasSession()) {
    return {
      accepted: false,
      reason: `No saved Chrome profile at ${env.ASC_MAILBOX_PROFILE_DIR} — run "npm run asc-mailbox:login" once.`,
    };
  }

  const context = await launchMailboxContext(true);

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

    const deadline = Date.now() + 60_000;
    let clickedAccept = false;
    while (Date.now() < deadline) {
      const url = page.url();

      if (/idmsa\.apple\.com/i.test(url)) {
        await context.close();
        return {
          accepted: false,
          reason:
            "Redirected to Apple ID sign-in even from the persistent profile — session expired, re-run npm run asc-mailbox:login",
        };
      }

      if (/developer\.apple\.com\/account|appstoreconnect\.apple\.com\/(?:apps|$)/i.test(url)) {
        await persistSessionCookies(context);
        await context.close();
        return { accepted: true };
      }

      const acceptButton = page.getByRole("button", { name: /accept/i }).first();
      if (!clickedAccept && (await acceptButton.isVisible().catch(() => false))) {
        await acceptButton.click().catch(() => {});
        clickedAccept = true;
      }

      await page.waitForTimeout(1500);
    }

    if (clickedAccept) {
      await persistSessionCookies(context);
      await context.close();
      return { accepted: true };
    }
    throw new Error(`Timed out after 60s waiting for the accept flow to complete (stuck on ${page.url()})`);
  } catch (err) {
    const screenshotPath = path.join(env.ASC_MAILBOX_PROFILE_DIR, `..`, `asc-invite-failure-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    logger.error("[asc-invite-acceptor] Failed to accept invite", { err, inviteUrl });
    await persistSessionCookies(context);
    await context.close();
    return { accepted: false, reason: String(err), screenshotPath };
  }
}
