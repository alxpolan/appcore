import axios from "./utils/http";
import { parseStringPromise } from "xml2js";
import { logger } from "../config";
import { normalizeLanguage, storefrontHeaderForCountry } from "./app-store-markets";

interface ITunesResult {
  trackId: number;
  trackName: string;
  bundleId: string;
  sellerName: string;
  description: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price: number;
  version: string;
  minimumOsVersion?: string;
  currentVersionReleaseDate?: string;
  releaseNotes?: string;
  screenshotUrls: string[];
  artworkUrl512: string;
  primaryGenreName: string;
  primaryGenreId: number;
  genres: string[];
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesResult[];
}

export class AppStoreScraperItunes {
  protected readonly baseUrl = "https://itunes.apple.com";
  protected readonly country: string;
  protected readonly language: string;
  protected readonly bundleId: string;

  constructor(country: string = "", language?: string, bundleId: string = "") {
    this.country = country;
    this.bundleId = bundleId;
    this.language = normalizeLanguage(language, this.country);
  }

  async searchApps(term: string, limit = 25): Promise<ITunesResult[]> {
    const url = `${this.baseUrl}/search`;
    const { data } = await axios.get<ITunesSearchResponse>(url, {
      params: {
        term,
        country: this.country,
        media: "software",
        limit,
        lang: this.language,
      },
    });

    logger.debug(`Search "${term}" returned ${data.resultCount} results`);

    return data.results;
  }

  async getSearchSuggestions(term: string): Promise<string[]> {
    const storeFront = storefrontHeaderForCountry(this.country);
    const url = `https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints`;
    try {
      const { data: xml } = await axios.get<string>(url, {
        params: { term, media: "software" },
        headers: {
          "X-Apple-Store-Front": storeFront,
          "User-Agent": "iTunes/12.0",
        },
        timeout: 5000,
      });

      const parsed = await parseStringPromise(xml, { explicitArray: false });
      const dict = parsed?.plist?.dict;
      if (!dict) return [];

      const hintsKey = Array.isArray(dict.key) ? dict.key : [dict.key];
      const hintsVal = Array.isArray(dict.array?.dict) ? dict.array.dict : dict.array?.dict ? [dict.array.dict] : [];

      return hintsVal
        .map((h: any) => {
          const strings = Array.isArray(h.string) ? h.string : [h.string];

          return strings[0];
        })
        .filter(Boolean);
    } catch (error) {
      logger.debug(`Search suggestions for "${term}" failed: ${error instanceof Error ? error.message : error}`);

      return [];
    }
  }

