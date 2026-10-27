import { prisma } from "../../config";
import { requireAuth, bundleAccess, appAccess } from "../auth";
import { parseProvisioningProfiles } from "../../services/utils/provisioning-profiles";
import { appsRouter } from "./apps-list";

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
      screenshotUrls: snapshot?.screenshotUrls ?? [],
      languages: app.supportedLanguages,
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
        signingProvisioningProfile: null,
        signingTeamId: teamId ?? null,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.get("/:id/build-screenshot-selection", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const app = await prisma.app.findUnique({
      where: { id: req.bundleApp!.id },
      select: { selectedBuildJobId: true, selectedScreenshotJobId: true },
    });

    res.json(app ?? { selectedBuildJobId: null, selectedScreenshotJobId: null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

appsRouter.patch("/:id", requireAuth, appAccess("params", "id"), async (req, res) => {
  try {
    const { displayName, screenshotsLocked, selectedBuildJobId, selectedScreenshotJobId } = req.body as {
      displayName?: string | null;
      screenshotsLocked?: boolean;
      selectedBuildJobId?: string | null;
      selectedScreenshotJobId?: string | null;
    };

    const appId = req.bundleApp!.id;

    const data: {
      displayName?: string | null;
      screenshotsLocked?: boolean;
      selectedBuildJobId?: string | null;
      selectedScreenshotJobId?: string | null;
    } = {};

    if (displayName !== undefined) {
      const trimmed = typeof displayName === "string" ? displayName.trim() : displayName;

      data.displayName = trimmed || null;
    }

    if (typeof screenshotsLocked === "boolean") {
      data.screenshotsLocked = screenshotsLocked;
    }

    if (selectedBuildJobId !== undefined) {
      if (selectedBuildJobId === null) {
        data.selectedBuildJobId = null;
      } else {
        const job = await prisma.buildJob.findFirst({ where: { id: selectedBuildJobId, appId } });

        if (!job) {
          res.status(400).json({ error: "Build not found for this app" });
          return;
        }

        data.selectedBuildJobId = selectedBuildJobId;
      }
    }

    if (selectedScreenshotJobId !== undefined) {
      if (selectedScreenshotJobId === null) {
        data.selectedScreenshotJobId = null;
      } else {
        const job = await prisma.screenshotJob.findFirst({ where: { id: selectedScreenshotJobId, appId } });

        if (!job) {
          res.status(400).json({ error: "Screenshot run not found for this app" });
          return;
        }

        data.selectedScreenshotJobId = selectedScreenshotJobId;
      }
    }

    const app = await prisma.app.update({
      where: { id: appId },
      data,
    });

    res.json({
      id: app.id,
      displayName: app.displayName,
      screenshotsLocked: app.screenshotsLocked,
      selectedBuildJobId: app.selectedBuildJobId,
      selectedScreenshotJobId: app.selectedScreenshotJobId,
    });
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
