import { Router } from "express";
import { prisma, logger, env } from "../../config";
import { requireTeamAdmin } from "../auth";
import { encrypt } from "../../config/encryption";
import {
  buildGoogleAdsAuthUrl,
  exchangeGoogleAdsCode,
  googleAdsOAuthAvailable,
  signGoogleAdsOAuthState,
  verifyGoogleAdsOAuthState,
} from "../../services/google-ads-oauth";
import { googleAdsGateway } from "../../services/google-ads";

export const googleAdsOAuthStartRouter = Router();

googleAdsOAuthStartRouter.post("/oauth/start", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    if (!googleAdsOAuthAvailable()) {
      res.status(500).json({ error: "Google Ads OAuth is not configured on this server" });

      return;
    }

    const { customerId } = req.body as Record<string, string>;

    if (!customerId) {
      res.status(400).json({ error: "customerId is required" });

      return;
    }

    const normalizedCustomerId = String(customerId).replace(/-/g, "");

    if (!/^\d+$/.test(normalizedCustomerId)) {
      res.status(400).json({ error: "customerId must be the numeric Google Ads customer ID (dashes allowed)" });

      return;
    }

    const state = signGoogleAdsOAuthState({
      teamId: req.user!.teamId!,
      userId: req.user!.userId!,
      customerId: normalizedCustomerId,
    });
    res.json({ url: buildGoogleAdsAuthUrl(state) });
  } catch (err: any) {
    logger.error("[google-ads] oauth start error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

export const googleAdsOAuthCallbackRouter = Router();

googleAdsOAuthCallbackRouter.get("/oauth/callback", async (req, res) => {
  const appUrl = env.APP_URL;
  const fail = (reason: string) =>
    res.redirect(`${appUrl}/integrations?googleAds=error&reason=${encodeURIComponent(reason)}`);

  try {
    if (req.query.error) return fail(String(req.query.error_description ?? req.query.error));
    const code = req.query.code as string | undefined;
    const stateRaw = req.query.state as string | undefined;
    if (!code || !stateRaw) return fail("missing_code_or_state");

    const parsed = verifyGoogleAdsOAuthState(stateRaw);
    if (!parsed) return fail("invalid_or_expired_state");

    const [oauthUser, oauthMember] = await Promise.all([
      prisma.user.findUnique({ where: { id: parsed.userId }, select: { role: true } }),
      prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: parsed.teamId, userId: parsed.userId } },
        select: { role: true },
      }),
    ]);

    const isAdmin =
      oauthUser?.role === "ADMIN" || oauthMember?.role === "OWNER" || oauthMember?.role === "ADMIN";

    if (!isAdmin) return fail("not_admin");

    const { refreshToken } = await exchangeGoogleAdsCode(code);

    const creds = {
      customerId: parsed.customerId,
      clientId: env.GOOGLE_ADS_OAUTH_CLIENT_ID!,
      clientSecret: env.GOOGLE_ADS_OAUTH_CLIENT_SECRET!,
      refreshToken,
    };
    try {
      const accessible = await googleAdsGateway(creds).listAccessibleCustomers();

      if (!accessible.some((name) => name.endsWith(`/${parsed.customerId}`))) {
        return fail("customer_not_accessible");
      }
    } catch {
      return fail("verification_failed");
    }

    const connectedAt = new Date();
    await prisma.teamSettings.upsert({
      where: { teamId: parsed.teamId },
      create: {
        teamId: parsed.teamId,
        googleAdsClientId: creds.clientId,
        googleAdsClientSecret: encrypt(creds.clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: parsed.customerId,
        googleAdsConnectedAt: connectedAt,
      },
      update: {
        googleAdsClientId: creds.clientId,
        googleAdsClientSecret: encrypt(creds.clientSecret),
        googleAdsRefreshToken: encrypt(refreshToken),
        googleAdsDeveloperToken: null,
        googleAdsCustomerId: parsed.customerId,
        googleAdsConnectedAt: connectedAt,
      },
    });

    logger.info("[google-ads] connected via OAuth", { teamId: parsed.teamId });
    res.redirect(`${appUrl}/integrations?googleAds=connected`);
  } catch (err: any) {
    logger.error("[google-ads] oauth callback error", { err: String(err?.message ?? err) });
    fail("callback_failed");
  }
});
