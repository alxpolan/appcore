import { Router } from "express";
import { prisma } from "../../config";
import { appAccess } from "../auth";
import { ensureAccentColor } from "../../services/utils/icon-accent";
import { AppStoreScraper } from "../../services/appstore-scraper";

export const appsRouter = Router();

appsRouter.get("/", async (req, res) => {
  try {
    const bundleId = req.query.bundleId as string | undefined;
    const ownOnly = req.query.ownOnly === "true";
    const isAdmin = req.user!.role === "ADMIN";
    const teamId = req.user!.teamId;
    let whereClause: any = {};

    if (bundleId) {
      const activeApp = await prisma.app.findUnique({ where: { bundleId } });

      if (activeApp) {
        if (!isAdmin && activeApp.teamId && activeApp.teamId !== teamId) {
          res.json([]);
          return;
        }

        const rels = await prisma.competitorRelation.findMany({
          where: {
            OR: [{ appId: activeApp.id }, { competitorId: activeApp.id }],
          },
        });

        const relatedIds = rels.map((r) => (r.appId === activeApp.id ? r.competitorId : r.appId));

        whereClause = {
          OR: [{ id: activeApp.id }, { id: { in: relatedIds } }],
        };
      }
    } else if (!isAdmin && teamId) {
      const member = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: req.user!.userId } },
        include: { appAccess: true },
      });

      const isPrivileged = member?.role === "OWNER" || member?.role === "ADMIN";

      if (!isPrivileged && member && member.appAccess.length > 0) {
        const allowedAppIds = member.appAccess.map((a) => a.appId);

        whereClause = ownOnly
          ? { id: { in: allowedAppIds }, isOwnApp: true }
          : { OR: [{ id: { in: allowedAppIds } }, { isOwnApp: false }] };
      } else {
        whereClause = ownOnly ? { teamId, isOwnApp: true } : { OR: [{ teamId }, { isOwnApp: false }] };
      }
    } else if (ownOnly) {
      whereClause = teamId ? { teamId, isOwnApp: true } : { isOwnApp: true };
    }

    const apps = await prisma.app.findMany({
      where: whereClause,
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
        inAppPurchases: { select: { name: true, price: true, kind: true }, orderBy: { position: "asc" } },
        ...(!ownOnly && {
          _count: {
            select: {
              competitors: true,
              competitorOf: true,
            },
          },
        }),
      },
      orderBy: [{ isOwnApp: "desc" }, { name: "asc" }],
    });

    for (const a of apps) {
      if (a.isOwnApp) {
        const iconUrl = a.snapshots[0]?.iconUrl ?? null;

        if (iconUrl && a.accentColorIconUrl !== iconUrl) {
          ensureAccentColor(a.id, iconUrl, {
            accentColor: a.accentColor,
            accentColorIconUrl: a.accentColorIconUrl,
          }).catch(() => {});
        }
      }
    }

    res.json(
      apps.map((a) => ({
        id: a.id,
        bundleId: a.bundleId,
        name: a.name,
        displayName: a.displayName,
        trackId: a.trackId?.toString() ?? null,
        country: a.country,
        isOwnApp: a.isOwnApp,
        screenshotsLocked: a.screenshotsLocked,
        title: a.currentTitle,
        subtitle: a.currentSubtitle,
        keywords: a.currentKeywords,
        rating: a.snapshots[0]?.rating ?? null,
        ratingsCount: a.snapshots[0]?.ratingsCount ?? null,
        iconUrl: a.snapshots[0]?.iconUrl ?? null,
        accentColor: a.accentColor,
        languagesCount: a.supportedLanguages.length,
        competitorCount: "_count" in a ? (a as any)._count.competitors + (a as any)._count.competitorOf : 0,
        inAppPurchases: [...a.inAppPurchases].sort(
          (x, y) => (x.kind === "subscription" ? 0 : 1) - (y.kind === "subscription" ? 0 : 1),
        ),
        rankingCount: 0,
        updatedAt: a.updatedAt,
      })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.delete("/:ownAppId/competitors/:competitorId", appAccess("params", "ownAppId"), async (req, res) => {
  try {
    const competitorId = req.params.competitorId as string;

    await prisma.competitorRelation.deleteMany({
      where: {
        OR: [
          { appId: req.bundleApp!.id, competitorId },
          { appId: competitorId, competitorId: req.bundleApp!.id },
        ],
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function excludedBundleIds(ownAppId: string, ownBundleId: string): Promise<Set<string>> {
  const rels = await prisma.competitorRelation.findMany({
    where: { OR: [{ appId: ownAppId }, { competitorId: ownAppId }] },
  });

  const relatedIds = rels.map((r) => (r.appId === ownAppId ? r.competitorId : r.appId));
  const relatedApps = relatedIds.length
    ? await prisma.app.findMany({ where: { id: { in: relatedIds } }, select: { bundleId: true } })
    : [];

  return new Set<string>([ownBundleId, ...relatedApps.map((a) => a.bundleId)]);
}

appsRouter.get("/:id/competitor-search", appAccess("params", "id"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const q = ((req.query.q as string) ?? "").trim();

    if (q.length < 2) {
      res.json([]);
      return;
    }

    const exclude = await excludedBundleIds(ownApp.id, ownApp.bundleId);
    const scraper = new AppStoreScraper(ownApp.country, undefined, ownApp.bundleId);
    const results = await scraper.searchApps(q, 15);

    res.json(
      results
        .filter((r) => !exclude.has(r.bundleId))
        .slice(0, 10)
        .map((r) => ({
          bundleId: r.bundleId,
          name: r.trackName,
          iconUrl: r.artworkUrl512 ?? null,
          rating: r.averageUserRating ?? null,
          ratingsCount: r.userRatingCount ?? null,
          developerName: r.sellerName ?? null,
        })),
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.get("/:id/competitor-suggestions", appAccess("params", "id"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const keywords = await prisma.keyword.findMany({
      where: { rankings: { some: { appId: ownApp.id } } },
      orderBy: { popularity: "desc" },
      take: 5,
    });

    if (keywords.length === 0) {
      res.json([]);
      return;
    }

    const exclude = await excludedBundleIds(ownApp.id, ownApp.bundleId);
    const scraper = new AppStoreScraper(ownApp.country, undefined, ownApp.bundleId);
    const terms = keywords.map((k) => k.term);
    const perTerm = await Promise.all(terms.map((t) => scraper.searchApps(t, 8).catch(() => [])));

    const byBundle = new Map<
      string,
      {
        name: string;
        iconUrl: string | null;
        rating: number | null;
        ratingsCount: number | null;
        developerName: string | null;
        appearances: number;
        bestPos: number;
      }
    >();

    for (const results of perTerm) {
      results.forEach((r, idx) => {
        if (exclude.has(r.bundleId)) return;
        const existing = byBundle.get(r.bundleId);

        if (existing) {
          existing.appearances++;
          existing.bestPos = Math.min(existing.bestPos, idx);
        } else {
          byBundle.set(r.bundleId, {
            name: r.trackName,
            iconUrl: r.artworkUrl512 ?? null,
            rating: r.averageUserRating ?? null,
            ratingsCount: r.userRatingCount ?? null,
            developerName: r.sellerName ?? null,
            appearances: 1,
            bestPos: idx,
          });
        }
      });
    }

    const candidates = [...byBundle.entries()]
      .map(([bundleId, c]) => ({
        bundleId,
        name: c.name,
        iconUrl: c.iconUrl,
        rating: c.rating,
        ratingsCount: c.ratingsCount,
        developerName: c.developerName,
        relevance: Math.max(1, Math.round((c.appearances / terms.length) * 100) - c.bestPos),
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 8);

    res.json(candidates);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.post("/:id/competitors", appAccess("params", "id"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const bundleId = ((req.body?.bundleId as string) ?? "").trim();

    if (!bundleId) {
      res.status(400).json({ error: "bundleId is required" });
      return;
    }

    const scraper = new AppStoreScraper(ownApp.country, undefined, ownApp.bundleId);
    const competitorId = await scraper.scrapeAndSaveApp(bundleId, false);

    if (!competitorId) {
      res.status(404).json({ error: "App not found on the App Store" });
      return;
    }

    if (competitorId === ownApp.id) {
      res.status(400).json({ error: "Cannot add your own app as a competitor" });
      return;
    }

    await prisma.competitorRelation.upsert({
      where: { appId_competitorId: { appId: ownApp.id, competitorId } },
      create: { appId: ownApp.id, competitorId },
      update: {},
    });

    const saved = await prisma.app.findUnique({ where: { id: competitorId }, select: { name: true } });

    res.json({ ok: true, name: saved?.name ?? bundleId, competitorId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
