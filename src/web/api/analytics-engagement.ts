import { prisma, logger, getEffectiveSettingsForTeam } from "../../config";
import { requireBundleAccess } from "../auth";
import { AscAnalyticsService } from "../../services/asc-analytics";
import {
  getAnchorDate,
  majorIosVersion,
  resolveSince,
  resolveUntil,
  revenueCatGapStart,
  revenueCatGapWhere,
  trialPotentialCache,
  type RevenueCatDetail,
} from "./analytics-shared";
import { analyticsRouter } from "./analytics-reports";

analyticsRouter.get("/platforms", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);
    const dateFilter: Record<string, Date> = {};

    if (since) dateFilter.gte = since;
    if (until) dateFilter.lte = until;

    const rows = await prisma.appStoreAnalyticsPlatform.findMany({
      where: {
        bundleId,
        ...(Object.keys(dateFilter).length ? { reportDate: dateFilter } : {}),
      },
    });

    type VersionEntry = {
      iosVersion: string;
      impressions: number;
      pageViews: number;
      taps: number;
      sessions: number;
    };

    const byVersionMap: Record<string, VersionEntry> = {};

    for (const r of rows) {
      const iosVersion = majorIosVersion(r.platformVersion);
      const v = (byVersionMap[iosVersion] ??= {
        iosVersion,
        impressions: 0,
        pageViews: 0,
        taps: 0,
        sessions: 0,
      });

      v.impressions += r.impressions;
      v.pageViews += r.pageViews;
      v.taps += r.taps;
      v.sessions += r.sessions;
    }

    const byVersion = Object.values(byVersionMap).sort(
      (a, b) => b.impressions + b.sessions - (a.impressions + a.sessions),
    );

    res.json({ byVersion });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

analyticsRouter.get("/retention", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const maxDay = 30;

    const rows = await prisma.appStoreSessionCohort.findMany({
      where: { bundleId },
      select: { reportDate: true, downloadDate: true, sessions: true, totalDuration: true, uniqueDevices: true },
    });

    let totalSessions = 0;
    let totalDuration = 0;
    const activeAt: Record<string, Record<number, number>> = {};
    let latestDay = "";

    for (const r of rows) {
      totalSessions += r.sessions;
      totalDuration += r.totalDuration;
      if (!r.downloadDate) continue;
      const day = r.reportDate.toISOString().slice(0, 10);
      if (day > latestDay) latestDay = day;
      const offset = Math.round((Date.parse(day) - Date.parse(r.downloadDate)) / 86400000);
      if (offset < 0 || offset > maxDay) continue;
      const cohort = (activeAt[r.downloadDate] ??= {});

      cohort[offset] = (cohort[offset] ?? 0) + r.uniqueDevices;
    }

    const latestMs = latestDay ? Date.parse(latestDay) : 0;
    const curve: { day: number; retention: number; activeDevices: number; cohortDevices: number }[] = [];

    for (let day = 0; day <= maxDay; day++) {
      let active = 0;
      let cohortSize = 0;
      for (const [downloadDate, offsets] of Object.entries(activeAt)) {
        const day0 = offsets[0] ?? 0;
        if (day0 === 0) continue;
        if (Date.parse(downloadDate) + day * 86400000 > latestMs) continue;
        cohortSize += day0;
        active += offsets[day] ?? 0;
      }
      curve.push({
        day,
        retention: cohortSize > 0 ? (active / cohortSize) * 100 : 0,
        activeDevices: active,
        cohortDevices: cohortSize,
      });
    }

    const at = (day: number) => curve.find((c) => c.day === day);
    const hasData = (curve[0]?.cohortDevices ?? 0) > 0;

    res.json({
      curve: hasData ? curve : [],
      d1: at(1)?.retention ?? null,
      d7: at(7)?.retention ?? null,
      d30: at(30)?.retention ?? null,
      avgSessionSeconds: totalSessions > 0 ? totalDuration / totalSessions : null,
      totalSessions,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

analyticsRouter.get("/trial-potential", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const app = req.bundleApp!;

    if (!app.trackId) {
      res.json({ reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] });
      return;
    }

    const key = `${app.teamId ?? req.user!.teamId}:${app.bundleId}`;
    let cached = trialPotentialCache.get(key);

    if (!cached || cached.expiresAt < Date.now()) {
      const settings = await getEffectiveSettingsForTeam(app.teamId ?? req.user!.teamId);
      const value = new AscAnalyticsService(settings).fetchTrialPotential(String(app.trackId), app.bundleId);

      cached = { expiresAt: Date.now() + 30 * 60_000, value };
      trialPotentialCache.set(key, cached);
      value.then(
        (result) => {
          if (!result.reportDate || result.unpricedTrials > 0) trialPotentialCache.delete(key);
        },
        () => trialPotentialCache.delete(key),
      );
    }

    res.json(await cached.value);
  } catch (err) {
    logger.warn(`Trial potential lookup failed: ${String(err)}`);
    res.status(502).json({ error: "Trial data unavailable" });
  }
});

