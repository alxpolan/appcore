/**
 * Apps with extensions (widgets, share sheets, app clips) need one provisioning profile
 * per bundle ID, so profiles are stored as a JSON array in `signingProvisioningProfiles`.
 * `signingProvisioningProfile` is the legacy single-profile column and is still read so
 * apps saved before the change keep building.
 */
export function parseProvisioningProfiles(
  app: { signingProvisioningProfiles?: string | null; signingProvisioningProfile?: string | null } | null,
): string[] {
  if (!app) return [];

  if (app.signingProvisioningProfiles) {
    try {
      const parsed = JSON.parse(app.signingProvisioningProfiles);
      if (Array.isArray(parsed)) {
        const profiles = parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
        if (profiles.length > 0) return profiles;
      }
    } catch {
      // Corrupt JSON must not take the build down when the legacy column still has a
      // usable profile, so fall through instead of throwing.
    }
  }

  return app.signingProvisioningProfile ? [app.signingProvisioningProfile] : [];
}
