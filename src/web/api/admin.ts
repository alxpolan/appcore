import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma, logger } from "../../config";
import { requireAuth } from "../auth";
import { ADMIN_GRANT_CUSTOMER, PRO_STATUSES, isAdminGrant, isGrantExpired } from "../../services/pro-grants";
import { premiumGranted } from "../../services/notifications/templates";

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const router = Router();

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden: Admin access required" });
    return;
  }
  next();
}

router.use(requireAuth);
router.use(requireSuperAdmin);

type PrismaDelegate = {
  findMany: (args: any) => Promise<any[]>;
  count: (args?: any) => Promise<number>;
  findUnique: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
};

function getModel(name: string): PrismaDelegate | null {
  const models: Record<string, PrismaDelegate> = {
    user: prisma.user,
    team: prisma.team,
    teamMember: prisma.teamMember,
    teamInvite: prisma.teamInvite,
    teamSettings: prisma.teamSettings,
    app: prisma.app,
    appSnapshot: prisma.appSnapshot,
    keyword: prisma.keyword,
    keywordRanking: prisma.keywordRanking,
    asoSuggestion: prisma.aSOSuggestion,
    asoExperiment: prisma.asoExperiment,
    competitorRelation: prisma.competitorRelation,
    appStoreAnalytics: prisma.appStoreAnalytics,
    appReview: prisma.appReview,
    competitorReview: prisma.competitorReview,
    competitorReviewSummary: prisma.competitorReviewSummary,
    appMetadataChange: prisma.appMetadataChange,
    screenshotJob: prisma.screenshotJob,
    buildJob: prisma.buildJob,
    oauthClient: prisma.oAuthClient,
    deviceToken: prisma.deviceToken,
    pushNotificationLog: prisma.pushNotificationLog,
    passkeyCredential: prisma.passkeyCredential,
    ascRateLimit: prisma.ascRateLimit,
    subscription: prisma.subscription,
  };
  return models[name] ?? null;
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;

const detailIncludes: Record<string, any> = {
  user: {
    teamMembers: {
      include: {
        team: {
          include: {
            settings: true,
            subscription: true,
            members: { include: { user: { select: userSelect } } },
            apps: { select: { id: true, name: true, bundleId: true, isOwnApp: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    },
    passkeys: {
      select: { id: true, name: true, deviceType: true, createdAt: true, lastUsedAt: true },
    },
  },
  team: {
    settings: true,
    subscription: true,
    members: {
      include: { user: { select: userSelect } },
      orderBy: { createdAt: "asc" },
    },
    invites: { orderBy: { createdAt: "desc" } },
    apps: { select: { id: true, name: true, bundleId: true, isOwnApp: true, country: true } },
  },
  teamMember: {
    user: { select: userSelect },
    team: {
      include: {
        settings: true,
        members: { include: { user: { select: userSelect } } },
        apps: { select: { id: true, name: true, bundleId: true } },
      },
    },
  },
  teamSettings: {
    team: {
      include: {
        members: { include: { user: { select: userSelect } } },
        apps: { select: { id: true, name: true, bundleId: true } },
      },
    },
  },
  app: {
    team: {
      include: {
        settings: true,
        members: { include: { user: { select: userSelect } } },
      },
    },
  },
  subscription: {
    team: {
      include: {
        members: {
          include: { user: { select: userSelect } },
          orderBy: { createdAt: "asc" },
        },
        apps: { select: { id: true, name: true, bundleId: true } },
      },
    },
  },
};

const SECRET_KEYS = new Set([
  "passwordHash",
  "ascPrivateKey",
  "githubAccessToken",
  "githubWebhookSecret",
  "signingCertP12",
  "signingCertPassword",
  "signingProvisioningProfile",
  "signingProvisioningProfiles",
  "snapshotEnvVars",
  "reviewerDemoPassword",
  "clientSecret",
]);

function redactSecrets(value: any): any {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k)) {
        out[k] = v == null ? null : "•••••• (set)";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
}

const searchFields: Record<string, string[]> = {
  user: ["email", "name"],
  team: ["name"],
  teamMember: ["teamId", "userId"],
  teamInvite: ["email"],
  teamSettings: ["teamId"],
  app: ["bundleId", "name", "currentTitle"],
  appSnapshot: ["title", "subtitle", "developerName"],
  keyword: ["term"],
  keywordRanking: ["keywordId", "appId"],
  asoSuggestion: ["appBundleId", "aiProvider", "aiModel"],
  asoExperiment: ["appId"],
  competitorRelation: ["appId", "competitorId"],
  appStoreAnalytics: ["bundleId", "country"],
  appReview: ["bundleId", "title", "reviewerNickname"],
  competitorReview: ["appId", "title", "author"],
  competitorReviewSummary: ["appId", "sentiment"],
  appMetadataChange: ["appId", "field"],
  screenshotJob: ["appId", "commitSha", "branch"],
  buildJob: ["appId", "branch", "commitSha"],
  oauthClient: ["name", "clientId"],
  deviceToken: ["token", "userId", "bundleId"],
  pushNotificationLog: ["title", "deviceToken"],
  passkeyCredential: ["userId", "name"],
  subscription: ["teamId", "lemonSubscriptionId", "lemonCustomerId", "status"],
};

router.get("/dashboard", async (_req: Request, res: Response) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    users,
    teams,
    apps,
    keywords,
    suggestions,
    reviews,
    screenshotJobs,
    buildJobs,
    oauthClients,
    deviceTokens,
    analytics,
    recentUsers,
    recentApps,
    jobStatusCounts,
    suggestionTypeCounts,
    rateLimits,
    subscriptionTotal,
    subscriptionStatusCounts,
    subscriptionIntervalCounts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.team.count(),
    prisma.app.count(),
    prisma.keyword.count(),
    prisma.aSOSuggestion.count(),
    prisma.appReview.count(),
    prisma.screenshotJob.count(),
    prisma.buildJob.count(),
    prisma.oAuthClient.count(),
    prisma.deviceToken.count(),
    prisma.appStoreAnalytics.count(),
    prisma.$queryRaw<{ day: Date; count: number }[]>`
      SELECT DATE_TRUNC('day', "createdAt") as day, COUNT(*)::int as count
      FROM "User"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY day ORDER BY day ASC
    `,
    prisma.$queryRaw<{ day: Date; count: number }[]>`
      SELECT DATE_TRUNC('day', "createdAt") as day, COUNT(*)::int as count
      FROM "App"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY day ORDER BY day ASC
    `,
    prisma.$queryRaw<{ status: string; count: number }[]>`
      SELECT status::text, COUNT(*)::int as count FROM "ScreenshotJob" GROUP BY status
      UNION ALL
      SELECT CONCAT('build_', status::text), COUNT(*)::int FROM "BuildJob" GROUP BY status
    `,
    prisma.$queryRaw<{ type: string; count: number }[]>`
      SELECT type::text, COUNT(*)::int as count FROM "ASOSuggestion" GROUP BY type ORDER BY count DESC
    `,
    prisma.$queryRaw<{ teamId: string; teamName: string; hourLimit: number; hourRemaining: number; updatedAt: Date }[]>`
      SELECT r."teamId", COALESCE(t.name, r."teamId") as "teamName",
             r."hourLimit", r."hourRemaining", r."updatedAt"
      FROM "AscRateLimit" r
      LEFT JOIN "Team" t ON t.id = r."teamId"
      ORDER BY r."hourRemaining" ASC
    `,
    prisma.subscription.count(),
    prisma.$queryRaw<{ status: string; count: number }[]>`
      SELECT status, COUNT(*)::int as count FROM "Subscription" GROUP BY status ORDER BY count DESC
    `,
    prisma.$queryRaw<{ interval: string | null; count: number }[]>`
      SELECT interval, COUNT(*)::int as count
      FROM "Subscription"
      WHERE status IN ('active', 'on_trial', 'paused')
      GROUP BY interval
    `,
  ]);

  const activeSubscriptions = subscriptionStatusCounts
    .filter((r) => ["active", "on_trial", "paused"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.count), 0);
  const monthlyActive = Number(subscriptionIntervalCounts.find((r) => r.interval === "monthly")?.count ?? 0);
  const yearlyActive = Number(subscriptionIntervalCounts.find((r) => r.interval === "yearly")?.count ?? 0);
  const mrrEur = monthlyActive * 19 + yearlyActive * (190 / 12);

  const toChartData = (rows: { day: Date | string; count: number }[]) =>
    rows.map((r) => ({
      date: (r.day instanceof Date ? r.day : new Date(r.day as string)).toISOString().split("T")[0],
      count: Number(r.count),
    }));

  res.json({
    users,
    teams,
    apps,
    keywords,
    suggestions,
    reviews,
    screenshotJobs,
    buildJobs,
    oauthClients,
    deviceTokens,
    analytics,
    subscriptions: subscriptionTotal,
    activeSubscriptions,
    mrrEur: Math.round(mrrEur),
    subscriptionStatus: subscriptionStatusCounts.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    ascRateLimits: rateLimits.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      hourLimit: Number(r.hourLimit),
      hourRemaining: Number(r.hourRemaining),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    })),
    charts: {
      usersOverTime: toChartData(recentUsers),
      appsOverTime: toChartData(recentApps),
      jobStatus: jobStatusCounts.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      suggestionTypes: suggestionTypeCounts.map((r) => ({
        type: r.type,
        count: Number(r.count),
      })),
    },
  });
});

