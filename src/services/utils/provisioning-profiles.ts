import { decrypt, decryptNullable } from "../../config/encryption";

function lenientProfileList(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
}

export interface SigningInputs {
  signingCertP12?: string | null;
  signingCertPassword?: string | null;
  signingTeamId?: string | null;
  signingCertificate?: {
    certP12: string;
    certPassword: string;
    appleTeamId?: string | null;
    name: string;
  } | null;
}

export interface ResolvedSigning {
  certP12: string;
  certPassword: string;
  teamId?: string;
  certificateName?: string;
}

export function resolveSigningCredentials(inputs: SigningInputs | null): ResolvedSigning | null {
  if (!inputs) return null;

  if (inputs.signingCertificate) {
    const cert = inputs.signingCertificate;
    const certPassword = decrypt(cert.certPassword);

    if (!cert.certP12 || !certPassword) return null;

    const resolved: ResolvedSigning = {
      certP12: cert.certP12,
      certPassword,
      certificateName: cert.name,
    };

    if (cert.appleTeamId) resolved.teamId = cert.appleTeamId;

    return resolved;
  }

  const legacyPassword = decryptNullable(inputs.signingCertPassword);

  if (!inputs.signingCertP12 || !legacyPassword) return null;

  const resolved: ResolvedSigning = {
    certP12: inputs.signingCertP12,
    certPassword: legacyPassword,
  };

  if (inputs.signingTeamId) resolved.teamId = inputs.signingTeamId;

  return resolved;
}

export function parseProvisioningProfiles(
  app: { signingProvisioningProfiles?: string | null; signingProvisioningProfile?: string | null } | null,
): string[] {
  if (!app) return [];

  if (app.signingProvisioningProfiles) {
    const profiles = lenientProfileList(app.signingProvisioningProfiles);
    if (profiles.length > 0) return profiles;
  }

  return app.signingProvisioningProfile ? [app.signingProvisioningProfile] : [];
}