analyticsRouter.get("/purchases", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const rcGapStart = await revenueCatGapStart(bundleId);

    const rcSelect = {
      rcId: true,
      customerId: true,
      productId: true,
      store: true,
      environment: true,
      eventType: true,
      periodType: true,
      isTrialConversion: true,
      renewalNumber: true,
      transactionId: true,
      country: true,
      occurredAt: true,
      quantity: true,
      proceedsUsd: true,
      grossUsd: true,
    } as const;

    const rows = await prisma.appStoreCommercePurchase.findMany({
      where: { bundleId },
      orderBy: { reportDate: "desc" },
      take: limit,
      select: {
        reportDate: true,
        purchaseType: true,
        contentName: true,
        paymentMethod: true,
        territory: true,
        purchases: true,
        proceedsUsd: true,
        salesUsd: true,
        payingUsers: true,
      },
    });

    const oldestAscDate = rows.length ? rows[rows.length - 1].reportDate : rcGapStart;
    const rcRows = await prisma.revenueCatTransaction.findMany({
      where: { bundleId, occurredAt: { gte: oldestAscDate } },
      orderBy: { occurredAt: "desc" },
      take: Math.max(limit * 4, 2000),
      select: rcSelect,
    });

    type RcRow = (typeof rcRows)[number];

    const rcByDayCountry = new Map<string, RcRow[]>();
    for (const r of rcRows) {
      const key = `${r.occurredAt.toISOString().slice(0, 10)}|${(r.country ?? "").toUpperCase()}`;
      const bucket = rcByDayCountry.get(key);

      if (bucket) bucket.push(r);
      else rcByDayCountry.set(key, [r]);
    }

    function withinTolerance(a: number, b: number): boolean {
      return Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.15);
    }

    const matches = new Map<(typeof rows)[number], RcRow>();
    for (const r of rows) {
      const key = `${r.reportDate.toISOString().slice(0, 10)}|${r.territory.toUpperCase()}`;
      const bucket = rcByDayCountry.get(key);
      if (!bucket?.length) continue;
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < bucket.length; i++) {
        const diff = Math.abs(bucket[i].proceedsUsd - r.proceedsUsd);

        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && withinTolerance(bucket[bestIdx].proceedsUsd, r.proceedsUsd)) {
        matches.set(r, bucket.splice(bestIdx, 1)[0]);
      }
    }

    const subscriptionContentNames = new Set<string>();

    for (const [ascRow, rcRow] of matches) {
      if (rcRow.eventType !== "NON_RENEWING_PURCHASE") subscriptionContentNames.add(ascRow.contentName);
    }

    const standaloneRc: RcRow[] = [];
    for (const bucket of rcByDayCountry.values()) {
      for (const r of bucket) {
        if (r.store !== "app_store" || r.occurredAt >= rcGapStart) standaloneRc.push(r);
      }
    }

    const usedCustomerIds = new Set<string>();
    for (const r of matches.values()) usedCustomerIds.add(r.customerId);
    for (const r of standaloneRc) usedCustomerIds.add(r.customerId);

    const customers = usedCustomerIds.size
      ? await prisma.revenueCatCustomer.findMany({
          where: { bundleId, customerId: { in: [...usedCustomerIds] } },
          select: { customerId: true, platform: true, platformVersion: true, appVersion: true, country: true, attributes: true },
        })
      : [];

    const customerById = new Map(customers.map((c) => [c.customerId, c]));

    function toRcDetail(r: RcRow): RevenueCatDetail {
      const customer = customerById.get(r.customerId);

      return {
        id: r.rcId,
        customerId: r.customerId,
        productId: r.productId,
        store: r.store,
        environment: r.environment,
        eventType: r.eventType,
        periodType: r.periodType,
        isTrialConversion: r.isTrialConversion,
        renewalNumber: r.renewalNumber,
        transactionId: r.transactionId,
        country: r.country,
        proceedsUsd: r.proceedsUsd,
        grossUsd: r.grossUsd,
        customer: customer
          ? {
              platform: customer.platform,
              platformVersion: customer.platformVersion,
              appVersion: customer.appVersion,
              country: customer.country,
              attributes: (customer.attributes as Record<string, string | null> | null) ?? {},
            }
          : null,
      };
    }

    function transactionType(r: RcRow | null, contentName: string): string {
      if (!r) return subscriptionContentNames.has(contentName) ? "Subscription" : "One Time";
      if (r.eventType === "NON_RENEWING_PURCHASE") return "One Time";
      if (r.periodType === "TRIAL") return "Trial";
      if (r.eventType === "RENEWAL") return r.isTrialConversion ? "Trial Converted" : "Renewal";

      return "New Subscription";
    }

    const ascPurchases = rows.map((r) => {
      const match = matches.get(r) ?? null;

      return {
        date: r.reportDate.toISOString().slice(0, 10),
        source: "App Store Connect" as const,
        type: transactionType(match, r.contentName),
        contentName: r.contentName,
        paymentMethod: r.paymentMethod,
        territory: r.territory,
        purchases: r.purchases,
        proceedsUsd: r.proceedsUsd,
        salesUsd: r.salesUsd,
        payingUsers: r.payingUsers,
        revenueCat: match ? toRcDetail(match) : null,
      };
    });

    const rcStandalone = standaloneRc.map((r) => ({
      date: r.occurredAt.toISOString().slice(0, 10),
      source: "RevenueCat" as const,
      type: transactionType(r, ""),
      contentName: r.productId,
      paymentMethod: r.store,
      territory: r.country ?? "",
      purchases: r.quantity,
      proceedsUsd: r.proceedsUsd,
      salesUsd: r.grossUsd,
      payingUsers: 1,
      revenueCat: toRcDetail(r),
    }));

    const merged = [...ascPurchases, ...rcStandalone].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

