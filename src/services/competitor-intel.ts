import { prisma, logger } from "../config";
import { AIClient } from "./ai-client";
import { AppStoreScraper } from "./appstore-scraper";

const SUBSCRIPTION_HINT =
  /\b(week|weekly|month|monthly|year|yearly|annual|quarter|season|sub|subscription|premium|plus|pro|unlimited)\b/i;

interface ScrapedReview {
  externalId: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  reviewedAt: Date;
}

export class CompetitorIntelService {
  private readonly ai: AIClient;
  private readonly country: string;

  constructor() {
    this.country = "de";
    this.ai = new AIClient();
  }

  async scrapeReviews(trackId: bigint | number, appId: string, country?: string): Promise<number> {
    const cc = country ?? this.country;
    const tid = typeof trackId === "bigint" ? Number(trackId) : trackId;
    let totalSaved = 0;

    for (let page = 1; page <= 10; page++) {
      try {
        const data: any = await fetch(
          `https://itunes.apple.com/${cc}/rss/customerreviews/page=${page}/id=${tid}/sortby=mostrecent/json`,
          { signal: AbortSignal.timeout(10000) },
        ).then((r) => {
          if (!r.ok) throw new Error(`iTunes API Error: ${r.status}`);
          return r.json();
        });

        const entries = data?.feed?.entry;
        if (!entries || !Array.isArray(entries)) break;

        const reviews: ScrapedReview[] = entries
          .filter((e: any) => e?.["im:rating"]?.label)
          .map((e: any) => ({
            externalId: e.id?.label ?? `${tid}-${e.title?.label}-${e.author?.name?.label}`,
            rating: parseInt(e["im:rating"]?.label ?? "0", 10),
            title: e.title?.label ?? "",
            body: e.content?.label ?? "",
            author: e.author?.name?.label ?? "Anonymous",
            reviewedAt: new Date(e.updated?.label ?? Date.now()),
          }));

        for (const review of reviews) {
          try {
            await prisma.competitorReview.upsert({
              where: {
                appId_externalId: { appId, externalId: review.externalId },
              },
              create: {
                appId,
                externalId: review.externalId,
                rating: review.rating,
                title: review.title,
                body: review.body,
                author: review.author,
                territory: cc,
                reviewedAt: review.reviewedAt,
              },
              update: {
                rating: review.rating,
                title: review.title,
                body: review.body,
              },
            });
            totalSaved++;
          } catch (err: any) {
            logger.debug(`[Reviews] Upsert failed for review ${review.externalId}: ${err?.message ?? err}`);
          }
        }

        if (reviews.length < 5) break;

        await this.sleep(500);
      } catch (err) {
        logger.debug(`Review page ${page} for track ${tid} failed: ${err}`);
        break;
      }
    }

    logger.info(`Scraped ${totalSaved} reviews for app ${appId} (track ${tid})`);
    return totalSaved;
  }

