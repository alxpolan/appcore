import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import { requireAuth, requireTeamAdmin, loadTeamSettings, bundleAccess } from "../auth";
import { decryptNullable, encrypt } from "../../config/encryption";
import { listPostHogProjects, normalizePostHogHost } from "../../services/posthog";
import { computeMilestoneCompletions, type MilestoneDefinition, type MilestoneVariant } from "../../services/posthog-milestones";
import {
  buildUserOutcomes,
  computePaywallTiming,
  MATURITY_DAYS,
  MAX_USERS,
  summarizeBuckets,
} from "../../services/paywall-timing";

export const postHogRouter = Router();

postHogRouter.use(requireAuth);

const UNKNOWN_FILTER_VALUE = "__unknown";

interface AudienceFilters {
  country?: string;
  platform?: string;
  appVersion?: string;
}

function parseAudienceFilters(q: Record<string, string | undefined>): AudienceFilters {
  return {
    country: typeof q.country === "string" && q.country ? q.country : undefined,
    platform: typeof q.platform === "string" && q.platform ? q.platform : undefined,
    appVersion: typeof q.appVersion === "string" && q.appVersion ? q.appVersion : undefined,
  };
}

function resolveDateRange(
  q: Record<string, string | undefined>,
  now: Date,
): { since: Date | null; until: Date | null; error?: undefined } | { since?: undefined; until?: undefined; error: string } {
  let since: Date | null = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let until: Date | null = null;

  if (typeof q.days === "string" && /^\d+$/.test(q.days)) {
    since = new Date(now.getTime() - parseInt(q.days, 10) * 24 * 60 * 60 * 1000);
  } else if (q.period === "all") {
    since = null;
  } else if (q.period === "ytd") {
    since = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else if (q.startDate) {
    const parsed = new Date(`${q.startDate}T00:00:00Z`);

    if (Number.isNaN(parsed.getTime())) {
      return { error: "Invalid startDate, expected YYYY-MM-DD" };
    }

    since = parsed;

    if (q.endDate) {
      const parsedEnd = new Date(`${q.endDate}T00:00:00Z`);

      if (Number.isNaN(parsedEnd.getTime())) {
        return { error: "Invalid endDate, expected YYYY-MM-DD" };
      }

      until = new Date(parsedEnd.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return { since, until };
}

function buildFilterOptions(customers: { country: string | null; platform: string | null; appVersion: string | null }[]) {
  const countryCounts = new Map<string, number>();
  const platformCounts = new Map<string, number>();
  const appVersionCounts = new Map<string, number>();

  for (const c of customers) {
    const country = c.country ?? UNKNOWN_FILTER_VALUE;
    const platform = c.platform ?? UNKNOWN_FILTER_VALUE;
    const appVersion = c.appVersion ?? UNKNOWN_FILTER_VALUE;

    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    appVersionCounts.set(appVersion, (appVersionCounts.get(appVersion) ?? 0) + 1);
  }

  const toSortedOptions = (counts: Map<string, number>) =>
    [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  return {
    countries: toSortedOptions(countryCounts),
    platforms: toSortedOptions(platformCounts),
    appVersions: toSortedOptions(appVersionCounts),
  };
}

function matchesAudienceFilters(
  customer: { country: string | null; platform: string | null; appVersion: string | null },
  filters: AudienceFilters,
): boolean {
  return (
    (!filters.country || (customer.country ?? UNKNOWN_FILTER_VALUE) === filters.country) &&
    (!filters.platform || (customer.platform ?? UNKNOWN_FILTER_VALUE) === filters.platform) &&
    (!filters.appVersion || (customer.appVersion ?? UNKNOWN_FILTER_VALUE) === filters.appVersion)
  );
}

async function loadAudience(bundleId: string, since: Date | null, until: Date | null, filters: AudienceFilters) {
  const customers = await prisma.revenueCatCustomer.findMany({
    where: {
      bundleId,
      ...(since ? { firstSeenAt: { gte: since, ...(until ? { lt: until } : {}) } } : {}),
    },
    orderBy: { firstSeenAt: "desc" },
    take: MAX_USERS + 1,
    select: { customerId: true, country: true, platform: true, appVersion: true },
  });

  const capped = customers.length > MAX_USERS;
  const scoped = customers.slice(0, MAX_USERS);
  const filterOptions = buildFilterOptions(scoped);
  const distinctIds = [...new Set(scoped.filter((c) => matchesAudienceFilters(c, filters)).map((c) => c.customerId))];

  return { distinctIds, filterOptions, capped };
}

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

    const q = req.query as Record<string, string | undefined>;
    const range = resolveDateRange(q, new Date());

    if (range.error) {
      res.status(400).json({ error: range.error });

      return;
    }

    const anchorEvent = typeof q.anchorEvent === "string" && q.anchorEvent.length > 0 ? q.anchorEvent : "$first_event";
    const maturityDaysRaw = typeof q.maturityDays === "string" ? parseInt(q.maturityDays, 10) : NaN;
    const maturityDays = Number.isFinite(maturityDaysRaw)
      ? Math.min(365, Math.max(1, maturityDaysRaw))
      : MATURITY_DAYS;

    const { distinctIds, filterOptions, capped } = await loadAudience(
      bundleId,
      range.since,
      range.until,
      parseAudienceFilters(q),
    );

    const timings = await computePaywallTiming(s.posthogHost, apiKey, s.posthogProjectId, distinctIds, anchorEvent);
    const anchorByUser = new Map(
      timings.filter((t) => t.anchorAt != null).map((t) => [t.distinctId, t.anchorAt as Date] as const),
    );
    const excludedNoAnchor = timings.filter((t) => t.anchorAt == null).length;
    const excludedNoActivity = Math.max(0, distinctIds.length - timings.length);
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

    const buckets = summarizeBuckets(
      buildUserOutcomes(anchorByUser, paywallByUser, txByUser),
      new Date(),
      maturityDays,
    );

    res.json({
      ok: true,
      buckets,
      totalUsers: anchorByUser.size,
      excludedNoAnchor,
      excludedNoActivity,
      capped,
      maturityDays,
      anchorEvent,
      filterOptions,
    });
  } catch (err) {
    logger.error("[posthog] paywall timing failed", { err: String((err as Error)?.message ?? err) });
    res.status(500).json({ error: "Failed to compute paywall timing" });
  }
});

postHogRouter.get("/engagement", loadTeamSettings, bundleAccess("query", "bundleId"), async (req, res) => {
  const s = req.teamSettings;
  const app = req.bundleApp!;

  if (!s?.posthogConnectedAt || !s.posthogHost || !s.posthogApiKey || !s.posthogProjectId) {
    res.json({ available: false, reason: "no-posthog", totalUsers: 0, milestones: [], variants: [] });

    return;
  }

  if (!app.revenueCatConnectedAt) {
    res.json({ available: false, reason: "no-revenuecat", totalUsers: 0, milestones: [], variants: [] });

    return;
  }

  const milestoneDefs = (app.postHogMilestones as MilestoneDefinition[] | null) ?? [];

  if (milestoneDefs.length === 0) {
    res.json({ available: true, reason: "no-milestones", totalUsers: 0, milestones: [], variants: [] });

    return;
  }

  try {
    const apiKey = decryptNullable(s.posthogApiKey);

    if (!apiKey) {
      res.status(400).json({ error: "PostHog API key unavailable" });

      return;
    }

    const q = req.query as Record<string, string | undefined>;
    const range = resolveDateRange(q, new Date());

    if (range.error) {
      res.status(400).json({ error: range.error });

      return;
    }

    const { distinctIds, filterOptions, capped } = await loadAudience(
      app.bundleId,
      range.since,
      range.until,
      parseAudienceFilters(q),
    );

    if (distinctIds.length === 0) {
      res.json({
        available: true,
        totalUsers: 0,
        filterOptions,
        milestones: milestoneDefs.map((m) => ({ ...m, completed: 0 })),
        variants: [],
        capped,
      });

      return;
    }

    const variantDefs = (app.postHogMilestoneVariants as MilestoneVariant[] | null) ?? [];
    const { milestones, variants } = await computeMilestoneCompletions(
      s.posthogHost,
      apiKey,
      s.posthogProjectId,
      distinctIds,
      milestoneDefs,
      variantDefs,
    );

    res.json({ available: true, totalUsers: distinctIds.length, filterOptions, milestones, variants, capped });
  } catch (err) {
    logger.error("[posthog] engagement failed", { err: String((err as Error)?.message ?? err) });
    res.status(500).json({ error: "Failed to compute engagement" });
  }
});
