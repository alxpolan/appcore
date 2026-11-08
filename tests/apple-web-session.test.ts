import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __testResetSession,
  checkAppleSession,
  getAppleSessionCookies,
  updateEnvText,
} from "../src/services/apple-web-session";

describe("apple web session store", () => {
  it("updates existing cookie lines and appends missing ones", () => {
    assert.equal(updateEnvText("A=1\nASC_ANALYTICS_COOKIES=old\nB=2", "new"), "A=1\nASC_ANALYTICS_COOKIES=new\nB=2");
    assert.equal(updateEnvText("A=1", "new"), "A=1\nASC_ANALYTICS_COOKIES=new");
  });

  it("prefers the in-memory override over the environment", async () => {
    const saved = process.env.ASC_ANALYTICS_COOKIES;

    try {
      __testResetSession();
      process.env.ASC_ANALYTICS_COOKIES = "env-cookies";
      assert.equal(getAppleSessionCookies(), "env-cookies");

      delete process.env.ASC_ANALYTICS_COOKIES;

      const status = await checkAppleSession();

      assert.deepEqual(status, { configured: false, valid: false, checkedAt: null, reason: "not configured" });
    } finally {
      if (saved === undefined) delete process.env.ASC_ANALYTICS_COOKIES;
      else process.env.ASC_ANALYTICS_COOKIES = saved;

      __testResetSession();
    }
  });
});