  async analyzeKeyword(
    term: string,
    limit = 50,
  ): Promise<{
    results: ITunesResult[];
    popularity: number;
    difficulty: number;
    searchVolume: number;
  }> {
    const [results, suggestions] = await Promise.all([this.searchApps(term, limit), this.getSearchSuggestions(term)]);
    const resultCount = results.length;
    const termLower = term.toLowerCase();

    const exactIndex = suggestions.findIndex((s) => s.toLowerCase() === termLower);
    const prefixIndex = suggestions.findIndex((s) => s.toLowerCase().startsWith(termLower));
    const containsIndex = suggestions.findIndex((s) => s.toLowerCase().includes(termLower));

    let positionScore: number;

    if (exactIndex === 0) {
      positionScore = 25;
    } else if (exactIndex === 1) {
      positionScore = 22;
    } else if (exactIndex === 2) {
      positionScore = 19;
    } else if (exactIndex >= 3) {
      positionScore = Math.max(8, 16 - exactIndex * 2);
    } else if (prefixIndex === 0) {
      positionScore = 14;
    } else if (prefixIndex >= 1) {
      positionScore = Math.max(6, 12 - prefixIndex * 2);
    } else if (containsIndex >= 0) {
      positionScore = Math.max(2, Math.round(8 - containsIndex * 1.5));
    } else if (suggestions.length > 0) {
      positionScore = 2;
    } else {
      positionScore = 0;
    }

    const suggestionBonus = Math.min(5, Math.ceil(suggestions.length / 2));
    const autocompleteScore = Math.min(30, Math.round(positionScore + suggestionBonus));

    const depthScore = resultCount === 0 ? 0 : Math.round(25 * (1 - Math.exp(-resultCount / 15)));

    const weightedRatings = results
      .slice(0, 20)
      .reduce((sum, r, i) => sum + (r.userRatingCount ?? 0) / (1 + i * 0.3), 0);
    const engagementScore = weightedRatings > 0 ? Math.min(30, Math.round(Math.log10(weightedRatings + 1) * 5)) : 0;

    const qualifiedApps = results.slice(0, 10).filter((r) => (r.userRatingCount ?? 0) >= 500).length;
    const qualityScore = Math.min(15, Math.round(qualifiedApps * 1.5));

    let popularityMultiplier = 1.0;

    if (resultCount <= 4 && results.length > 0) {
      const firstApp = results[0]?.trackName?.toLowerCase() ?? "";
      const firstWord = firstApp.split(/\s+/)[0] ?? "";
      const isBrandLike =
        firstApp === termLower ||
        firstApp.startsWith(termLower) ||
        termLower.startsWith(firstWord) ||
        this.stringSimilarity(termLower, firstApp) > 0.75;

      if (isBrandLike) {
        popularityMultiplier = 0.4;
      }
    }

    const rawPopularity = autocompleteScore + depthScore + engagementScore + qualityScore;
    const popularity = Math.min(100, Math.max(1, Math.round(rawPopularity * popularityMultiplier)));

    const top3 = results.slice(0, 3);
    const top10 = results.slice(0, 10);

    const top3AvgRatings = top3.length > 0 ? top3.reduce((s, r) => s + (r.userRatingCount ?? 0), 0) / top3.length : 0;
    const top10AvgRatings =
      top10.length > 0 ? top10.reduce((s, r) => s + (r.userRatingCount ?? 0), 0) / top10.length : 0;

    const top10MaxRatings = top10.length > 0 ? Math.max(...top10.map((r) => r.userRatingCount ?? 0)) : 0;

    const blendedAvgRatings = top3AvgRatings * 0.6 + top10AvgRatings * 0.4;
    const baseDifficulty = Math.round((Math.log10(blendedAvgRatings + 10) - 1) * 20);

    const dominanceBonus =
      top10MaxRatings > 5_000_000 ? 8 : top10MaxRatings > 1_000_000 ? 5 : top10MaxRatings > 100_000 ? 2 : 0;

    const difficulty = Math.min(100, Math.max(1, baseDifficulty + dominanceBonus));

    const searchVolume = resultCount;

    logger.debug(
      `Keyword "${term}": popularity=${popularity} ` +
        `(ac=${autocompleteScore} depth=${depthScore} eng=${engagementScore} qual=${qualityScore} ` +
        `exactIdx=${exactIndex} prefixIdx=${prefixIndex} results=${resultCount} mult=${popularityMultiplier}), ` +
        `difficulty=${difficulty} (blendedAvg=${Math.round(blendedAvgRatings)} domBonus=${dominanceBonus}), ` +
        `volume=${searchVolume}`,
    );

    return { results, popularity, difficulty, searchVolume };
  }

  async lookupByBundleId(bundleId: string): Promise<ITunesResult | null> {
    const url = `${this.baseUrl}/lookup`;
    const { data } = await axios.get<ITunesSearchResponse>(url, {
      params: {
        bundleId,
        country: this.country,
        lang: this.language,
      },
    });

    return data.results[0] ?? null;
  }

  async lookupByTrackId(trackId: number): Promise<ITunesResult | null> {
    const url = `${this.baseUrl}/lookup`;
    const { data } = await axios.get<ITunesSearchResponse>(url, {
      params: {
        id: trackId,
        country: this.country,
        lang: this.language,
      },
    });

    return data.results[0] ?? null;
  }

  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigrams = (s: string): Map<string, number> => {
      const map = new Map<string, number>();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.slice(i, i + 2);

        map.set(bg, (map.get(bg) ?? 0) + 1);
      }

      return map;
    };

    const aMap = bigrams(a);
    const bMap = bigrams(b);
    let intersection = 0;
    for (const [bg, count] of aMap) {
      intersection += Math.min(count, bMap.get(bg) ?? 0);
    }

    return (2 * intersection) / (a.length - 1 + b.length - 1);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