  async scrapeAllCompetitorReviews(
    bundleId: string,
    competitorAppIds?: string[],
  ): Promise<{ total: number; apps: number }> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId },
      include: {
        competitors: {
          include: { competitor: true },
        },
      },
    });

    if (!ownApp) throw new Error(`App not found: ${bundleId}`);

    const country = ownApp.country;
    let total = 0;
    let apps = 0;

    const relations = competitorAppIds
      ? ownApp.competitors.filter((rel) => competitorAppIds.includes(rel.competitor.id))
      : ownApp.competitors;

    for (const rel of relations) {
      const comp = rel.competitor;
      if (!comp.trackId) continue;

      const count = await this.scrapeReviews(comp.trackId, comp.id, country);
      total += count;
      apps++;

      await this.sleep(1000);
    }

    logger.info(`Scraped reviews for ${apps} competitors, ${total} total reviews`);
    return { total, apps };
  }

  async summarizeReviews(appId: string): Promise<string> {
    const reviews = await prisma.competitorReview.findMany({
      where: { appId },
      orderBy: { reviewedAt: "desc" },
      take: 100,
    });

    if (reviews.length === 0) {
      logger.info(`No reviews to summarize for app ${appId}`);
      return "No reviews available";
    }

    const avgRating = reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length;

    const reviewTexts = reviews
      .map((r: any, i: number) => `[${i + 1}] ★${r.rating} "${r.title ?? ""}" — ${r.body ?? "(no body)"}`)
      .join("\n");

    const systemPrompt = `You are an app market analyst. Analyze the following user reviews for a competitor app and provide a structured summary. Respond in JSON format with these fields:
{
  "summary": "A 2-3 paragraph overall summary of user sentiment and feedback",
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "topThemes": ["theme1", "theme2", ...],
  "sentiment": "positive" | "mixed" | "negative"
}
Be concise but thorough. Extract actionable insights.`;

    const ai = await this.ai.query(
      systemPrompt,
      `Here are ${reviews.length} recent reviews (avg rating: ${avgRating.toFixed(1)}/5):\n\n${reviewTexts}`,
      {
        temperature: 0.5,
        maxTokens: 4000,
        jsonMode: true,
      },
    );

    try {
      const parsed = JSON.parse(ai.content);

      await prisma.competitorReviewSummary.create({
        data: {
          appId,
          reviewCount: reviews.length,
          averageRating: avgRating,
          summary: parsed.summary ?? ai.content,
          strengths: parsed.strengths ?? [],
          weaknesses: parsed.weaknesses ?? [],
          topThemes: parsed.topThemes ?? [],
          sentiment: parsed.sentiment ?? null,
          aiProvider: ai.provider,
          aiModel: ai.model,
        },
      });

      logger.info(`Created review summary for app ${appId}`);
      return parsed.summary;
    } catch {
      await prisma.competitorReviewSummary.create({
        data: {
          appId,
          reviewCount: reviews.length,
          averageRating: avgRating,
          summary: ai.content,
          strengths: [],
          weaknesses: [],
          topThemes: [],
          aiProvider: ai.provider,
          aiModel: ai.model,
        },
      });
      return ai.content;
    }
  }

  async summarizeAllCompetitorReviews(bundleId: string, competitorAppIds?: string[]): Promise<number> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId },
      include: {
        competitors: { include: { competitor: true } },
      },
    });

    if (!ownApp) throw new Error(`App not found: ${bundleId}`);

    const relations = competitorAppIds
      ? ownApp.competitors.filter((rel) => competitorAppIds.includes(rel.competitor.id))
      : ownApp.competitors;

    let count = 0;
    for (const rel of relations) {
      const reviewCount = await prisma.competitorReview.count({
        where: { appId: rel.competitor.id },
      });
      if (reviewCount === 0) continue;

      await this.summarizeReviews(rel.competitor.id);
      count++;
      await this.sleep(1000);
    }

    return count;
  }

  async detectMetadataChanges(appId: string): Promise<number> {
    const app = await prisma.app.findUnique({
      where: { id: appId },
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 2 },
      },
    });

    if (!app || app.snapshots.length < 2) return 0;

    const [current, previous] = app.snapshots;
    let changesDetected = 0;
    let versionReleaseDate: Date | undefined;

    if (current.version !== previous.version && current.version && app.trackId) {
      try {
        const scraper = new AppStoreScraper();
        const history = await scraper.scrapeVersionHistory(Number(app.trackId));
        const match = history.find((h) => h.version === current.version);
        if (match) versionReleaseDate = new Date(match.date);
      } catch (err) {
        logger.warn(`Failed to resolve release date for ${appId} v${current.version}`, {
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    const fieldsToTrack: Array<{
      field: string;
      getCurrent: () => string | null | undefined;
      getPrevious: () => string | null | undefined;
    }> = [
      {
        field: "title",
        getCurrent: () => current.title,
        getPrevious: () => previous.title,
      },
      {
        field: "subtitle",
        getCurrent: () => current.subtitle,
        getPrevious: () => previous.subtitle,
      },
      {
        field: "description",
        getCurrent: () => current.description,
        getPrevious: () => previous.description,
      },
      {
        field: "version",
        getCurrent: () => current.version,
        getPrevious: () => previous.version,
      },
      {
        field: "rating",
        getCurrent: () => current.rating?.toFixed(2),
        getPrevious: () => previous.rating?.toFixed(2),
      },
      {
        field: "price",
        getCurrent: () => current.price?.toString(),
        getPrevious: () => previous.price?.toString(),
      },
      {
        field: "releaseNotes",
        getCurrent: () => current.releaseNotes,
        getPrevious: () => previous.releaseNotes,
      },
    ];

    for (const { field, getCurrent, getPrevious } of fieldsToTrack) {
      const curVal = getCurrent() ?? null;
      const prevVal = getPrevious() ?? null;

      if (curVal !== prevVal) {
        await prisma.appMetadataChange.create({
          data: {
            appId,
            field,
            oldValue: prevVal ? String(prevVal).substring(0, 5000) : null,
            newValue: curVal ? String(curVal).substring(0, 5000) : null,
            ...(field === "version" && versionReleaseDate ? { detectedAt: versionReleaseDate } : {}),
          },
        });
        changesDetected++;
      }
    }

    if (changesDetected > 0) {
      logger.info(`Detected ${changesDetected} metadata changes for app ${appId}`);
    }

    return changesDetected;
  }

  async detectAllMetadataChanges(
    bundleId: string,
    competitorAppIds?: string[],
  ): Promise<{ apps: number; changes: number }> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId },
      include: {
        competitors: { include: { competitor: true } },
      },
    });

    if (!ownApp) throw new Error(`App not found: ${bundleId}`);

    const relations = competitorAppIds
      ? ownApp.competitors.filter((rel) => competitorAppIds.includes(rel.competitor.id))
      : ownApp.competitors;

    const results = await Promise.all(relations.map((rel) => this.detectMetadataChanges(rel.competitor.id)));

    const totalChanges = results.reduce((sum, n) => sum + n, 0);
    const appsWithChanges = results.filter((n) => n > 0).length;

    return { apps: appsWithChanges, changes: totalChanges };
  }

  async getCompetitorKeywordRankings(
    competitorAppId: string,
    ownBundleId: string,
  ): Promise<
    Array<{
      keyword: string;
      competitorRank: number | null;
      ourRank: number | null;
      popularity: number | null;
    }>
  > {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId: ownBundleId },
    });
    if (!ownApp) return [];

    const keywords = await prisma.keyword.findMany({
      include: {
        rankings: {
          where: {
            appId: { in: [competitorAppId, ownApp.id] },
          },
          orderBy: { trackedAt: "desc" },
        },
      },
    });

    return keywords.map((kw) => {
      const competitorRanking = kw.rankings.find((r) => r.appId === competitorAppId);
      const ourRanking = kw.rankings.find((r) => r.appId === ownApp.id);

      return {
        keyword: kw.term,
        competitorRank: competitorRanking?.rank ?? null,
        ourRank: ourRanking?.rank ?? null,
        popularity: kw.popularity,
      };
    });
  }

  async scrapeMonetizationForAllCompetitors(
    bundleId: string,
    competitorAppIds?: string[],
  ): Promise<{ products: number; apps: number }> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId },
      include: { competitors: { include: { competitor: true } } },
    });

    if (!ownApp) throw new Error(`App not found: ${bundleId}`);

    let products = 0;
    let apps = 0;

    const relations = competitorAppIds
      ? ownApp.competitors.filter((rel) => competitorAppIds.includes(rel.competitor.id))
      : ownApp.competitors;

    for (const rel of relations) {
      const comp = rel.competitor;
      if (!comp.trackId) continue;

      const scraper = new AppStoreScraper(comp.country);
      const items = await scraper.scrapeMonetization(Number(comp.trackId));

      await prisma.$transaction([
        prisma.appInAppPurchase.deleteMany({ where: { appId: comp.id } }),
        ...(items.length
          ? [
              prisma.appInAppPurchase.createMany({
                data: items.map((item, i) => ({
                  appId: comp.id,
                  name: item.name,
                  price: item.price,
                  kind: SUBSCRIPTION_HINT.test(item.name) ? "subscription" : "purchase",
                  position: i,
                })),
              }),
            ]
          : []),
      ]);

      products += items.length;
      apps++;
      await this.sleep(1000);
    }

    logger.info(`Scraped monetization for ${apps} competitors, ${products} products total`);
    return { products, apps };
  }

  async scrapeLanguagesForAllCompetitors(bundleId: string, competitorAppIds?: string[]): Promise<{ apps: number }> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId },
      include: { competitors: { include: { competitor: true } } },
    });

    if (!ownApp) throw new Error(`App not found: ${bundleId}`);

    let apps = 0;
    const scraper = new AppStoreScraper();

    const relations = competitorAppIds
      ? ownApp.competitors.filter((rel) => competitorAppIds.includes(rel.competitor.id))
      : ownApp.competitors;

    for (const rel of relations) {
      const comp = rel.competitor;
      if (!comp.trackId) continue;

      const languages = await scraper.scrapeLanguages(Number(comp.trackId));
      await prisma.app.update({
        where: { id: comp.id },
        data: { supportedLanguages: languages },
      });

      apps++;
      await this.sleep(1000);
    }

    logger.info(`Scraped languages for ${apps} competitors`);
    return { apps };
  }

  async runFullIntelJob(
    bundleId: string,
    competitorAppIds?: string[],
  ): Promise<{
    reviewsScraped: number;
    appsSummarized: number;
    metadataChanges: number;
    monetizationProducts: number;
    languagesScraped: number;
  }> {
    logger.info(
      `Starting ${competitorAppIds ? `scoped (${competitorAppIds.length})` : "full"} competitor intel job for ${bundleId}`,
    );

    const { total: reviewsScraped } = await this.scrapeAllCompetitorReviews(bundleId, competitorAppIds);
    const appsSummarized = await this.summarizeAllCompetitorReviews(bundleId, competitorAppIds);

    const { changes: metadataChanges } = await this.detectAllMetadataChanges(bundleId, competitorAppIds);
    const { products: monetizationProducts } = await this.scrapeMonetizationForAllCompetitors(
      bundleId,
      competitorAppIds,
    );
    const { apps: languagesScraped } = await this.scrapeLanguagesForAllCompetitors(bundleId, competitorAppIds);

    logger.info(
      `Competitor intel complete: ${reviewsScraped} reviews, ${appsSummarized} summaries, ${metadataChanges} changes, ${monetizationProducts} monetization products, ${languagesScraped} apps with languages scraped`,
    );

    return { reviewsScraped, appsSummarized, metadataChanges, monetizationProducts, languagesScraped };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
