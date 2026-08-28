import { Router } from "express";
import { prisma } from "../../config";
import { requireAuth, bundleAccess, appAccess } from "../auth";
import { ensureAccentColor } from "../../services/utils/icon-accent";
import { parseProvisioningProfiles } from "../../services/utils/provisioning-profiles";
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
        title: a.currentTitle,
        subtitle: a.currentSubtitle,
        keywords: a.currentKeywords,
        rating: a.snapshots[0]?.rating ?? null,
        ratingsCount: a.snapshots[0]?.ratingsCount ?? null,
        iconUrl: a.snapshots[0]?.iconUrl ?? null,
        accentColor: a.accentColor,
        competitorCount: "_count" in a ? (a as any)._count.competitors + (a as any)._count.competitorOf : 0,
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
    res.json({ ok: true, name: saved?.name ?? bundleId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.get("/:id", appAccess("params", "id"), async (req, res) => {
  try {
    const app = await prisma.app.findUnique({
      where: { id: req.bundleApp!.id },
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 20 },
        competitors: {
          include: {
            competitor: {
              include: {
                snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
              },
            },
          },
        },
        competitorOf: {
          include: {
            app: {
              include: {
                snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!app) return res.status(404).json({ error: "App not found" });

    const allCompetitors = [
      ...app.competitors.map((c) => ({
        id: c.competitor.id,
        name: c.competitor.name,
        bundleId: c.competitor.bundleId,
        relevance: c.relevanceScore,
        rating: c.competitor.snapshots[0]?.rating,
        iconUrl: c.competitor.snapshots[0]?.iconUrl,
      })),
      ...app.competitorOf.map((c) => ({
        id: c.app.id,
        name: c.app.name,
        bundleId: c.app.bundleId,
        relevance: c.relevanceScore,
        rating: c.app.snapshots[0]?.rating,
        iconUrl: c.app.snapshots[0]?.iconUrl,
      })),
    ];

    res.json({
      id: app.id,
      bundleId: app.bundleId,
      name: app.name,
      trackId: app.trackId?.toString() ?? null,
      country: app.country,
      isOwnApp: app.isOwnApp,
      title: app.currentTitle,
      subtitle: app.currentSubtitle,
      keywords: app.currentKeywords,
      description: app.currentDescription,
      snapshots: app.snapshots.map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        rating: s.rating,
        ratingsCount: s.ratingsCount,
        version: s.version,
        iconUrl: s.iconUrl,
        developerName: s.developerName,
        category: s.category,
        screenshotUrls: s.screenshotUrls,
        scrapedAt: s.scrapedAt,
      })),
      competitors: allCompetitors,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const KEYWORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "your",
  "with",
  "app",
  "from",
  "you",
  "are",
  "all",
  "new",
  "get",
  "now",
  "pro",
  "plus",
  "best",
  "free",
  "one",
  "out",
  "our",
  "any",
  "can",
  "use",
  "von",
  "und",
  "der",
  "die",
  "das",
  "für",
  "mit",
  "app",
  "den",
  "ein",
  "eine",
  "auf",
  "ist",
  "ihr",
  "dein",
  "deine",
  "the",
  "kostenlos",
  "los",
]);

function extractCandidateKeywords(title: string | null, subtitle: string | null, tracked: Set<string>): string[] {
  const text = `${title ?? ""} ${subtitle ?? ""}`.toLowerCase();
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    if (term.length < 3 || seen.has(term) || tracked.has(term)) return;
    seen.add(term);
    candidates.push(term);
  };

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const next = tokens[i + 1];
    if (next && !KEYWORD_STOPWORDS.has(word) && !KEYWORD_STOPWORDS.has(next)) {
      add(`${word} ${next}`);
    }
  }
  for (const word of tokens) {
    if (!KEYWORD_STOPWORDS.has(word)) add(word);
  }

  return candidates.slice(0, 15);
}

appsRouter.get("/:id/competitor-detail", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const app = await prisma.app.findUnique({
      where: { id: req.params.id },
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
      },
    });

    if (!app) return res.status(404).json({ error: "App not found" });

    if (app.id !== ownApp.id) {
      const relation = await prisma.competitorRelation.findFirst({
        where: {
          OR: [
            { appId: ownApp.id, competitorId: app.id },
            { appId: app.id, competitorId: ownApp.id },
          ],
        },
      });

      if (!relation) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    const reviews = await prisma.competitorReview.findMany({
      where: { appId: app.id },
      orderBy: { reviewedAt: "desc" },
      take: 50,
    });

    const latestSummary = await prisma.competitorReviewSummary.findFirst({
      where: { appId: app.id },
      orderBy: { createdAt: "desc" },
    });

    const metadataChanges = await prisma.appMetadataChange.findMany({
      where: { appId: app.id },
      orderBy: { detectedAt: "desc" },
      take: 50,
    });

    const inAppPurchases = await prisma.appInAppPurchase.findMany({
      where: { appId: app.id },
      orderBy: { position: "asc" },
    });

    let keywordRankings: Array<{
      keyword: string;
      keywordId: string;
      popularity: number | null;
      competitorRank: number | null;
      ourRank: number | null;
    }> = [];
    let untrackedKeywords: string[] = [];

    {
      {
        const keywords = await prisma.keyword.findMany({
          where: { rankings: { some: { appId: ownApp.id } } },
          orderBy: { popularity: "desc" },
        });

        const trackedSet = new Set(keywords.map((kw) => kw.term.toLowerCase()));
        untrackedKeywords = extractCandidateKeywords(app.currentTitle, app.currentSubtitle, trackedSet);

        const kwIds = keywords.map((kw) => kw.id);
        const [compRankings, ownRankings] = await Promise.all([
          prisma.keywordRanking.findMany({
            where: { keywordId: { in: kwIds }, appId: app.id },
            orderBy: { trackedAt: "desc" },
            distinct: ["keywordId"],
          }),
          prisma.keywordRanking.findMany({
            where: { keywordId: { in: kwIds }, appId: ownApp.id },
            orderBy: { trackedAt: "desc" },
            distinct: ["keywordId"],
          }),
        ]);
        const compRankMap = new Map(compRankings.map((r) => [r.keywordId, r.rank]));
        const ownRankMap = new Map(ownRankings.map((r) => [r.keywordId, r.rank]));

        for (const kw of keywords) {
          keywordRankings.push({
            keyword: kw.term,
            keywordId: kw.id,
            popularity: kw.popularity,
            competitorRank: compRankMap.get(kw.id) ?? null,
            ourRank: ownRankMap.get(kw.id) ?? null,
          });
        }
      }
    }

    const snapshot = app.snapshots[0];

    res.json({
      id: app.id,
      bundleId: app.bundleId,
      name: app.name,
      trackId: app.trackId?.toString() ?? null,
      country: app.country,
      title: app.currentTitle,
      subtitle: app.currentSubtitle,
      description: app.currentDescription,
      rating: snapshot?.rating ?? null,
      ratingsCount: snapshot?.ratingsCount ?? null,
      iconUrl: snapshot?.iconUrl ?? null,
      version: snapshot?.version ?? null,
      developerName: snapshot?.developerName ?? null,
      category: snapshot?.category ?? null,
      reviews: reviews.map((r: any) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author: r.author,
        territory: r.territory,
        reviewedAt: r.reviewedAt,
      })),
      reviewSummary: latestSummary
        ? {
            id: latestSummary.id,
            reviewCount: latestSummary.reviewCount,
            averageRating: latestSummary.averageRating,
            summary: latestSummary.summary,
            strengths: latestSummary.strengths,
            weaknesses: latestSummary.weaknesses,
            topThemes: latestSummary.topThemes,
            sentiment: latestSummary.sentiment,
            createdAt: latestSummary.createdAt,
          }
        : null,
      metadataChanges: metadataChanges.map((c: any) => ({
        id: c.id,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        detectedAt: c.detectedAt,
      })),
      keywordRankings,
      untrackedKeywords,
      inAppPurchases: inAppPurchases.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        kind: p.kind,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.get("/:id/signing", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const app = await prisma.app.findUnique({
      where: { id: req.bundleApp!.id },
      select: {
        signingCertP12: true,
        signingProvisioningProfile: true,
        signingProvisioningProfiles: true,
        signingTeamId: true,
      },
    });

    const profiles = parseProvisioningProfiles(app);
    res.json({
      hasCert: !!app?.signingCertP12,
      hasProfile: profiles.length > 0,
      profileCount: profiles.length,
      teamId: app?.signingTeamId ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.put("/:id/signing", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const { p12Base64, p12Password, profileBase64, profilesBase64, teamId } = req.body;

    // Accepts either the array (one profile per bundle ID) or the old single value.
    const profiles: string[] = Array.isArray(profilesBase64)
      ? profilesBase64.filter((p): p is string => typeof p === "string" && p.length > 0)
      : profileBase64
        ? [profileBase64]
        : [];

    if (!p12Base64 || !p12Password || profiles.length === 0) {
      res.status(400).json({
        error: "p12Base64, p12Password, and at least one provisioning profile are required",
      });
      return;
    }

    await prisma.app.update({
      where: { id: req.bundleApp!.id },
      data: {
        signingCertP12: p12Base64,
        signingCertPassword: p12Password,
        signingProvisioningProfiles: JSON.stringify(profiles),
        // Cleared so the legacy column can never shadow a freshly uploaded set.
        signingProvisioningProfile: null,
        signingTeamId: teamId ?? null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.patch("/:id", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const { displayName } = req.body as { displayName?: string | null };
    const trimmed = typeof displayName === "string" ? displayName.trim() : displayName;

    const app = await prisma.app.update({
      where: { id: req.bundleApp!.id },
      data: { displayName: trimmed || null },
    });
    res.json({ id: app.id, displayName: app.displayName });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.delete("/:id", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const id = req.bundleApp!.id;
    const isAdmin = req.user!.role === "ADMIN";
    const teamId = req.user!.teamId;
    const app = await prisma.app.findUnique({ where: { id } });

    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    if (!isAdmin && app.teamId !== teamId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    if (!app.isOwnApp) {
      res.status(400).json({ error: "Only own apps can be deleted" });
      return;
    }

    await prisma.app.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.delete("/:id/signing", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    await prisma.app.update({
      where: { id: req.bundleApp!.id },
      data: {
        signingCertP12: null,
        signingCertPassword: null,
        signingProvisioningProfile: null,
        signingProvisioningProfiles: null,
        signingTeamId: null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
