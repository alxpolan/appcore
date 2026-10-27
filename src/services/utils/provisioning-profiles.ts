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
