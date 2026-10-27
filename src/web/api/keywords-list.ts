import { Router } from "express";
import { prisma } from "../../config";
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

function rankWeight(rank: number | null): number {
  if (rank == null || rank < 1 || rank > 50) return 0;
  if (rank === 1) return 1;
  if (rank === 2) return 0.85;
  if (rank === 3) return 0.75;
  if (rank <= 5) return 0.6;
  if (rank <= 10) return 0.45;
  if (rank <= 20) return 0.25;
  if (rank <= 30) return 0.12;

  return 0.05;
}

const DEFAULT_POPULARITY = 5;

keywordsRouter.get("/visibility", bundleAccess("query", "bundleId"), async (req, res) => {
  try {
    const ownApp = req.bundleApp!;
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? "90"), 10) || 90, 7), 365);

    const since = new Date();

    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    type KwRow = { id: string; term: string; popularity: number | null };
    type DayRow = { keywordId: string; day: Date; rank: number | null };

    const [keywords, dayRows, seedRows] = await Promise.all([
      prisma.$queryRaw<KwRow[]>`
        SELECT DISTINCT k.id, k.term, k.popularity
        FROM "Keyword" k
        JOIN "KeywordRanking" kr ON kr."keywordId" = k.id
        WHERE kr."appId" = ${ownApp.id}
      `,
      prisma.$queryRaw<DayRow[]>`
        SELECT DISTINCT ON (kr."keywordId", (kr."trackedAt" AT TIME ZONE 'UTC')::date)
               kr."keywordId",
               (kr."trackedAt" AT TIME ZONE 'UTC')::date AS day,
               kr.rank
        FROM "KeywordRanking" kr
        WHERE kr."appId" = ${ownApp.id} AND kr."trackedAt" >= ${since}
        ORDER BY kr."keywordId", day, kr."trackedAt" DESC
      `,
      prisma.$queryRaw<{ keywordId: string; rank: number | null }[]>`
        SELECT DISTINCT ON (kr."keywordId") kr."keywordId", kr.rank
        FROM "KeywordRanking" kr
        WHERE kr."appId" = ${ownApp.id} AND kr."trackedAt" < ${since}
        ORDER BY kr."keywordId", kr."trackedAt" DESC
      `,
    ]);

    if (keywords.length === 0) {
      res.json({ series: [], trackedKeywords: 0, current: null, previous: null, top10: 0, top50: 0 });
      return;
    }

    const popularityById = new Map(keywords.map((k) => [k.id, k.popularity ?? DEFAULT_POPULARITY]));

    const byDay = new Map<string, Map<string, number | null>>();
    for (const r of dayRows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      const map = byDay.get(key) ?? new Map<string, number | null>();

      map.set(r.keywordId, r.rank);
      byDay.set(key, map);
    }

    const carried = new Map<string, number | null>(seedRows.map((r) => [r.keywordId, r.rank]));
    const series: { date: string; score: number; trackedKeywords: number }[] = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(since);

      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);

      for (const [keywordId, rank] of byDay.get(key) ?? []) carried.set(keywordId, rank);
      if (carried.size === 0) continue;

      let weighted = 0;
      let popularitySum = 0;
      for (const [keywordId, rank] of carried) {
        const popularity = popularityById.get(keywordId) ?? DEFAULT_POPULARITY;

        popularitySum += popularity;
        weighted += popularity * rankWeight(rank);
      }

      series.push({
        date: key,
        score: popularitySum > 0 ? Math.round((weighted / popularitySum) * 1000) / 10 : 0,
        trackedKeywords: carried.size,
      });
    }

    let top10 = 0;
    let top50 = 0;
    for (const rank of carried.values()) {
      if (rank == null) continue;
      if (rank <= 10) top10++;
      if (rank <= 50) top50++;
    }

    res.json({
      series,
      trackedKeywords: keywords.length,
      current: series.length ? series[series.length - 1].score : null,
      previous: series.length > 1 ? series[0].score : null,
      top10,
      top50,
    });
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