const VALID_QUEUES = [
  "scrape",
  "track-keywords",
  "sync-analytics",
  "extract-keywords",
  "discover-keywords",
  "discover-competitors",
  "analyze",
  "sync-metadata",
  "competitor-intel",
];

router.get("/boss/jobs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const queue = typeof req.query.queue === "string" ? req.query.queue : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    let sql = `
      SELECT id::text, name, state::text, data, output,
             retry_count, created_on, started_on, completed_on
      FROM pgboss.job
      WHERE name NOT LIKE '%/dispatch'
    `;
    const params: any[] = [];

    if (queue && VALID_QUEUES.includes(queue)) {
      params.push(queue);
      sql += ` AND name = $${params.length}`;
    }
    if (state) {
      params.push(state);
      sql += ` AND state::text = $${params.length}`;
    }
    sql += ` ORDER BY created_on DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    res.json(rows);
  } catch (err: any) {
    const code = err?.meta?.driverAdapterError?.cause?.originalCode;
    if (code === "42P01" || code === "3F000") return res.json([]);
    res.status(500).json({ error: "Failed to query pg-boss jobs" });
  }
});

router.get("/boss/queues", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; created_on: Date }[]>`
      SELECT name, created_on FROM pgboss.queue ORDER BY name ASC
    `;
    res.json(rows);
  } catch {
    res.json([]);
  }
});

