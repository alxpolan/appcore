import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, verifyAppOwnershipByBundleId } from "../auth";
import { encrypt } from "../../config/encryption";
import { listRevenueCatProjects } from "../../services/revenuecat";

export const revenueCatRouter = Router();
revenueCatRouter.use(requireAuth);

revenueCatRouter.get("/status", async (req, res) => {
  const bundleId = req.query.bundleId as string | undefined;
  if (!bundleId) {
    res.status(400).json({ error: "bundleId required" });
    return;
  }

  const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
  if (!app) return;

  res.json({
    connected: !!app.revenueCatConnectedAt,
    projectId: app.revenueCatProjectId ?? null,
    projectName: app.revenueCatProjectName ?? null,
    connectedAt: app.revenueCatConnectedAt?.toISOString() ?? null,
  });
});

revenueCatRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { apiKey, projectId, bundleId } = req.body as Record<string, string>;

    if (!bundleId) {
      res.status(400).json({ error: "bundleId required" });
      return;
    }
    const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
    if (!app) return;

    if (!apiKey) {
      res.status(400).json({ error: "apiKey is required" });
      return;
    }

    if (!apiKey.startsWith("sk_")) {
      res.status(400).json({
        error: "That doesn't look like a RevenueCat Secret API key. It should start with \"sk_\" — find it under Project settings → API keys.",
      });
      return;
    }

    let projects: { projectId: string; projectName: string }[];
    try {
      projects = await listRevenueCatProjects(apiKey);
    } catch (err: any) {
      logger.warn("[revenuecat] credential verification failed", {
        err: String(err?.message ?? err),
        status: err?.response?.status,
        body: err?.response?.data,
      });
      res.status(400).json({ error: "Could not verify this API key with RevenueCat. Double-check it and try again." });
      return;
    }

    let selected = projects.find((p) => p.projectId === projectId);
    if (!selected) {
      if (projectId) {
        res.status(400).json({ error: "That project isn't accessible with this API key." });
        return;
      }
      if (projects.length > 1) {
        res.json({ needsProjectSelection: true, projects });
        return;
      }
      selected = projects[0];
    }

    const connectedAt = new Date();
    await prisma.app.update({
      where: { bundleId },
      data: {
        revenueCatProjectId: selected.projectId,
        revenueCatProjectName: selected.projectName,
        revenueCatApiKey: encrypt(apiKey),
        revenueCatConnectedAt: connectedAt,
      },
    });

    res.json({ ok: true, projectId: selected.projectId, projectName: selected.projectName, connectedAt: connectedAt.toISOString() });
  } catch (err: any) {
    logger.error("[revenuecat] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

revenueCatRouter.post("/disconnect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;

    const { bundleId } = req.body as Record<string, string>;
    if (!bundleId) {
      res.status(400).json({ error: "bundleId required" });
      return;
    }
    const app = await verifyAppOwnershipByBundleId(req, res, bundleId);
    if (!app) return;

    await prisma.app.update({
      where: { bundleId },
      data: {
        revenueCatProjectId: null,
        revenueCatProjectName: null,
        revenueCatApiKey: null,
        revenueCatConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
