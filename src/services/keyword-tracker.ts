import { prisma, logger, env } from "../config";
import type { EffectiveSettings } from "../config";
import { AppStoreScraper } from "./appstore-scraper";
import { AppleSearchAdsClient } from "./search-ads";
import { normalizeLanguage } from "./app-store-markets";

export class KeywordTracker {
  private searchAds: AppleSearchAdsClient | null = null;
  private searchAdsPopularity: Map<string, number> | null = null;
  private readonly bundleId: string;
  private readonly country: string;

  constructor(bundleId: string, country: string, settings?: EffectiveSettings) {
    this.bundleId = bundleId;
    this.country = country;

    if (!bundleId || !country) {
      logger.warn("[KeywordTracker] No bundleId or country provided, keyword tracking will be limited");
    }

    if (env.APPLE_ADS_CLIENT_ID) {
      this.searchAds = new AppleSearchAdsClient();
    }
  }

  private async fetchSearchAdsData(): Promise<Map<string, number>> {
    if (this.searchAdsPopularity) return this.searchAdsPopularity;

    this.searchAdsPopularity = new Map();

    if (!this.searchAds) {
      logger.debug("Search Ads not configured, skipping popularity fetch");

      return this.searchAdsPopularity;
    }

    try {
      logger.info("Fetching keyword popularity from Apple Search Ads API...");
      const ownApp = await prisma.app.findUnique({
        where: { bundleId: this.bundleId },
        select: { trackId: true },
      });

      const ascAppId = ownApp?.trackId?.toString() ?? "";

      if (!ascAppId) {
        logger.debug("No trackId for app, skipping Search Ads popularity fetch");

        return this.searchAdsPopularity;
      }

      const keywords = await this.searchAds.getTargetingKeywords(ascAppId, 200);

      for (const kw of keywords) {
        this.searchAdsPopularity.set(kw.keyword.toLowerCase(), kw.popularity);
      }

      logger.info(`Got popularity data for ${keywords.length} keywords from Search Ads`);
    } catch (error) {
      logger.warn("Failed to fetch Search Ads data, will use estimates", {
        error: error instanceof Error ? error.message : error,
      });
    }

    return this.searchAdsPopularity;
  }

  async addKeywords(terms: string[], country = this.country, language?: string): Promise<number> {
    const lang = normalizeLanguage(language, country);
    const normalized = terms.map((t) => t.toLowerCase().trim()).filter(Boolean);

    await Promise.all(
      normalized.map((term) =>
        prisma.keyword.upsert({
          where: { term_country: { term, country } },
          create: { term, country, language: lang },
          update: {},
        }),
      ),
    );

    logger.info(`Added/verified ${normalized.length} keywords for tracking`);

    return normalized.length;
  }

  async trackKeywordRanking(keywordTerm: string, country = this.country): Promise<number | null> {
    const keyword = await prisma.keyword.findUnique({
      where: { term_country: { term: keywordTerm, country } },
    });

    if (!keyword) {
      logger.warn(`Keyword "${keywordTerm}" not found in database`);

      return null;
    }

    const normalizedLanguage = normalizeLanguage(keyword.language, country);

    if (normalizedLanguage !== keyword.language) {
      await prisma.keyword.update({
        where: { id: keyword.id },
        data: { language: normalizedLanguage },
      });
      logger.info(
        `Normalized keyword language for "${keyword.term}" (${country}) from "${keyword.language}" to "${normalizedLanguage}"`,
      );
    }

    const scraper = new AppStoreScraper(country, normalizedLanguage);
    const { results, popularity, difficulty, searchVolume } = await scraper.analyzeKeyword(keywordTerm, 50);

    const searchAdsData = await this.fetchSearchAdsData();
    const realPopularity = searchAdsData.get(keywordTerm.toLowerCase());
    const finalPopularity = realPopularity ?? popularity;

    await prisma.keyword.update({
      where: { id: keyword.id },
      data: {
        popularity: finalPopularity,
        difficulty,
        searchVolume,
      },
    });

    if (realPopularity != null) {
      logger.debug(`Keyword "${keywordTerm}": Search Ads popularity = ${realPopularity}`);
    }

    const ownApp = await prisma.app.findUnique({
      where: { bundleId: this.bundleId },
    });

    if (!ownApp) {
      logger.warn("Own app not in database yet");

      return null;
    }

    const rank = results.findIndex((r) => r.bundleId === this.bundleId) + 1 || null;

    await prisma.keywordRanking.create({
      data: {
        keywordId: keyword.id,
        appId: ownApp.id,
        rank,
        country,
      },
    });

    if (results.length > 0) {
      await prisma.keywordSearchResult.createMany({
        data: results.map((r, i) => ({
          keywordId: keyword.id,
          rank: i + 1,
          trackId: r.trackId != null ? BigInt(r.trackId) : null,
          bundleId: r.bundleId,
          name: r.trackName,
          iconUrl: r.artworkUrl512 ?? null,
          country,
        })),
      });
    }

    logger.info(`Keyword "${keywordTerm}": our rank = ${rank ?? "not ranked"}`);

    return rank;
  }

  async trackAllKeywords(): Promise<Map<string, number | null>> {
    const rankings = new Map<string, number | null>();

    try {
      const ownApp = await prisma.app.findUnique({
        where: { bundleId: this.bundleId },
      });

      const keywords = await prisma.keyword.findMany({
        where: ownApp ? { rankings: { some: { appId: ownApp.id } } } : {},
      });

      for (const keyword of keywords) {
        const rank = await this.trackKeywordRanking(keyword.term, keyword.country);

        rankings.set(`${keyword.term}@${keyword.country}`, rank);

        await new Promise((r) => setTimeout(r, 1500));
      }

      logger.info(`Tracked ${keywords.length} keywords`);
    } catch (error) {
      throw error;
    }

    return rankings;
  }

  async getRankingHistory(
    keywordTerm: string,
    days = 30,
  ): Promise<Array<{ date: Date; rank: number | null; appName: string }>> {
    const since = new Date();

    since.setDate(since.getDate() - days);

    const keyword = await prisma.keyword.findFirst({
      where: { term: keywordTerm },
    });

    if (!keyword) return [];

    const rankings = await prisma.keywordRanking.findMany({
      where: {
        keywordId: keyword.id,
        trackedAt: { gte: since },
      },
      include: { app: true },
      orderBy: { trackedAt: "asc" },
    });

    return rankings.map((r) => ({
      date: r.trackedAt,
      rank: r.rank,
      appName: r.app.name,
    }));
  }

  async getCurrentRankingSummary(): Promise<
    Array<{
      keyword: string;
      ourRank: number | null;
      popularity: number | null;
      topCompetitor?: string;
      topCompetitorRank?: number;
    }>
  > {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId: this.bundleId },
    });

    if (!ownApp) return [];

    const keywords = await prisma.keyword.findMany({
      where: { country: this.country },
      include: {
        rankings: {
          orderBy: { trackedAt: "desc" },
          take: 50,
          include: { app: true },
        },
      },
    });

    return keywords.map((kw) => {
      const ourRanking = kw.rankings.find((r) => r.appId === ownApp.id);
      const competitorRankings = kw.rankings
        .filter((r) => r.appId !== ownApp.id && r.rank !== null)
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

      return {
        keyword: kw.term,
        ourRank: ourRanking?.rank ?? null,
        popularity: kw.popularity,
        topCompetitor: competitorRankings[0]?.app?.name,
        topCompetitorRank: competitorRankings[0]?.rank ?? undefined,
      };
    });
  }
}
