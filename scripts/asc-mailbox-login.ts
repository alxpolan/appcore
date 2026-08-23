// One-time, manual setup: opens a real (headed) browser with a persistent
// Chrome profile so a human can sign in to appstoreconnect.apple.com as
// asc@marteso.com — including 2FA — then keeps that profile around so the
// asc-mailbox worker can reuse it headlessly.
//
// A persistent profile (not just a captured cookie snapshot) matters: Apple's
// invite-accept flow forces a fresh interactive sign-in from a throwaway
// session no matter how recent, but generally trusts a continuously-used real
// browser profile more than cookies replayed into a fresh context.
//
// Run again (into the same profile dir) whenever the automated invite-accept
// flow reports it's back to hitting a sign-in wall.
//
// Usage: npm run asc-mailbox:login
import readline from "readline";
import path from "path";
import fs from "fs";
import { chromium } from "playwright";
import { env } from "../src/config/env";

async function main() {
  const profileDir = env.ASC_MAILBOX_PROFILE_DIR;
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: "chrome",
  });
  const page = context.pages()[0] ?? (await context.newPage());

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

  await context.close();

  console.log(`\nSaved persistent profile to ${profileDir}. The asc-mailbox worker can now use it.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
