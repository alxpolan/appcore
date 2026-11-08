import { randomUUID } from "node:crypto";
import { setAppleSessionCookies } from "./apple-web-session";

export type AppleLoginStage = "password" | "2fa" | "done" | "failed";

export interface AppleLoginState {
  id: string;
  stage: AppleLoginStage;
  message: string | null;
  createdAt: number;
}

interface LocatorHandle {
  waitFor(opts?: any): Promise<void>;
  fill(value: string): Promise<void>;
  click(opts?: any): Promise<void>;
}

interface BrowserPage {
  goto(url: string, opts?: any): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  locator(selector: string): { first(): LocatorHandle; count(): Promise<number> };
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  close(): Promise<void>;
}

interface BrowserContext {
  pages(): BrowserPage[];
  newPage(): Promise<BrowserPage>;
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  close(): Promise<void>;
}

interface BrowserLauncher {
  launch(opts?: any): Promise<{ newContext(opts?: any): Promise<BrowserContext>; close(): Promise<void> }>;
}

const LOGIN_TTL_MS = 10 * 60 * 1000;
const APPSTORE_URL = "https://appstoreconnect.apple.com/apps";

const logins = new Map<string, { state: AppleLoginState; run: Promise<void>; close: () => Promise<void> }>();

function fail(id: string, message: string, close: () => Promise<void>): void {
  const entry = logins.get(id);

  if (entry) entry.state = { ...entry.state, stage: "failed", message };

  void close().catch(() => undefined);
}

