import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireTeamAdmin, loadTeamSettings } from "../auth";
import { googleAdsOAuthAvailable, googleAdsOAuthRedirectUri } from "../../services/google-ads-oauth";
import { encrypt } from "../../config/encryption";
import { googleAdsGateway } from "../../services/google-ads";
import { adsResponseCache } from "./response-cache";
import { googleAdsKeyMissing } from "./google-ads-helpers";
import { googleAdsOAuthStartRouter, googleAdsOAuthCallbackRouter } from "./google-ads-oauth";
import { googleAdsCampaignsRouter } from "./google-ads-campaigns";
import { googleAdsAppleRevenueRouter } from "./google-ads-apple-revenue";
import { googleAdsNegativesRouter } from "./google-ads-negatives";

export { googleAdsOAuthCallbackRouter };

export const googleAdsRouter = Router();

googleAdsRouter.use(adsResponseCache());

googleAdsRouter.get("/status", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  res.json({
    connected: !googleAdsKeyMissing(s),
    customerId: s?.googleAdsCustomerId ?? null,
    connectedAt: s?.googleAdsConnectedAt?.toISOString() ?? null,
    oauthAvailable: googleAdsOAuthAvailable(),
    oauthRedirectUri: googleAdsOAuthRedirectUri(),
  });
});

googleAdsRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const { clientId, clientSecret, refreshToken, customerId } = req.body as Record<string, string>;

    if (!clientId || !clientSecret || !refreshToken || !customerId) {
      res.status(400).json({
        error: "clientId, clientSecret, refreshToken and customerId are all required",
      });

      return;
    }

    const normalizedCustomerId = String(customerId).replace(/-/g, "");

    if (!/^\d+$/.test(normalizedCustomerId)) {
      res.status(400).json({ error: "customerId must be the numeric Google Ads customer ID (dashes allowed)" });

      return;
    }

    try {
      const accessible = await googleAdsGateway({
        customerId: normalizedCustomerId,
        clientId,
        clientSecret,
        refreshToken,
      }).listAccessibleCustomers();

      if (!accessible.some((name) => name.endsWith(`/${normalizedCustomerId}`))) {
        res.status(400).json({ error: "That customer ID isn't accessible with these credentials." });

        return;
      }
    } catch (err: any) {
      logger.warn("[google-ads] credential verification failed", { err: String(err?.message ?? err) });
      res.status(400).json({ error: "Could not verify these credentials with Google Ads. Double-check them and try again." });

      return;
    }

    const connectedAt = new Date();

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        googleAdsClientId: clientId,
        googleAdsClientSecret: encrypt(clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: normalizedCustomerId,
        googleAdsConnectedAt: connectedAt,
      },
      update: {
        googleAdsClientId: clientId,
        googleAdsClientSecret: encrypt(clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: normalizedCustomerId,
        googleAdsConnectedAt: connectedAt,
      },
    });

    res.json({ ok: true, customerId: normalizedCustomerId, connectedAt: connectedAt.toISOString() });
  } catch (err: any) {
    logger.error("[google-ads] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

googleAdsRouter.post("/disconnect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    await prisma.teamSettings.updateMany({
      where: { teamId },
      data: {
        googleAdsClientId: null,
        googleAdsClientSecret: null,
        googleAdsRefreshToken: null,
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: null,
        googleAdsConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    logger.error("[google-ads] disconnect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

googleAdsRouter.use(googleAdsOAuthStartRouter);
googleAdsRouter.use(googleAdsCampaignsRouter);
googleAdsRouter.use(googleAdsAppleRevenueRouter);
googleAdsRouter.use(googleAdsNegativesRouter);