router.get("/boss/schedules", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; cron: string; timezone: string; updated_on: Date }[]>`
      SELECT name, cron, timezone, updated_on FROM pgboss.schedule ORDER BY name ASC
    `;
    res.json(rows);
  } catch {
    res.json([]);
  }
});

router.get("/boss/stats", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; state: string; count: number }[]>`
      SELECT name, state::text, COUNT(*)::int as count
      FROM pgboss.job
      WHERE name NOT LIKE '%/dispatch'
      GROUP BY name, state
      ORDER BY name, state
    `;
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// --- Subscription / Pro-grant management -----------------------------------

router.get("/billing/overview", async (_req: Request, res: Response) => {
  const teams = await prisma.team.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      subscription: true,
      _count: { select: { members: true, apps: true } },
    },
  });

  const now = new Date();
  const rows = teams.map((t) => {
    const s = t.subscription;
    const grant = isAdminGrant(s);
    const expired = isGrantExpired(s, now);
    const effectiveStatus = expired ? "expired" : (s?.status ?? null);
    const isPro = !!effectiveStatus && (PRO_STATUSES as readonly string[]).includes(effectiveStatus);
    return {
      teamId: t.id,
      teamName: t.name,
      createdAt: t.createdAt,
      memberCount: t._count.members,
      appCount: t._count.apps,
      isPro,
      subscription: s
        ? {
            status: effectiveStatus,
            interval: s.interval,
            endsAt: s.endsAt,
            renewsAt: s.renewsAt,
            source: grant ? "admin" : "lemon",
            permanent: grant && !s.endsAt,
            cardBrand: s.cardBrand,
            cardLastFour: s.cardLastFour,
          }
        : null,
    };
  });

  res.json({
    summary: {
      totalTeams: rows.length,
      proTeams: rows.filter((r) => r.isPro).length,
      adminGrants: rows.filter((r) => r.subscription?.source === "admin" && r.isPro).length,
      paidTeams: rows.filter((r) => r.subscription?.source === "lemon" && r.isPro).length,
    },
    rows,
  });
});

