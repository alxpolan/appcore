import { type Request, type Response } from "express";
import { prisma } from "../../config";
import { evaluateAppMetadata, type AiFieldKey } from "./quick-scan-ai";
import { majorVersionNumber } from "./analytics";

type Impact = "high" | "med" | "low";

type Finding = {
  key: string;
  title: string;
  desc: string;
  impact: Impact;
  gap: number;
  metric?: [string, string];
  suggestion?: string;
};

const MAX_FINDINGS = 4;
const IMPACT_RANK: Record<Impact, number> = { high: 0, med: 1, low: 2 };

const AI_FINDING_KEY: Record<AiFieldKey, string> = {
  title: "title",
  subtitle: "subtitle",
  keywords: "keyword",
  description: "description",
};
const AI_FINDING_TITLE: Record<AiFieldKey, string> = {
  title: "Sharpen your title",
  subtitle: "Rework your subtitle",
  keywords: "Strengthen your keywords",
  description: "Improve your description hook",
};

export async function runQuickScan(req: Request, res: Response): Promise<void> {
  const bundleId = req.query.bundleId as string;

  const app = await prisma.app.findUnique({
    where: { bundleId },
    include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
  });
  const snapshot = app?.snapshots[0] ?? null;

  if (!app || !snapshot) {
    res.json({ ready: false });
    return;
  }

  const appId = app.id;
  const minOsMajor = app.minimumOsVersion ? majorVersionNumber(app.minimumOsVersion) : null;

  const [distinctKeywords, competitorCount, platformImpressions] = await Promise.all([
    prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "keywordId")::int AS count
        FROM "KeywordRanking"
        WHERE "appId" = ${appId}
      `.then(([r]) => Number(r.count)),
    prisma.competitorRelation.count({
      where: { OR: [{ appId }, { competitorId: appId }] },
    }),
    minOsMajor != null
      ? prisma.appStoreAnalyticsPlatform.groupBy({
          by: ["platformVersion"],
          where: { bundleId },
          _sum: { impressions: true },
        })
      : Promise.resolve([]),
  ]);

  const title = (app.currentTitle ?? snapshot.title ?? "").trim();
  const subtitle = (app.currentSubtitle ?? snapshot.subtitle ?? "").trim();
  const screenshots = snapshot.screenshotUrls?.length ?? 0;
  const wordCount = snapshot.wordCount ?? 0;
  const rating = snapshot.rating ?? null;
  const pool: Finding[] = [];

  // Subtitle: only nag on length when it's genuinely under-used. A 28/30 subtitle
  // has no meaningful free space — quality (slogan vs. keywords) is judged by the AI pass below.
  if (!subtitle) {
    pool.push({
      key: "subtitle",
      title: "Add a subtitle",
      desc: "No subtitle is set - that's 30 prime characters for keywords and your pitch going unused.",
      impact: "high",
      metric: ["0", "/ 30 chars"],
      gap: 1,
    });
  } else if (subtitle.length < 16) {
    pool.push({
      key: "subtitle",
      title: "Use more of your subtitle",
      desc: `Your subtitle is only ${subtitle.length} of 30 characters - real room left for high-value keywords.`,
      impact: "med",
      metric: [String(subtitle.length), "/ 30 chars"],
      gap: (30 - subtitle.length) / 30,
    });
  }

  // Title: same logic. Don't flag a near-full title; the AI pass judges whether
  // the characters are well spent (brand + keywords vs. brand alone).
  if (title && title.length < 16) {
    pool.push({
      key: "title",
      title: "Use more of your title",
      desc: `Your title is only ${title.length} of 30 characters - room to pair your brand with strong keywords.`,
      impact: title.length < 10 ? "high" : "med",
      metric: [String(title.length), "/ 30 chars"],
      gap: (30 - title.length) / 30,
    });
  }

  // Screenshots: scale the nudge to how many are missing. 7-9 is a minor tweak, not a warning.
  if (screenshots < 4) {
    pool.push({
      key: "screenshots",
      title: "Add more screenshots",
      desc: `Only ${screenshots} screenshot${screenshots === 1 ? "" : "s"}. The first few drive most installs - fill at least the top slots.`,
      impact: "high",
      metric: [String(screenshots), "/ 10"],
      gap: (10 - screenshots) / 10,
    });
  } else if (screenshots < 7) {
    pool.push({
      key: "screenshots",
      title: "Add more screenshots",
      desc: `You have ${screenshots} screenshots. Filling more slots (up to 10) gives you more room to convert browsers.`,
      impact: "med",
      metric: [String(screenshots), "/ 10"],
      gap: (10 - screenshots) / 10,
    });
  } else if (screenshots < 10) {
    pool.push({
      key: "screenshots",
      title: "A few more screenshots could help",
      desc: `You have ${screenshots} screenshots - solid. Adding the last ${10 - screenshots} (up to 10) is a minor tweak, not a priority.`,
      impact: "low",
      metric: [String(screenshots), "/ 10"],
      gap: ((10 - screenshots) / 10) * 0.4,
    });
  }

  if (minOsMajor != null) {
    const totalImpressions = platformImpressions.reduce((sum, row) => sum + (row._sum.impressions ?? 0), 0);
    const belowMinOs = platformImpressions.reduce((sum, row) => {
      const major = majorVersionNumber(row.platformVersion);
      return major != null && major < minOsMajor ? sum + (row._sum.impressions ?? 0) : sum;
    }, 0);
    const belowMinOsPct = totalImpressions > 0 ? (belowMinOs / totalImpressions) * 100 : 0;

    if (totalImpressions >= 50 && belowMinOsPct >= 8) {
      pool.push({
        key: "minOsVersion",
        title: "Support older iPhones",
        desc: `${belowMinOsPct.toFixed(1)}% of impressions come from devices below your minimum OS requirement (iOS ${minOsMajor}) and can't install your app. Lowering your deployment target recovers those installs.`,
        impact: belowMinOsPct >= 20 ? "high" : "med",
        metric: [`${belowMinOsPct.toFixed(1)}%`, "unreachable"],
        gap: Math.min(1, belowMinOsPct / 30),
      });
    }
  }

  if (distinctKeywords < 25) {
    pool.push({
      key: "keyword",
      title: "Expand keyword coverage",
      desc:
        distinctKeywords === 0
          ? "We haven't found ranked keywords yet - start tracking terms to show up in more searches."
          : `You rank for ${distinctKeywords} keyword${distinctKeywords === 1 ? "" : "s"}. Top apps cover dozens - lots of room to reach more searchers.`,
      impact: "high",
      metric: [String(distinctKeywords), "tracked"],
      gap: (25 - distinctKeywords) / 25,
    });
  }

  if (competitorCount < 3) {
    pool.push({
      key: "competitor",
      title: "Benchmark competitors",
      desc:
        competitorCount === 0
          ? "No competitors identified yet - add rivals to see which keywords they win."
          : `Only ${competitorCount} competitor${competitorCount === 1 ? "" : "s"} tracked - add more to spot winnable terms.`,
      impact: "med",
      metric: [String(competitorCount), "tracked"],
      gap: (3 - competitorCount) / 3,
    });
  }

  if (wordCount < 120) {
    pool.push({
      key: "description",
      title: "Enrich your description",
      desc: `Your description is ${wordCount} word${wordCount === 1 ? "" : "s"}. Fuller descriptions convert better and give the algorithm more context.`,
      impact: "med",
      metric: [String(wordCount), "words"],
      gap: Math.min(1, (120 - wordCount) / 120),
    });
  }

  // Localization is the single biggest untapped reach lever for most apps, so we always
  // surface it as an opportunity. We can't measure locale coverage from a public scrape,
  // so it's framed as an opportunity rather than a deficiency.
  pool.push({
    key: "localization",
    title: "Localize for more markets",
    desc: "Your listing is optimized for one region. Translating your title, subtitle and keywords into more App Store languages unlocks organic installs in markets you're not ranking in yet.",
    impact: "med",
    gap: 0.5,
  });

  const mTitle = title ? Math.min(title.length / 30, 1) : 0;
  const mSub = subtitle ? Math.min(subtitle.length / 30, 1) : 0;
  const mShots = Math.min(screenshots / 8, 1);
  const mDesc = Math.min(wordCount / 120, 1);
  const metaScore = mTitle * 0.25 + mSub * 0.3 + mShots * 0.3 + mDesc * 0.15;
  const kwScore = Math.min(distinctKeywords / 25, 1);
  const compScore = Math.min(competitorCount / 5, 1);
  const ratingScore = rating != null ? Math.min(rating / 5, 1) : 0.6;
  const score = Math.round(100 * (metaScore * 0.5 + kwScore * 0.25 + compScore * 0.15 + ratingScore * 0.1));
  const target = Math.min(94, score + 30);

  const ai = await evaluateAppMetadata(appId, {
    title,
    subtitle,
    keywords: app.currentKeywords ?? "",
    description: app.currentDescription ?? snapshot.description ?? "",
  });

  // Merge the AI's qualitative verdicts into the findings. The AI catches what length
  // checks can't: a subtitle wasted on a marketing slogan, generic/duplicate keywords,
  // a brand-only title. AI insight is more specific, so it overrides the matching
  // heuristic finding (and adds a finding when the field passes length checks but reads poorly).
  const byKey = new Map<string, Finding>();
  for (const f of pool) byKey.set(f.key, f);

  if (ai) {
    for (const insight of ai.fields) {
      if (insight.verdict === "good") continue;
      const key = AI_FINDING_KEY[insight.field];
      const impact: Impact = insight.verdict === "poor" ? "high" : "med";
      const gap = insight.verdict === "poor" ? 0.85 : 0.6;
      const desc = insight.issue || insight.reasoning;
      const existing = byKey.get(key);
      if (existing) {
        if (desc) existing.desc = desc;
        existing.suggestion = insight.suggestion || existing.suggestion;
        if (IMPACT_RANK[impact] < IMPACT_RANK[existing.impact]) existing.impact = impact;
        existing.gap = Math.max(existing.gap, gap);
      } else if (desc) {
        byKey.set(key, {
          key,
          title: AI_FINDING_TITLE[insight.field],
          desc,
          suggestion: insight.suggestion || undefined,
          impact,
          gap,
        });
      }
    }
  }

  const findings = [...byKey.values()]
    .sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.gap - a.gap)
    .slice(0, MAX_FINDINGS)
    .map(({ gap: _gap, ...f }) => f);

  res.json({
    ready: true,
    app: {
      name: app.name,
      iconUrl: snapshot.iconUrl ?? null,
      rating,
      ratingsCount: snapshot.ratingsCount ?? null,
      category: snapshot.category ?? null,
    },
    score,
    target,
    findings,
    aiSummary: ai?.summary ?? null,
  });
}