async function fillFirst(page: BrowserPage, selectors: string[], value: string, submit = false): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const field = page.locator(selector).first();

      await field.waitFor({ timeout: 5000 });
      await field.fill(value);

      if (submit) await field.click({ timeout: 5000 });

      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function clickFirst(page: BrowserPage, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();

      await button.waitFor({ timeout: 5000 });
      await button.click({ timeout: 8000 });

      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function cookiesForApple(context: BrowserContext): Promise<string> {
  const all = await context.cookies();

  return all
    .filter((c) => c.domain.endsWith("apple.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function runLogin(
  id: string,
  email: string,
  password: string,
  launcher: BrowserLauncher,
  waitForCode: () => Promise<string | null>,
  onDone?: (cookies: string) => void,
): Promise<void> {
  const storeCookies = onDone ?? setAppleSessionCookies;
  const entry = logins.get(id);

  if (!entry) return;

  const close = entry.close;
  let browser: { newContext(opts?: any): Promise<BrowserContext>; close(): Promise<void> } | null = null;

  try {
    browser = await launcher.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    const page = await context.newPage();
    const done = logins.get(id);

    if (!done) {
      await context.close().catch(() => undefined);

      return;
    }

    done.close = async () => {
      await context.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    };

    await page.goto(APPSTORE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    if (page.url().includes("appstoreconnect.apple.com/apps")) {
      const header = await cookiesForApple(context);

      if (header.length > 100) {
        storeCookies(header);
        entry.state = { ...entry.state, stage: "done", message: null };
        await done.close();

        return;
      }
    }

    const emailFilled = await fillFirst(
      page,
      ["#account_name_text_field", "input[type=email]", "input[name=accountName]", "input[autocomplete=username]"],
      email,
    );

    if (!emailFilled) {
      fail(id, "Apple login page did not show an email field", done.close);

      return;
    }

    await clickFirst(page, ["#sign-in", "button[type=submit]", "button:has-text('Continue')"]);
    await page.waitForTimeout(5000);

    const passwordFilled = await fillFirst(
      page,
      ["#password_text_field", "input[type=password]", "input[name=password]"],
      password,
    );

    if (!passwordFilled) {
      fail(id, "Apple login page did not show a password field", done.close);

      return;
    }

    await clickFirst(page, ["#sign-in", "button[type=submit]", "button:has-text('Sign In')"]);
    await page.waitForTimeout(8000);

    for (let attempt = 0; attempt < 40; attempt++) {
      const current = logins.get(id);

      if (!current || current.state.stage === "failed") return;

      if (page.url().includes("appstoreconnect.apple.com/apps")) {
        const header = await cookiesForApple(context);

        if (header.length > 100) {
          storeCookies(header);
          current.state = { ...current.state, stage: "done", message: null };
          await current.close();

          return;
        }
      }

      let codeCount = 0;

      try {
        codeCount = await page.locator("input[inputmode=numeric], input[type=tel]").count();
      } catch {
        codeCount = 0;
      }

      if (codeCount > 0) {
        current.state = { ...current.state, stage: "2fa", message: "Enter the 6-digit code from your trusted device" };

        const code = await waitForCode();
        const latest = logins.get(id);

        if (!latest || latest.state.stage === "failed") return;

        if (!code) {
          fail(id, "Two-factor code was not provided in time", latest.close);

          return;
        }

        const digits = code.replace(/\D/g, "");

        if (digits.length !== 6) {
          fail(id, "Two-factor code must be 6 digits", latest.close);

          return;
        }

        await fillFirst(
          page,
          ["input[inputmode=numeric]", "input[type=tel]", "input[autocomplete=one-time-code]"],
          digits,
        );
        await clickFirst(page, ["button[type=submit]", "button:has-text('Continue')", "button:has-text('Verify')"]);
        await page.waitForTimeout(8000);

        continue;
      }

      await page.waitForTimeout(5000);
    }

    fail(id, "Apple login did not complete in time", entry.close);
  } catch (err: any) {
    fail(id, err?.message ?? "Apple login failed", close);
  }
}

export function getAppleLogin(id: string): AppleLoginState | null {
  const entry = logins.get(id);

  if (!entry) return null;

  if (Date.now() - entry.state.createdAt > LOGIN_TTL_MS && entry.state.stage !== "done") {
    entry.state = { ...entry.state, stage: "failed", message: "Login expired" };
    void entry.close().catch(() => undefined);
  }

  const { id: loginId, stage, message, createdAt } = entry.state;

  return { id: loginId, stage, message, createdAt };
}

export async function cancelAppleLogin(id: string): Promise<void> {
  const entry = logins.get(id);

  if (!entry) return;

  entry.state = { ...entry.state, stage: "failed", message: "Cancelled" };
  await entry.close().catch(() => undefined);
  logins.delete(id);
}

export interface LoginDeps {
  launcher?: BrowserLauncher;
  onCode?: (id: string) => Promise<string | null>;
  onDone?: (cookies: string) => void;
}

const pendingCodes = new Map<string, { resolve: (code: string | null) => void }>();

export function submitAppleLoginCode(id: string, code: string): boolean {
  const pending = pendingCodes.get(id);

  if (!pending) return false;

  pendingCodes.delete(id);
  pending.resolve(code);

  return true;
}

export async function startAppleLogin(
  email: string,
  password: string,
  deps: LoginDeps = {},
): Promise<AppleLoginState> {
  const trimmedEmail = email.trim();
  const trimmedPassword = password;

  if (!trimmedEmail || !trimmedPassword) {
    throw new Error("Email and password are required");
  }

  for (const entry of logins.values()) {
    if (entry.state.stage === "password" || entry.state.stage === "2fa") {
      throw new Error("An Apple login is already running");
    }
  }

  for (const [id, entry] of logins) {
    if (Date.now() - entry.state.createdAt > LOGIN_TTL_MS) {
      void entry.close().catch(() => undefined);
      logins.delete(id);
    }
  }

  const id = randomUUID();
  const state: AppleLoginState = { id, stage: "password", message: null, createdAt: Date.now() };
  const close = async (): Promise<void> => undefined;

  logins.set(id, { state, run: Promise.resolve(), close });

  let launcher: BrowserLauncher;

  if (deps.launcher) {
    launcher = deps.launcher;
  } else {
    const { chromium } = await import("playwright");

    launcher = chromium as unknown as BrowserLauncher;
  }

  const waitForCode = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (deps.onCode) {
        void deps.onCode(id).then(resolve);
        return;
      }

      pendingCodes.set(id, { resolve });
      setTimeout(() => {
        if (pendingCodes.delete(id)) resolve(null);
      }, 5 * 60 * 1000).unref?.();
    });

  const run = runLogin(id, trimmedEmail, trimmedPassword, launcher, waitForCode, deps.onDone);
  const created = logins.get(id);

  if (created) created.run = run;

  await Promise.resolve();

  return { ...state };
}
