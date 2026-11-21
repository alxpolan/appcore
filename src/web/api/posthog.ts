import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings, bundleAccess } from "../auth";
import { encrypt } from "../../config/encryption";
import { listPostHogProjects, normalizePostHogHost } from "../../services/posthog";
import type { MilestoneDefinition } from "../../services/posthog-milestones";

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

postHogRouter.get("/milestones", bundleAccess("query", "bundleId"), async (req, res) => {
  const milestones = (req.bundleApp!.postHogMilestones as MilestoneDefinition[] | null) ?? [];

  res.json({ milestones });
});

postHogRouter.put("/milestones", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const { milestones } = req.body as { milestones: unknown };

    if (!Array.isArray(milestones)) {
      res.status(400).json({ error: "milestones must be an array" });

      return;
    }

    const cleaned: MilestoneDefinition[] = [];

    for (const entry of milestones as Record<string, unknown>[]) {
      const eventName = typeof entry?.eventName === "string" ? entry.eventName.trim() : "";
      const label = typeof entry?.label === "string" ? entry.label.trim() : "";
      const minCount = Number(entry?.minCount);

      if (!eventName || !label || !Number.isFinite(minCount) || minCount < 1) {
        res.status(400).json({ error: "Each milestone needs an event name, a label and a minimum count of at least 1" });

        return;
      }

      cleaned.push({ eventName, label, minCount: Math.trunc(minCount) });
    }

    await prisma.app.update({
      where: { id: ownApp.id },
      data: { postHogMilestones: cleaned as unknown as Prisma.InputJsonValue },
    });

    res.json({ ok: true, milestones: cleaned });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
