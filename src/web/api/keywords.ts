import { Router } from "express";
import { prisma, logger } from "../../config";
import { bundleAccess } from "../auth";
import { normalizeLanguage } from "../../services/app-store-markets";
import { FREE_KEYWORDS_PER_APP, isTeamPro } from "../../services/pro-grants";
import { KeywordTracker } from "../../services/keyword-tracker";

export const keywordsRouter = Router();

keywordsRouter.get("/", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const t0 = performance.now();

    type KeywordPageRow = {
      id: string;
      term: string;
      country: string;
      language: string;
      popularity: number | null;
      difficulty: number | null;
      searchVolume: number | null;
      updatedAt: Date;
      latestRank: number | null;
    };
    const pageRows = await prisma.$queryRaw<KeywordPageRow[]>`
        WITH app_keyword_ids AS MATERIALIZED (
          SELECT DISTINCT "keywordId" AS id
          FROM "KeywordRanking"
          WHERE "appId" = ${ownApp.id}
        ),
        page AS (
          SELECT k.id, k.term, k.country, k.language, k.popularity, k.difficulty,
                 k."searchVolume", k."updatedAt"
          FROM "Keyword" k
          JOIN app_keyword_ids ak ON ak.id = k.id
          ORDER BY k.popularity DESC NULLS LAST
        )
        SELECT p.id, p.term, p.country, p.language, p.popularity, p.difficulty,
               p."searchVolume", p."updatedAt",
               lr.rank AS "latestRank"
        FROM page p
        LEFT JOIN LATERAL (
          SELECT rank
          FROM "KeywordRanking"
          WHERE "appId" = ${ownApp.id} AND "keywordId" = p.id
          ORDER BY "trackedAt" DESC
          LIMIT 1
        ) lr ON TRUE
        ORDER BY p.popularity DESC NULLS LAST
      `;
    const total = pageRows.length;
    const t1 = performance.now();

    const keywords = pageRows.map((r) => ({
      id: r.id,
      term: r.term,
      country: r.country,
      language: r.language,
      popularity: r.popularity,
      difficulty: r.difficulty,
      searchVolume: r.searchVolume,
      updatedAt: r.updatedAt,
      rankings: r.latestRank != null ? [{ rank: r.latestRank }] : ([] as { rank: number | null }[]),
    }));
    const keywordIds = keywords.map((k) => k.id);

    if (keywordIds.length === 0) {
      res.json({ items: [], total });
      return;
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    type CompRow = {
      keywordId: string;
      rank: number;
      appName: string;
      iconUrl: string | null;
    };
    type PrevRow = { keywordId: string; rank: number | null };

    const time = async <T>(label: string, p: Promise<T>): Promise<[T, number]> => {
      const s = performance.now();
      const v = await p;
      return [v, performance.now() - s];
    };

    const [[topCompRows, tComp], [previousRankings, tPrev], groupMembers] = await Promise.all([
      time(
        "comp",
        prisma.$queryRaw<CompRow[]>`
        WITH latest AS (
          SELECT DISTINCT ON ("keywordId", "bundleId")
                 "keywordId", "bundleId", name, "iconUrl", rank
          FROM "KeywordSearchResult"
          WHERE "keywordId" = ANY(${keywordIds}::text[])
            AND "trackedAt" >= NOW() - INTERVAL '7 days'
          ORDER BY "keywordId", "bundleId", "trackedAt" DESC
        ),
        ranked AS (
          SELECT "keywordId", name, "iconUrl", rank,
                 ROW_NUMBER() OVER (PARTITION BY "keywordId" ORDER BY rank ASC) AS rn
          FROM latest
        )
        SELECT "keywordId", name AS "appName", "iconUrl", rank
        FROM ranked
        WHERE rn <= 5
        ORDER BY "keywordId", rank ASC
      `,
      ),
      time(
        "prev",
        prisma.$queryRaw<PrevRow[]>`
        SELECT DISTINCT ON ("keywordId") "keywordId", rank
        FROM "KeywordRanking"
        WHERE "keywordId" = ANY(${keywordIds}::text[])
          AND "appId" = ${ownApp.id}
          AND "trackedAt" <= ${oneDayAgo}
        ORDER BY "keywordId", "trackedAt" DESC
      `,
      ),
      prisma.keywordGroupMember.findMany({
        where: { appId: ownApp.id, keywordId: { in: keywordIds } },
        select: { keywordId: true, groupId: true },
      }),
    ]);

    const groupByKeyword = new Map(groupMembers.map((m) => [m.keywordId, m.groupId]));

    const topCompetitorsMap = new Map<string, CompRow[]>();
    for (const r of topCompRows) {
      const list = topCompetitorsMap.get(r.keywordId) ?? [];
      list.push(r);
      topCompetitorsMap.set(r.keywordId, list);
    }

    const previousRankMap = new Map(previousRankings.map((r) => [r.keywordId, r.rank]));
    const result = keywords.map((k) => {
      const list = topCompetitorsMap.get(k.id) ?? [];
      const topCompetitors = list.map((r) => ({
        name: r.appName,
        iconUrl: r.iconUrl,
        rank: r.rank,
      }));

      const currentRank = k.rankings[0]?.rank ?? null;
      const previousRank = previousRankMap.get(k.id) ?? null;
      const rankTrend = currentRank != null && previousRank != null ? previousRank - currentRank : null;

      return {
        id: k.id,
        term: k.term,
        country: k.country,
        language: k.language,
        popularity: k.popularity,
        difficulty: k.difficulty,
        searchVolume: k.searchVolume,
        ourRank: currentRank,
        rankTrend,
        topCompetitors,
        suggestionCount: 0,
        groupId: groupByKeyword.get(k.id) ?? null,
        updatedAt: k.updatedAt,
      };
    });

    const tTotal = performance.now() - t0;
    res.setHeader(
      "Server-Timing",
      `keywords;dur=${(t1 - t0).toFixed(0)},comp;dur=${tComp.toFixed(0)},prev;dur=${tPrev.toFixed(0)},total;dur=${tTotal.toFixed(0)}`,
    );
    console.log(
      `[keywords] n=${keywords.length} keywords=${(t1 - t0).toFixed(0)}ms comp=${tComp.toFixed(0)}ms prev=${tPrev.toFixed(0)}ms total=${tTotal.toFixed(0)}ms`,
    );
    res.json({ items: result, total });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.get("/:id/history", async (req, res) => {
  try {
    const keyword = await prisma.keyword.findUnique({
      where: { id: req.params.id },
    });
    if (!keyword) return res.status(404).json({ error: "Not found" });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const results = await prisma.keywordSearchResult.findMany({
      where: { keywordId: req.params.id, trackedAt: { gte: thirtyDaysAgo } },
      select: { rank: true, bundleId: true, name: true, iconUrl: true, country: true, trackedAt: true },
      orderBy: { trackedAt: "desc" },
      take: 2000,
    });

    const bundleId = req.query.bundleId as string | undefined;
    const ownApp = bundleId ? await prisma.app.findUnique({ where: { bundleId } }) : null;

    let trackedBundleIds = new Set<string>();
    if (ownApp) {
      const rels = await prisma.competitorRelation.findMany({
        where: { OR: [{ appId: ownApp.id }, { competitorId: ownApp.id }] },
        include: { app: { select: { bundleId: true } }, competitor: { select: { bundleId: true } } },
      });
      trackedBundleIds = new Set(rels.map((r) => (r.appId === ownApp.id ? r.competitor.bundleId : r.app.bundleId)));
    }

    // Latest snapshot row per app, sorted by rank — the full list of apps ranked in the most recent scrape.
    const byBundle = new Map<
      string,
      {
        bundleId: string;
        name: string;
        iconUrl: string | null;
        rank: number | null;
        isTracked: boolean;
        isOwn: boolean;
      }
    >();
    for (const r of results) {
      if (byBundle.has(r.bundleId)) continue;
      byBundle.set(r.bundleId, {
        bundleId: r.bundleId,
        name: r.name,
        iconUrl: r.iconUrl,
        rank: r.rank,
        isTracked: trackedBundleIds.has(r.bundleId),
        isOwn: bundleId != null && r.bundleId === bundleId,
      });
    }
    const competitors = [...byBundle.values()].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

    res.json({
      keyword: {
        id: keyword.id,
        term: keyword.term,
        popularity: keyword.popularity,
        difficulty: keyword.difficulty,
      },
      ownAppId: ownApp?.id ?? null,
      rankings: results.map((r) => ({
        rank: r.rank,
        appName: r.name,
        appBundleId: r.bundleId,
        country: r.country,
        trackedAt: r.trackedAt,
      })),
      competitors,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.post("/", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const { term, country, language } = req.body;
    if (!term) return res.status(400).json({ error: "term is required" });
    const normalizedCountry = (country || "de").toLowerCase();
    const normalizedLanguage = normalizeLanguage(language, normalizedCountry);
    const ownApp = req.bundleApp!;

    if (!(await isTeamPro(ownApp.teamId))) {
      const trackedGroups = await prisma.keywordRanking.groupBy({
        by: ["keywordId"],
        where: { appId: ownApp.id },
      });
      const tracked = trackedGroups.length;
      if (tracked >= FREE_KEYWORDS_PER_APP) {
        return res.status(403).json({
          error: `Free plan is limited to ${FREE_KEYWORDS_PER_APP} keywords per app. Upgrade to Pro to track more.`,
          code: "KEYWORD_LIMIT_REACHED",
          limit: FREE_KEYWORDS_PER_APP,
        });
      }
    }

    const keyword = await prisma.keyword.upsert({
      where: { term_country: { term, country: normalizedCountry } },
      create: {
        term,
        country: normalizedCountry,
        language: normalizedLanguage,
      },
      update: {},
    });

    await prisma.keywordSuggestion.updateMany({
      where: {
        appId: ownApp.id,
        country: normalizedCountry,
        term: { equals: term, mode: "insensitive" },
        status: "PENDING",
      },
      data: { status: "ADDED" },
    });

    const existingRanking = await prisma.keywordRanking.findFirst({
      where: { keywordId: keyword.id, appId: ownApp.id },
      select: { id: true },
    });
    if (!existingRanking) {
      await prisma.keywordRanking.create({
        data: {
          keywordId: keyword.id,
          appId: ownApp.id,
          rank: null,
          country: normalizedCountry,
        },
      });
    }

    void (async () => {
      try {
        const tracker = new KeywordTracker(ownApp.bundleId, normalizedCountry);
        await tracker.trackKeywordRanking(term, normalizedCountry);
      } catch (trackErr) {
        logger.warn(`[keywords/add] Background ranking fetch failed for "${term}"`, {
          error: String(trackErr),
        });
      }
    })();

    res.json({ ok: true, keyword, tracking: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.get("/suggestions", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const suggestions = await prisma.keywordSuggestion.findMany({
      where: { appId: ownApp.id, status: "PENDING" },
      orderBy: [{ popularity: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        term: true,
        country: true,
        language: true,
        popularity: true,
        difficulty: true,
        searchVolume: true,
      },
    });
    res.json({ items: suggestions, total: suggestions.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.post("/suggestions/:id/dismiss", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const result = await prisma.keywordSuggestion.updateMany({
      where: { id: req.params.id, appId: ownApp.id, status: "PENDING" },
      data: { status: "DISMISSED" },
    });
    if (result.count === 0) return res.status(404).json({ error: "Suggestion not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.get("/groups", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const groups = await prisma.keywordGroup.findMany({
      where: { appId: ownApp.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.post("/groups", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const max = await prisma.keywordGroup.aggregate({
      where: { appId: ownApp.id },
      _max: { sortOrder: true },
    });
    const group = await prisma.keywordGroup.create({
      data: { appId: ownApp.id, name, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ group });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function loadOwnedGroup(req: any, res: any) {
  const group = await prisma.keywordGroup.findUnique({
    where: { id: req.params.id },
    include: { app: { select: { teamId: true } } },
  });
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return null;
  }
  if (req.user.role !== "ADMIN" && group.app.teamId !== req.user.teamId) {
    res.status(403).json({ error: "Not authorized" });
    return null;
  }
  return group;
}

keywordsRouter.patch("/groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedGroup(req, res);
    if (!group) return;

    const data: { name?: string; sortOrder?: number } = {};
    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      data.name = name;
    }
    if (req.body.sortOrder != null && Number.isFinite(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }

    const updated = await prisma.keywordGroup.update({
      where: { id: group.id },
      data,
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ group: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.delete("/groups/:id", async (req, res) => {
  try {
    const group = await loadOwnedGroup(req, res);
    if (!group) return;
    await prisma.keywordGroup.delete({ where: { id: group.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.put("/:id/group", bundleAccess("body", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const keywordId = req.params.id;
    const groupId: string | null = req.body.groupId ?? null;

    if (groupId) {
      const group = await prisma.keywordGroup.findFirst({
        where: { id: groupId, appId: ownApp.id },
        select: { id: true },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });

      await prisma.keywordGroupMember.upsert({
        where: { appId_keywordId: { appId: ownApp.id, keywordId } },
        create: { appId: ownApp.id, keywordId, groupId },
        update: { groupId },
      });
    } else {
      await prisma.keywordGroupMember.deleteMany({
        where: { appId: ownApp.id, keywordId },
      });
    }
    res.json({ ok: true, groupId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

keywordsRouter.delete("/:id", async (req, res) => {
  try {
    if (req.user!.role !== "ADMIN") {
      const teamId = req.user!.teamId;
      const ranking = await prisma.keywordRanking.findFirst({
        where: {
          keywordId: req.params.id,
          app: { teamId },
        },
      });
      if (!ranking) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
    }

    await prisma.keyword.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
