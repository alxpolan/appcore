import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "../src/config/encryption";
import { parseProvisioningProfiles, resolveSigningCredentials } from "../src/services/utils/provisioning-profiles";

describe("resolveSigningCredentials", () => {
  it("returns null without any input", () => {
    assert.equal(resolveSigningCredentials(null), null);
    assert.equal(resolveSigningCredentials({}), null);
  });

  it("prefers the linked team certificate over legacy app fields", () => {
    const resolved = resolveSigningCredentials({
      signingCertP12: "legacy",
      signingCertPassword: "legacy-pass",
      signingTeamId: "LEGACYTEAM",
      signingCertificate: {
        name: "App Store 2026",
        certP12: "team-p12",
        certPassword: "team-pass",
        appleTeamId: "TEAMID1",
      },
    });

    assert.deepEqual(resolved, {
      certP12: "team-p12",
      certPassword: "team-pass",
      teamId: "TEAMID1",
      certificateName: "App Store 2026",
    });
  });

  it("falls back to legacy app credentials without a linked certificate", () => {
    const resolved = resolveSigningCredentials({
      signingCertP12: "legacy",
      signingCertPassword: "legacy-pass",
      signingTeamId: "LEGACYTEAM",
      signingCertificate: null,
    });

    assert.deepEqual(resolved, {
      certP12: "legacy",
      certPassword: "legacy-pass",
      teamId: "LEGACYTEAM",
    });
  });

  it("omits the team id when neither certificate nor legacy fields provide one", () => {
    const resolved = resolveSigningCredentials({
      signingCertP12: "legacy",
      signingCertPassword: "legacy-pass",
      signingCertificate: { name: "Cert", certP12: "p12", certPassword: "pw", appleTeamId: null },
    });

    assert.deepEqual(resolved, { certP12: "p12", certPassword: "pw", certificateName: "Cert" });
  });

  it("returns null when the certificate password is missing", () => {
    assert.equal(
      resolveSigningCredentials({
        signingCertificate: { name: "Cert", certP12: "p12", certPassword: "", appleTeamId: null },
      }),
      null,
    );
    assert.equal(
      resolveSigningCredentials({ signingCertP12: "legacy", signingCertPassword: "" }),
      null,
    );
  });
});

describe("resolveSigningCredentials with ENCRYPTION_KEY", () => {
  let previous: string | undefined;

  before(() => {
    previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "ab".repeat(32);
  });

  after(() => {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });

  it("decrypts a stored team certificate password", () => {
    const resolved = resolveSigningCredentials({
      signingCertificate: {
        name: "App Store 2026",
        certP12: "team-p12",
        certPassword: encrypt("s3cret"),
        appleTeamId: null,
      },
    });

    assert.deepEqual(resolved, { certP12: "team-p12", certPassword: "s3cret", certificateName: "App Store 2026" });
  });

  it("decrypts a stored legacy password", () => {
    const resolved = resolveSigningCredentials({
      signingCertP12: "legacy",
      signingCertPassword: encrypt("legacy-pass"),
    });

    assert.deepEqual(resolved, { certP12: "legacy", certPassword: "legacy-pass" });
  });

  it("still accepts legacy plaintext rows", () => {
    const resolved = resolveSigningCredentials({
      signingCertP12: "legacy",
      signingCertPassword: "plain-pass",
    });

    assert.deepEqual(resolved, { certP12: "legacy", certPassword: "plain-pass" });
  });
});

describe("parseProvisioningProfiles", () => {
  it("reads the JSON array form with legacy fallback", () => {
    assert.deepEqual(
      parseProvisioningProfiles({ signingProvisioningProfiles: JSON.stringify(["a", "b"]) }),
      ["a", "b"],
    );
    assert.deepEqual(parseProvisioningProfiles({ signingProvisioningProfile: "solo" }), ["solo"]);
    assert.deepEqual(parseProvisioningProfiles(null), []);
  });
});
