import type { Request } from "express";
import { prisma, logger } from "../../config";
import { memberAllowedApp } from "../auth";
import { decryptNullable } from "../../config/encryption";
import { AppleAdsCampaignNotFoundError, listTeamAppleAdsOrgs, resolveCampaignOrgId, type AppleAdsCredentials, type AppleAdsOrgCredentials } from "../../services/apple-ads";

export function appleAdsKeyMissing(s: any): boolean {
  return (
    !s?.appleAdsConnectedAt || !s.appleAdsClientId || !s.appleAdsTeamId || !s.appleAdsKeyId || !s.appleAdsPrivateKey
  );
}

export function appleAdsKeyCreds(s: any): AppleAdsOrgCredentials {
  return {
    clientId: s.appleAdsClientId,
    teamId: s.appleAdsTeamId,
    keyId: s.appleAdsKeyId,
    privateKey: decryptNullable(s.appleAdsPrivateKey)!,
  };
}

export async function orgCredsForCampaign(
  teamId: string,
  keyCreds: AppleAdsOrgCredentials,
  campaignId: string,
): Promise<AppleAdsCredentials> {
  const orgs = await listTeamAppleAdsOrgs(teamId);
  const orgId = await resolveCampaignOrgId(
    keyCreds,
    orgs.map((o) => o.orgId),
    campaignId,
  );

  return { ...keyCreds, orgId };
}

export function appleWriteErrorMessage(err: any): string {
  const data = err?.response?.data;
  const appleErr = data?.error;

  if (appleErr) {
    const details = Array.isArray(appleErr.errors)
      ? appleErr.errors.map((e: any) => e.message ?? e.messageCode ?? JSON.stringify(e)).join("; ")
      : (appleErr.message ?? JSON.stringify(appleErr));

    return `Apple Search Ads rejected the request: ${details}`;
  }

  return String(err?.message ?? err);
}

export function countryBreakdownError(res: any, err: any, logCtx: string) {
  if (err instanceof AppleAdsCampaignNotFoundError) {
    res.status(404).json({ error: err.message });

    return;
  }

  logger.error(logCtx, {
    err: String(err?.message ?? err),
    status: err?.response?.status,
    body: err?.response?.data,
  });

  const message = String(err?.message ?? "");

  if (message.includes("reports error")) {
    res.status(400).json({ error: message });

    return;
  }

  res.status(500).json({ error: "Failed to load country breakdown from Apple Search Ads" });
}

export async function accessibleRevenueApps(req: Request) {
  const apps = await prisma.app.findMany({
    where: { teamId: req.user!.teamId, revenueCatConnectedAt: { not: null } },
    select: { id: true, bundleId: true, displayName: true, name: true },
  });
  if (req.user!.role === "ADMIN") return apps;

  const checked = await Promise.all(
    apps.map(async (app) => ({
      app,
      allowed: await memberAllowedApp(req.user!.userId, req.user!.teamId, app.id),
    })),
  );

  return checked.filter(({ allowed }) => allowed).map(({ app }) => app);
}
