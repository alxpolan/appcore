import { prisma, logger } from "../config";
import type { EffectiveSettings } from "../config";
import { AIClient } from "./ai-client";
import { AppStoreScraper } from "./appstore-scraper";
import { ascClientFromSettings } from "./asc-client";
import { langForCountry, localeToCountry } from "./app-store-markets";

export class KeywordDiscoveryAgent {
  private readonly bundleId: string;
  private readonly ai: AIClient;
  private readonly settings?: EffectiveSettings;
  private readonly MIN_POPULARITY = 15;
  private readonly MIN_RESULTS = 3;
  private readonly MAX_SCORE_PER_RUN = 25;
  private readonly MAX_AUTOCOMPLETE_SEEDS = 20;

  constructor(bundleId: string, settings?: EffectiveSettings) {
    this.settings = settings;
    this.ai = new AIClient();
    this.bundleId = bundleId;
    if (!bundleId) {
      logger.warn("[Discovery] No bundle ID provided, discovery will be disabled");
    }
  }

  private async getActiveCountries(): Promise<string[]> {
    const asc = this.settings ? ascClientFromSettings(this.settings) : null;
    if (asc && this.bundleId) {
      try {
        const appRow = await prisma.app.findUnique({
          where: { bundleId: this.bundleId },
          select: { trackId: true },
        });
        const ascAppId = appRow?.trackId?.toString();
        const liveVersion = ascAppId ? await asc.getLiveVersion(ascAppId) : null;
        if (liveVersion) {
          const localizations = await asc.getVersionLocalizations(liveVersion.id);
          const countries = localizations
            .map((loc) => localeToCountry(loc.attributes.locale))
            .filter((c): c is string => c !== null);
          const unique = [...new Set(countries)];
          if (unique.length > 0) {
            logger.info(`[Discovery] Active countries from ASC live version: ${unique.join(", ")}`);
            return unique;
          }
        }
      } catch (error) {
        logger.warn("[Discovery] Could not fetch active countries from ASC, falling back to DB", {
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    const ownApp = this.bundleId ? await prisma.app.findUnique({ where: { bundleId: this.bundleId } }) : null;
    if (ownApp) {
      const rows = await prisma.keywordRanking.findMany({
        where: { appId: ownApp.id },
        select: { country: true },
        distinct: ["country"],
      });
      if (rows.length > 0) {
        return rows.map((r) => r.country);
      }
      return [ownApp.country];
    }

    return ["de"];
  }

  async run(): Promise<{ discovered: number; scored: number; suggested: number }> {
    try {
      if (!this.bundleId) {
        throw new Error("No bundle ID configured, cannot run discovery");
      }

      const countries = await this.getActiveCountries();
      logger.info(`[Discovery] Running for ${countries.length} countries: ${countries.join(", ")}`);

      let totalDiscovered = 0;
      let totalScored = 0;
      let totalSuggested = 0;

      for (const country of countries) {
        const result = await this.discoverForCountry(country);
        totalDiscovered += result.discovered;
        totalScored += result.scored;
        totalSuggested += result.suggested;
      }

      const result = {
        discovered: totalDiscovered,
        scored: totalScored,
        suggested: totalSuggested,
      };

      logger.info(
        `[Discovery] Run complete: ${result.discovered} found, ${result.scored} qualified, ${result.suggested} suggested`,
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  private async discoverForCountry(country: string): Promise<{
    discovered: number;
    scored: number;
    suggested: number;
  }> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId: this.bundleId },
    });
    if (!ownApp) {
      logger.warn(`[Discovery:${country}] Own app not found for ${this.bundleId}, skipping`);
      return { discovered: 0, scored: 0, suggested: 0 };
    }

    const scraper = new AppStoreScraper(country);
    const existingTerms = await this.loadExistingTerms(country);
    const suggestedTerms = await this.loadSuggestedTerms(ownApp.id, country);
    const excludeTerms = new Set([...existingTerms, ...suggestedTerms]);
    logger.info(
      `[Discovery:${country}] Starting – ${existingTerms.size} tracked, ${suggestedTerms.size} already suggested`,
    );

    const [fromCompetitors, fromAutocomplete, fromSemantic] = await Promise.all([
      this.discoverFromCompetitorTexts(existingTerms, country),
      this.discoverFromAutocompleteExpansion(existingTerms, scraper),
      this.discoverFromSemanticExpansion(existingTerms, country),
    ]);

    const candidates = new Set<string>();
    for (const term of [...fromCompetitors, ...fromAutocomplete, ...fromSemantic]) {
      const normalized = term.toLowerCase().trim();
      if (normalized.length >= 3 && !excludeTerms.has(normalized)) {
        candidates.add(normalized);
      }
    }

    logger.info(
      `[Discovery:${country}] ${candidates.size} unique new candidates ` +
        `(competitors=${fromCompetitors.length} autocomplete=${fromAutocomplete.length} semantic=${fromSemantic.length})`,
    );

    const qualified = await this.scoreAndFilter([...candidates], scraper, country);

    const keywordLanguage = langForCountry(country);

    await Promise.all(
      qualified.map((c) =>
        prisma.keywordSuggestion.upsert({
          where: { appId_term_country: { appId: ownApp.id, term: c.term, country } },
          create: {
            appId: ownApp.id,
            term: c.term,
            country,
            language: keywordLanguage,
            popularity: c.popularity,
            difficulty: c.difficulty,
            searchVolume: c.searchVolume,
            status: "PENDING",
          },
          update: {
            popularity: c.popularity,
            difficulty: c.difficulty,
            searchVolume: c.searchVolume,
          },
        }),
      ),
    );

    return {
      discovered: candidates.size,
      scored: qualified.length,
      suggested: qualified.length,
    };
  }

  private async discoverFromCompetitorTexts(existing: Set<string>, country: string): Promise<string[]> {
    const ownApp = await prisma.app.findFirst({
      where: { bundleId: this.bundleId, isOwnApp: true },
      include: {
        competitors: {
          include: {
            competitor: {
              include: {
                snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!ownApp) {
      logger.debug("[Discovery:competitors] Own app not found, skipping");
      return [];
    }

    const competitorData = ownApp.competitors
      .map((rel) => {
        const snap = rel.competitor.snapshots[0];
        return {
          name: rel.competitor.name,
          title: rel.competitor.currentTitle ?? rel.competitor.name,
          subtitle: rel.competitor.currentSubtitle,
          keywords: snap?.keywords,
          description: snap?.description?.substring(0, 400),
        };
      })
      .filter((c) => c.description || c.title);

    if (competitorData.length === 0) {
      logger.debug("[Discovery:competitors] No competitor data available");
      return [];
    }

    const systemPrompt = `You are an App Store Optimization (ASO) keyword research expert.
Extract high-value keyword candidates that real users would type in the App Store search bar.

Rules:
- Respond ONLY with valid JSON: {"keywords": ["term1", "term2", ...]}
- Maximum 25 candidates
- All keywords must be in the language for country code: ${country}
- Exclude brand names and competitor app names
- Exclude any keyword from the "already tracked" list
- Prefer: use cases, problems solved, feature names, category terms, action+noun combinations`;

    const userPrompt = `App being optimized: "${ownApp.name}" (${this.bundleId})

Already tracked keywords (skip these):
${[...existing].slice(0, 60).join(", ")}

Competitor apps:
${competitorData
  .map(
    (c) =>
      `• ${c.name} | title: "${c.title}" | subtitle: "${c.subtitle ?? ""}" | keywords: "${c.keywords ?? ""}" | desc: "${c.description ?? ""}"`,
  )
  .join("\n")}

Return the 25 most valuable keyword candidates not yet tracked. Respond with JSON only.`;

    try {
      const raw = await this.queryAI(systemPrompt, userPrompt);
      return this.parseKeywordArray(raw, "competitors");
    } catch (error) {
      logger.warn("[Discovery:competitors] AI query failed", {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  private async discoverFromAutocompleteExpansion(existing: Set<string>, scraper: AppStoreScraper): Promise<string[]> {
    const seeds = [...existing].slice(0, this.MAX_AUTOCOMPLETE_SEEDS);
    const discovered = new Set<string>();

    for (const seed of seeds) {
      try {
        const suggestions = await scraper.getSearchSuggestions(seed);
        for (const suggestion of suggestions) {
          const normalized = suggestion.toLowerCase().trim();
          if (normalized.length >= 3 && !existing.has(normalized)) {
            discovered.add(normalized);
          }
        }
      } catch {
        logger.debug(`[Discovery:autocomplete] Suggestion fetch failed for seed "${seed}"`);
      }
      await this.sleep(500);
    }

    logger.debug(`[Discovery:autocomplete] ${discovered.size} candidates from ${seeds.length} seeds`);
    return [...discovered];
  }

  private async discoverFromSemanticExpansion(existing: Set<string>, country: string): Promise<string[]> {
    const ownApp = await prisma.app.findFirst({
      where: { bundleId: this.bundleId, isOwnApp: true },
      include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
    });

    if (!ownApp) return [];

    const description = ownApp.snapshots[0]?.description?.substring(0, 400) ?? "";
    const trackedSample = [...existing].slice(0, 50).join(", ");

    const systemPrompt = `You are an ASO keyword strategy expert.
Identify keyword gaps: search terms users would use that are semantically related
to an app but not yet covered by its tracked keyword set.

Rules:
- Respond ONLY with valid JSON: {"keywords": ["term1", "term2", ...]}
- Maximum 20 candidates
- Language: country code ${country}
- No brand names, no duplicates of the tracked list`;

    const userPrompt = `App: "${ownApp.name}"
Description: ${description}

Currently tracked keywords (do NOT repeat):
${trackedSample}

Generate 15–20 keyword gaps. Consider:
- Synonyms and alternative phrasings of existing keywords
- Long-tail variants (e.g. "best X", "X app", "free X", "X for [audience]")
- Problem-based terms ("how to ...", "track my ...")
- Feature-specific terms not yet covered
- Seasonal or trend-adjacent terms

Return JSON only.`;

    try {
      const raw = await this.queryAI(systemPrompt, userPrompt);
      return this.parseKeywordArray(raw, "semantic");
    } catch (error) {
      logger.warn("[Discovery:semantic] AI query failed", {
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  private async scoreAndFilter(
    candidates: string[],
    scraper: AppStoreScraper,
    country: string,
  ): Promise<{ term: string; popularity: number; difficulty: number; searchVolume: number }[]> {
    const toScore = candidates.slice(0, this.MAX_SCORE_PER_RUN);
    const qualified: { term: string; popularity: number; difficulty: number; searchVolume: number }[] = [];

    logger.info(
      `[Discovery:${country}] Scoring ${toScore.length} of ${candidates.length} candidates (min pop=${this.MIN_POPULARITY} min results=${this.MIN_RESULTS})`,
    );

    for (const candidate of toScore) {
      try {
        const { popularity, difficulty, searchVolume } = await scraper.analyzeKeyword(candidate, 25);

        if (popularity >= this.MIN_POPULARITY && searchVolume >= this.MIN_RESULTS) {
          qualified.push({ term: candidate, popularity, difficulty, searchVolume });
          logger.debug(`[Discovery:${country}] ✓ "${candidate}" accepted (pop=${popularity} results=${searchVolume})`);
        } else {
          logger.debug(`[Discovery:${country}] ✗ "${candidate}" rejected (pop=${popularity} results=${searchVolume})`);
        }
      } catch {
        logger.debug(`[Discovery:${country}] Scoring failed for "${candidate}", skipping`);
      }
      await this.sleep(1500);
    }

    logger.info(`[Discovery:${country}] ${qualified.length}/${toScore.length} candidates passed scoring`);
    return qualified;
  }

  private async loadSuggestedTerms(appId: string, country: string): Promise<Set<string>> {
    const suggestions = await prisma.keywordSuggestion.findMany({
      where: { appId, country },
      select: { term: true },
    });
    return new Set(suggestions.map((s) => s.term.toLowerCase()));
  }

  private async loadExistingTerms(country: string): Promise<Set<string>> {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId: this.bundleId },
    });

    const keywords = await prisma.keyword.findMany({
      where: {
        country,
        ...(ownApp ? { rankings: { some: { appId: ownApp.id } } } : {}),
      },
      select: { term: true },
    });
    return new Set(keywords.map((k) => k.term.toLowerCase()));
  }

  private async queryAI(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.ai.query(systemPrompt, userPrompt, {
      temperature: 0.6,
      maxTokens: 1000,
      jsonMode: true,
    });
    return response.content;
  }

  private parseKeywordArray(raw: string, source: string): string[] {
    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed: unknown = JSON.parse(jsonStr);
      let arr: unknown[];

      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        arr =
          (Array.isArray(obj.keywords) && obj.keywords) ||
          (Array.isArray(obj.results) && obj.results) ||
          (Array.isArray(obj.candidates) && obj.candidates) ||
          [];
      } else {
        arr = [];
      }

      const terms = (arr as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((s) => s.toLowerCase().trim())
        .filter((s) => s.length >= 3);

      logger.debug(`[Discovery:${source}] Parsed ${terms.length} candidates`);
      return terms;
    } catch {
      logger.warn(`[Discovery:${source}] Failed to parse AI response as JSON`);
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
