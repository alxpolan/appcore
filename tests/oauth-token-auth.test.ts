import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { isTokenClientAuthenticated } from "../src/web/api/oauth";

describe("oauth token client authentication", () => {
  it("accepts public clients without a secret", async () => {
    const authenticated = await isTokenClientAuthenticated(
      { clientSecret: "$2b$10$irrelevant", tokenEndpointAuthMethod: "none" },
      undefined,
    );

    assert.equal(authenticated, true);
  });

  it("rejects a missing secret instead of throwing", async () => {
    const hash = await bcrypt.hash("s3cr3t", 10);
    const authenticated = await isTokenClientAuthenticated(
      { clientSecret: hash, tokenEndpointAuthMethod: "client_secret_post" },
      undefined,
    );

    assert.equal(authenticated, false);
  });

  it("accepts a matching secret", async () => {
    const hash = await bcrypt.hash("s3cr3t", 10);
    const authenticated = await isTokenClientAuthenticated(
      { clientSecret: hash, tokenEndpointAuthMethod: "client_secret_post" },
      "s3cr3t",
    );

    assert.equal(authenticated, true);
  });

  it("rejects a wrong secret", async () => {
    const hash = await bcrypt.hash("s3cr3t", 10);
    const authenticated = await isTokenClientAuthenticated(
      { clientSecret: hash, tokenEndpointAuthMethod: "client_secret_basic" },
      "wrong",
    );

    assert.equal(authenticated, false);
  });
});
