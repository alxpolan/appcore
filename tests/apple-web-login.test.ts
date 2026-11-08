import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cancelAppleLogin,
  getAppleLogin,
  startAppleLogin,
  submitAppleLoginCode,
} from "../src/services/apple-web-login";

const APPLE_APPS = "https://appstoreconnect.apple.com/apps";
const LOGIN_URL = "https://idmsa.apple.com/appleauth/auth/signin";

function stubField() {
  return {
    waitFor: async () => undefined,
    fill: async (_value: string) => undefined,
    click: async () => undefined,
  };
}

function stubPage(urls: string[], codeInputs: number, cookieHeader: string) {
  let urlIndex = 0;
  const filled: string[] = [];

  return {
    filled,
    goto: async (_url: string) => undefined,
    waitForTimeout: async (_ms: number) => {
      if (urlIndex < urls.length - 1) urlIndex += 1;
    },
    url: () => urls[urlIndex],
    locator: (_selector: string) => ({
      first: () => ({
        waitFor: async () => undefined,
        fill: async (value: string) => {
          filled.push(value);
        },
        click: async () => undefined,
      }),
      count: async () => codeInputs,
    }),
    cookies: async () => [{ name: "myacinfo", value: "x".repeat(200), domain: "appstoreconnect.apple.com" }],
    close: async () => undefined,
  };
}

function stubLauncher(page: any) {
  return {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => page,
        cookies: () => page.cookies(),
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
  };
}

async function waitForStage(id: string, stage: string, timeoutMs = 5000) {
  const start = Date.now();

  for (;;) {
    const state = getAppleLogin(id);

    if (state?.stage === stage) return state;

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for stage ${stage}, got ${state?.stage}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("apple web login", () => {
  it("completes immediately when the session is already warm", async () => {
    let stored = "";
    const page = stubPage([APPLE_APPS], 0, "");
    const started = await startAppleLogin("user@example.com", "secret", {
      launcher: stubLauncher(page) as any,
      onDone: (cookies) => {
        stored = cookies;
      },
    });
    const done = await waitForStage(started.id, "done");

    assert.equal(done.stage, "done");
    assert.ok(stored.includes("myacinfo="));
    await cancelAppleLogin(started.id);
  });

  it("asks for a 2FA code and completes with it", async () => {
    let stored = "";
    let releaseCode: (code: string) => void = () => undefined;
    const codeGate = new Promise<string>((resolve) => {
      releaseCode = resolve;
    });
    const page = stubPage([LOGIN_URL, LOGIN_URL, LOGIN_URL, LOGIN_URL, APPLE_APPS], 1, "");
    const started = await startAppleLogin("user@example.com", "secret", {
      launcher: stubLauncher(page) as any,
      onCode: () => codeGate,
      onDone: (cookies) => {
        stored = cookies;
      },
    });

    await waitForStage(started.id, "2fa");
    assert.deepEqual(page.filled.slice(0, 2), ["user@example.com", "secret"]);
    releaseCode("123 456");

    const done = await waitForStage(started.id, "done");

    assert.equal(done.stage, "done");
    assert.ok(stored.includes("myacinfo="));
    assert.ok(page.filled.includes("123456"));
    await cancelAppleLogin(started.id);
  });

  it("fails when the code is malformed", async () => {
    const page = stubPage([LOGIN_URL, LOGIN_URL, LOGIN_URL], 1, "");
    const started = await startAppleLogin("user@example.com", "secret", {
      launcher: stubLauncher(page) as any,
      onCode: async () => "12",
      onDone: () => undefined,
    });

    const failed = await waitForStage(started.id, "failed");

    assert.match(failed.message ?? "", /6 digits/);
    await cancelAppleLogin(started.id);
  });

  it("rejects blank credentials and concurrent logins", async () => {
    await assert.rejects(startAppleLogin("", "secret", { launcher: stubLauncher(stubPage([], 0, "")) as any }), /required/);

    const page = stubPage([LOGIN_URL], 0, "");
    const first = await startAppleLogin("user@example.com", "secret", {
      launcher: stubLauncher(page) as any,
      onDone: () => undefined,
    });

    await assert.rejects(
      startAppleLogin("other@example.com", "secret", { launcher: stubLauncher(page) as any }),
      /already running/,
    );
    await cancelAppleLogin(first.id);
  });

  it("delivers codes submitted through the pending queue", async () => {
    const page = stubPage([LOGIN_URL, LOGIN_URL, LOGIN_URL, LOGIN_URL, APPLE_APPS], 1, "");
    const started = await startAppleLogin("user@example.com", "secret", {
      launcher: stubLauncher(page) as any,
      onDone: () => undefined,
    });

    await waitForStage(started.id, "2fa");

    assert.equal(submitAppleLoginCode(started.id, "654321"), true);
    assert.equal(submitAppleLoginCode("missing", "654321"), false);

    await waitForStage(started.id, "done");
    await cancelAppleLogin(started.id);
  });
});
