// One-time, manual setup: opens a real (headed) browser so a human can sign in
// to appstoreconnect.apple.com as asc@marteso.com — including 2FA — then saves
// the authenticated session so the asc-mailbox worker can reuse it headlessly.
//
// Run again whenever the automated invite-accept flow reports the session has
// expired (Apple periodically invalidates long-lived sessions).
//
// Usage: npm run asc-mailbox:login
import readline from "readline";
import path from "path";
import fs from "fs";
import { chromium } from "playwright";
import { env } from "../src/config/env";

async function main() {
  const sessionPath = env.ASC_MAILBOX_SESSION_PATH;
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://appstoreconnect.apple.com/");

  console.log("\nA browser window has opened.");
  console.log(`Sign in as asc@marteso.com (complete 2FA if prompted).`);
  console.log("Once you're on the App Store Connect dashboard, come back here and press Enter.\n");

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Press Enter once signed in… ", () => {
      rl.close();
      resolve();
    });
  });

  await context.storageState({ path: sessionPath });
  await browser.close();

  console.log(`\nSaved session to ${sessionPath}. The asc-mailbox worker can now use it.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