router.post("/teams/:teamId/grant-pro", async (req: Request, res: Response) => {
  const { teamId } = req.params;
  const { forever, durationDays, interval } = (req.body ?? {}) as {
    forever?: boolean;
    durationDays?: number;
    interval?: string;
  };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      subscription: true,
      members: { where: { role: "OWNER" }, include: { user: true }, take: 1 },
    },
  });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const existing = team.subscription;
  if (existing && !isAdminGrant(existing)) {
    res.status(409).json({
      error: "Team has a real paid subscription. Manage it in Lemon Squeezy instead.",
    });
    return;
  }

  let endsAt: Date | null = null;
  if (!forever) {
    const days = Number(durationDays);
    if (!Number.isFinite(days) || days <= 0) {
      res.status(400).json({ error: "Provide a positive durationDays or set forever=true." });
      return;
    }
    // Extend from the current end date if the grant is still in the future.
    const base = existing?.endsAt && new Date(existing.endsAt) > new Date() ? new Date(existing.endsAt) : new Date();
    endsAt = new Date(base.getTime() + days * 86_400_000);
  }

  const intervalVal = interval === "monthly" ? "monthly" : "yearly";
  const data = {
    status: "active",
    interval: intervalVal,
    endsAt,
    renewsAt: endsAt,
    trialEndsAt: null,
    lemonCustomerId: ADMIN_GRANT_CUSTOMER,
    lemonOrderId: null,
    lemonProductId: null,
    lemonVariantId: null,
    cardBrand: null,
    cardLastFour: null,
    customerPortalUrl: null,
    updatePaymentMethodUrl: null,
  };

  const subscription = existing
    ? await prisma.subscription.update({ where: { teamId }, data })
    : await prisma.subscription.create({
        data: { teamId, lemonSubscriptionId: `admin_grant_${teamId}`, ...data },
      });

  const ownerEmail = team.members[0]?.user.email;
  if (ownerEmail) {
    premiumGranted({ to: ownerEmail, teamName: team.name, endsAt }).catch((err) =>
      logger.error("premium grant email failed", { err, teamId }),
    );
  }

  res.json({ ok: true, subscription });
});

router.post("/register-user", async (req: Request, res: Response) => {
  const { email, password, name, role, teamId, teamRole } = (req.body ?? {}) as {
    email?: string;
    password?: string;
    name?: string;
    role?: "USER" | "ADMIN";
    teamId?: string;
    teamRole?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  };

  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      res.status(404).json({ error: `Team not found: ${teamId}` });
      return;
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const displayName = name?.trim() || email.split("@")[0];

  const user = await prisma.user.create({
    data: {
      email,
      name: displayName,
      passwordHash,
      role: role ?? "USER",
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerifiedAt: true },
  });

  let team;
  if (teamId) {
    await prisma.teamMember.create({
      data: { teamId, userId: user.id, role: teamRole ?? "MEMBER" },
    });
    team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
  } else {
    team = await prisma.team.create({
      data: {
        name: `${displayName}'s Team`,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      select: { id: true, name: true },
    });
  }

  logger.info(`Admin register-user: ${user.email} (${user.id}) by ${req.user?.userId ?? "unknown"}`);
  res.status(201).json({ ok: true, user, team });
});

router.post("/teams/:teamId/revoke-pro", async (req: Request, res: Response) => {
  const { teamId } = req.params;
  const existing = await prisma.subscription.findUnique({ where: { teamId } });
  if (!existing) {
    res.status(404).json({ error: "Team has no subscription." });
    return;
  }
  if (!isAdminGrant(existing)) {
    res.status(409).json({
      error: "This is a real paid subscription. Cancel it in Lemon Squeezy instead.",
    });
    return;
  }
  await prisma.subscription.delete({ where: { teamId } });
  res.json({ ok: true });
});

router.get("/:model", async (req: Request, res: Response) => {
  const modelName = req.params.model as string;
  const delegate = getModel(modelName);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 25));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const skip = (page - 1) * pageSize;

  let where: any = {};
  if (search && searchFields[modelName]) {
    where = {
      OR: searchFields[modelName].map((field) => ({
        [field]: { contains: search, mode: "insensitive" },
      })),
    };
  }

  const [data, total] = await Promise.all([
    delegate
      .findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" } })
      .catch(() => delegate.findMany({ where, skip, take: pageSize })),
    delegate.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.get("/detail/:model/:id", async (req: Request, res: Response) => {
  const modelName = req.params.model as string;
  const delegate = getModel(modelName);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const include = detailIncludes[modelName];
  const record = await delegate.findUnique({
    where: { id: req.params.id as string },
    ...(include ? { include } : {}),
  });
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json(redactSecrets(record));
});

router.get("/:model/:id", async (req: Request, res: Response) => {
  const delegate = getModel(req.params.model as string);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const record = await delegate.findUnique({
    where: { id: req.params.id as string },
  });
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  res.json(record);
});

router.post("/:model", async (req: Request, res: Response) => {
  const delegate = getModel(req.params.model as string);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const record = await delegate.create({ data: req.body });
  res.status(201).json(record);
});

router.put("/:model/:id", async (req: Request, res: Response) => {
  const delegate = getModel(req.params.model as string);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  const record = await delegate.update({
    where: { id: req.params.id as string },
    data: req.body,
  });
  res.json(record);
});

router.delete("/:model/:id", async (req: Request, res: Response) => {
  const delegate = getModel(req.params.model as string);
  if (!delegate) {
    res.status(404).json({ error: "Model not found" });
    return;
  }

  await delegate.delete({ where: { id: req.params.id as string } });
  res.json({ ok: true });
});

export { router as adminRouter };