analyticsRouter.get("/ltv", ...requireBundleAccess("query"), async (req, res) => {
  try {
    const bundleId = req.bundleApp!.bundleId;
    const anchor = await getAnchorDate(bundleId);
    const since = resolveSince(req.query, anchor);
    const until = resolveUntil(req.query);

    const rcGapStart = await revenueCatGapStart(bundleId);

    const [rows, purchaseRows, rcRows] = await Promise.all([
      prisma.appStoreAnalytics.findMany({
        where: { bundleId },
        orderBy: { reportDate: "asc" },
        select: { reportDate: true, downloads: true, proceeds: true },
      }),
      prisma.appStoreCommercePurchase.findMany({
        where: { bundleId },
        select: { reportDate: true, proceedsUsd: true },
      }),
      prisma.revenueCatTransaction.findMany({
        where: revenueCatGapWhere(bundleId, rcGapStart),
        select: { occurredAt: true, proceedsUsd: true },
      }),
    ]);

    const byDayMap: Record<string, { downloads: number; proceeds: number }> = {};
    for (const r of rows) {
      const key = r.reportDate.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });

      d.downloads += r.downloads;
      d.proceeds += r.proceeds;
    }
    for (const p of purchaseRows) {
      const key = p.reportDate.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });

      d.proceeds += p.proceedsUsd;
    }
    for (const r of rcRows) {
      const key = r.occurredAt.toISOString().slice(0, 10);
      const d = (byDayMap[key] ??= { downloads: 0, proceeds: 0 });

      d.proceeds += r.proceedsUsd;
    }

    const dates = Object.keys(byDayMap).sort();
    let cumulativeDownloads = 0;
    let cumulativeRevenue = 0;
    const series = dates.map((date) => {
      cumulativeDownloads += byDayMap[date].downloads;
      cumulativeRevenue += byDayMap[date].proceeds;

      return {
        date,
        cumulativeDownloads,
        cumulativeRevenue,
        ltv: cumulativeDownloads > 0 ? cumulativeRevenue / cumulativeDownloads : 0,
      };
    });

    const sinceKey = since ? since.toISOString().slice(0, 10) : null;
    const untilKey = until ? until.toISOString().slice(0, 10) : null;
    const byDay = series.filter((s) => (!sinceKey || s.date >= sinceKey) && (!untilKey || s.date <= untilKey));

    res.json({
      byDay,
      currentLtv: series.length ? series[series.length - 1].ltv : 0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
