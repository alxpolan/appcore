import readline from "readline";
import fs from "fs";
import { env } from "../src/config/env";
import { launchMailboxContext, persistSessionCookies } from "../src/services/asc-invite-acceptor";

async function main() {
  const profileDir = env.ASC_MAILBOX_PROFILE_DIR;
  fs.mkdirSync(profileDir, { recursive: true });

  const context = await launchMailboxContext(false);
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

  await persistSessionCookies(context);
  await context.close();

  console.log(`\nSaved persistent profile to ${profileDir}. The asc-mailbox worker can now use it.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
