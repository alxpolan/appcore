import { Router } from "express";
import { prisma, env, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings } from "../auth";
import { encrypt } from "../../config/encryption";
import { bossScheduler } from "../../jobs/boss";
import { QUEUE_NAME as ASC_MAILBOX_QUEUE } from "../../jobs/workers/asc-mailbox.worker";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", loadTeamSettings, async (req, res) => {
  try {
    const s = req.teamSettings;
    const isDemo = req.user?.isDemo || req.user?.email === "demo@marteso.com";

    res.json({
      ascIssuerId: isDemo ? (s?.ascIssuerId ? "••••••••" : "") : (s?.ascIssuerId ?? ""),
      ascKeyId: isDemo ? (s?.ascKeyId ? "••••••••" : "") : (s?.ascKeyId ?? ""),
      ascPrivateKey: s?.ascPrivateKey ? "••••••••" : "",
      ascPrivateKeySet: !!s?.ascPrivateKey,
      ascVendorNumber: isDemo ? (s?.ascVendorNumber ? "••••••••" : "") : (s?.ascVendorNumber ?? ""),
      ascAccountConnectRequestedAt: s?.ascAccountConnectRequestedAt?.toISOString() ?? null,
      presetCopyright: s?.presetCopyright ?? "",
      reviewerFirstName: s?.reviewerFirstName ?? "",
      reviewerLastName: s?.reviewerLastName ?? "",
      reviewerPhone: s?.reviewerPhone ?? "",
      reviewerEmail: s?.reviewerEmail ?? "",
      reviewerDemoAccountRequired: s?.reviewerDemoAccountRequired ?? false,
      reviewerDemoUsername: s?.reviewerDemoUsername ?? "",
      reviewerDemoPassword: s?.reviewerDemoPassword ?? "",
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

settingsRouter.put("/", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId;

    const {
      ascIssuerId,
      ascKeyId,
      ascPrivateKey,
      ascVendorNumber,
      presetCopyright,
      reviewerFirstName,
      reviewerLastName,
      reviewerPhone,
      reviewerEmail,
      reviewerDemoAccountRequired,
      reviewerDemoUsername,
      reviewerDemoPassword,
    } = req.body as Record<string, any>;

    const data: Record<string, any> = {};
    if (ascIssuerId !== undefined) data.ascIssuerId = ascIssuerId || null;
    if (ascKeyId !== undefined) data.ascKeyId = ascKeyId || null;
    if (ascPrivateKey !== undefined && ascPrivateKey !== "••••••••")
      data.ascPrivateKey = ascPrivateKey ? encrypt(ascPrivateKey) : null;
    if (ascVendorNumber !== undefined) data.ascVendorNumber = ascVendorNumber || null;
    if (presetCopyright !== undefined) data.presetCopyright = presetCopyright || null;
    if (reviewerFirstName !== undefined) data.reviewerFirstName = reviewerFirstName || null;
    if (reviewerLastName !== undefined) data.reviewerLastName = reviewerLastName || null;
    if (reviewerPhone !== undefined) data.reviewerPhone = reviewerPhone || null;
    if (reviewerEmail !== undefined) data.reviewerEmail = reviewerEmail || null;
    if (reviewerDemoAccountRequired !== undefined) data.reviewerDemoAccountRequired = !!reviewerDemoAccountRequired;
    if (reviewerDemoUsername !== undefined) data.reviewerDemoUsername = reviewerDemoUsername || null;
    if (reviewerDemoPassword !== undefined) data.reviewerDemoPassword = reviewerDemoPassword || null;

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: { teamId, ...data },
      update: data,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

settingsRouter.post("/asc-account-connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;
    const requestedAt = new Date();

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: { teamId, ascAccountConnectRequestedAt: requestedAt },
      update: { ascAccountConnectRequestedAt: requestedAt },
    });

    if (env.ASC_MAILBOX_IMAP_HOST) {
      bossScheduler
        .sendJob(ASC_MAILBOX_QUEUE, {})
        .catch((err) => logger.error("[settings] Failed to enqueue immediate asc-mailbox check", { err }));
    }

    res.json({ ok: true, ascAccountConnectRequestedAt: requestedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
