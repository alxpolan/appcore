import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../config";
import { requireAuth } from "../auth";

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

export const adminRouter = Router();

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden: Admin access required" });
    return;
  }

  next();
}

adminRouter.use(requireAuth);
adminRouter.use(requireSuperAdmin);

adminRouter.get("/dashboard", async (_req: Request, res: Response) => {
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

adminRouter.get("/boss/jobs", async (req: Request, res: Response) => {
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

adminRouter.get("/boss/queues", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; created_on: Date }[]>`
      SELECT name, created_on FROM pgboss.queue ORDER BY name ASC
    `;

    res.json(rows);
  } catch {
    res.json([]);
  }
});

adminRouter.get("/boss/schedules", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<{ name: string; cron: string; timezone: string; updated_on: Date }[]>`
      SELECT name, cron, timezone, updated_on FROM pgboss.schedule ORDER BY name ASC
    `;

    res.json(rows);
  } catch {
    res.json([]);
  }
});

adminRouter.get("/boss/stats", async (_req: Request, res: Response) => {
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
