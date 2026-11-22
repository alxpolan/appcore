import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings, bundleAccess } from "../auth";
import { decryptNullable, encrypt } from "../../config/encryption";
import { listPostHogProjects, normalizePostHogHost } from "../../services/posthog";
import type { MilestoneDefinition, MilestoneVariant } from "../../services/posthog-milestones";
import {
  buildUserOutcomes,
  computePaywallTiming,
  MATURITY_DAYS,
  MAX_USERS,
  summarizeBuckets,
} from "../../services/paywall-timing";

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
  const variants = (req.bundleApp!.postHogMilestoneVariants as MilestoneVariant[] | null) ?? [];

  res.json({ milestones, variants });
});

postHogRouter.put("/milestones", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const { milestones, variants } = req.body as { milestones: unknown; variants?: unknown };

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

    const cleanedVariants: MilestoneVariant[] = [];

    if (variants !== undefined) {
      if (!Array.isArray(variants)) {
        res.status(400).json({ error: "variants must be an array" });

        return;
      }

      for (const entry of variants as Record<string, unknown>[]) {
        const label = typeof entry?.label === "string" ? entry.label.trim() : "";
        const flagKey = typeof entry?.flagKey === "string" ? entry.flagKey.trim() : "";
        const flagValue = typeof entry?.flagValue === "string" ? entry.flagValue.trim() : "";

        if (!label || !flagKey || !flagValue) {
          res.status(400).json({ error: "Each variant needs a label, a flag key and a flag value" });

          return;
        }

        cleanedVariants.push({ key: `${flagKey}::${flagValue}`, label, flagKey, flagValue });
      }

      await prisma.app.update({
        where: { id: ownApp.id },
        data: {
          postHogMilestones: cleaned as unknown as Prisma.InputJsonValue,
          postHogMilestoneVariants: cleanedVariants as unknown as Prisma.InputJsonValue,
        },
      });

      res.json({ ok: true, milestones: cleaned, variants: cleanedVariants });

      return;
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

postHogRouter.get("/paywall-timing", loadTeamSettings, bundleAccess("query", "bundleId"), async (req, res) => {
  const s = req.teamSettings;

  if (!s?.posthogConnectedAt || !s.posthogHost || !s.posthogApiKey || !s.posthogProjectId) {
    res.status(400).json({ error: "PostHog is not connected" });

    return;
  }

  try {
    const bundleId = req.bundleApp!.bundleId;
    const apiKey = decryptNullable(s.posthogApiKey);

    if (!apiKey) {
      res.status(400).json({ error: "PostHog API key unavailable" });

      return;
    }

    const customers = await prisma.revenueCatCustomer.findMany({
      where: { bundleId },
      orderBy: { firstSeenAt: "desc" },
      take: MAX_USERS + 1,
      select: { customerId: true },
    });

    const distinctIds = [...new Set(customers.map((c) => c.customerId))].slice(0, MAX_USERS);
    const capped = customers.length > MAX_USERS;

    const timings = await computePaywallTiming(s.posthogHost, apiKey, s.posthogProjectId, distinctIds);
    const seenByUser = new Map(timings.map((t) => [t.distinctId, t.firstSeen] as const));
    const paywallByUser = new Map(timings.map((t) => [t.distinctId, t.firstPaywall] as const));

    const transactions = await prisma.revenueCatTransaction.findMany({
      where: { bundleId, customerId: { in: distinctIds } },
      select: {
        customerId: true,
        eventType: true,
        periodType: true,
        proceedsUsd: true,
        isTrialConversion: true,
        occurredAt: true,
      },
    });
    const txByUser = new Map<string, typeof transactions>();

    for (const tx of transactions) {
      const list = txByUser.get(tx.customerId) ?? [];

      list.push(tx);
      txByUser.set(tx.customerId, list);
    }

    const buckets = summarizeBuckets(buildUserOutcomes(seenByUser, paywallByUser, txByUser));

    res.json({ ok: true, buckets, totalUsers: distinctIds.length, capped, maturityDays: MATURITY_DAYS });
  } catch (err) {
    logger.error("[posthog] paywall timing failed", { err: String((err as Error)?.message ?? err) });
    res.status(500).json({ error: "Failed to compute paywall timing" });
  }
});
