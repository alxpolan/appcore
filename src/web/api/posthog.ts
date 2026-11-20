import { Router } from "express";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings } from "../auth";
import { encrypt } from "../../config/encryption";
import { listPostHogProjects, normalizePostHogHost } from "../../services/posthog";

export const postHogRouter = Router();

postHogRouter.use(requireAuth);

postHogRouter.get("/status", loadTeamSettings, async (req, res) => {
  const s = req.teamSettings;

  res.json({
    connected: !!s?.posthogConnectedAt,
    host: s?.posthogHost ?? null,
    organizationName: s?.posthogOrganizationName ?? null,
    projectId: s?.posthogProjectId ?? null,
    projectName: s?.posthogProjectName ?? null,
    connectedAt: s?.posthogConnectedAt?.toISOString() ?? null,
  });
});

postHogRouter.post("/connect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    const { apiKey, host, projectId } = req.body as Record<string, string>;

    if (!apiKey || !host) {
      res.status(400).json({ error: "host and apiKey are required" });

      return;
    }

    let normalizedHost: string;
    try {
      normalizedHost = normalizePostHogHost(host);
    } catch (err: any) {
      res.status(400).json({ error: err.message });

      return;
    }

    let projects: { projectId: string; projectName: string; organizationName: string }[];
    try {
      projects = await listPostHogProjects(normalizedHost, apiKey);
    } catch (err: any) {
      logger.warn("[posthog] credential verification failed", {
        err: String(err?.message ?? err),
        status: err?.response?.status,
        body: err?.response?.data,
      });
      res.status(400).json({ error: "Could not verify this API key with PostHog. Double-check the host and key and try again." });

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

    await prisma.teamSettings.upsert({
      where: { teamId },
      create: {
        teamId,
        posthogHost: normalizedHost,
        posthogApiKey: encrypt(apiKey),
        posthogOrganizationName: selected.organizationName,
        posthogProjectId: selected.projectId,
        posthogProjectName: selected.projectName,
        posthogConnectedAt: connectedAt,
      },
      update: {
        posthogHost: normalizedHost,
        posthogApiKey: encrypt(apiKey),
        posthogOrganizationName: selected.organizationName,
        posthogProjectId: selected.projectId,
        posthogProjectName: selected.projectName,
        posthogConnectedAt: connectedAt,
      },
    });

    res.json({
      ok: true,
      projectId: selected.projectId,
      projectName: selected.projectName,
      connectedAt: connectedAt.toISOString(),
    });
  } catch (err: any) {
    logger.error("[posthog] connect error", { err: String(err?.message ?? err) });
    res.status(500).json({ error: err.message });
  }
});

postHogRouter.post("/disconnect", async (req, res) => {
  try {
    if (!(await requireTeamAdmin(req, res))) return;
    const teamId = req.user!.teamId!;

    await prisma.teamSettings.updateMany({
      where: { teamId },
      data: {
        posthogHost: null,
        posthogApiKey: null,
        posthogOrganizationName: null,
        posthogProjectId: null,
        posthogProjectName: null,
        posthogConnectedAt: null,
      },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
