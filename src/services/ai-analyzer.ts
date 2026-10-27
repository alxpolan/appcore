import { prisma, logger } from "../config";
import { AIClient } from "./ai-client";
import type { AIResponse } from "./ai-client";
import { SuggestionType, SuggestionStatus } from "@prisma/client";
import { LOCALE_MAP, LocaleConfig } from "./utils/country_lang";

function getLocaleConfig(locale: string): LocaleConfig {
  return (
    LOCALE_MAP[locale] ?? {
      locale,
      language: locale,
      promptLang: "English",
      market: locale,
    }
  );
}

const TRANSLATION_OPENAI_MODEL = "gpt-5.5";

function parseTranslationJson(content: string): Record<string, string> | null {
  try {
    const match = content.trim().match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
  }

  return null;
}

interface ASOAnalysis {
  titleSuggestions: Array<{
    value: string;
    reasoning: string;
    confidence: number;
  }>;
  subtitleSuggestions: Array<{
    value: string;
    reasoning: string;
    confidence: number;
  }>;
  keywordSuggestions: Array<{
    value: string;
    reasoning: string;
    confidence: number;
  }>;
  descriptionSuggestions: Array<{
    value: string;
    reasoning: string;
    confidence: number;
  }>;
  competitorInsights: string;
  overallStrategy: string;
}

export class AIAnalyzer {
  private readonly ai: AIClient;
  private readonly bundleId: string;

  constructor(bundleId: string) {
    this.bundleId = bundleId;
    this.ai = new AIClient();

    if (!this.ai.hasProvider) {
      logger.warn("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
    }
  }

  async translateLocalization(
    sourceLocale: string,
    targetLocale: string,
    sourceFields: Partial<
      Record<"name" | "subtitle" | "keywords" | "description" | "promotionalText" | "whatsNew", string>
    >,
  ): Promise<Record<string, string>> {
    const sourceConfig = getLocaleConfig(sourceLocale);
    const targetConfig = getLocaleConfig(targetLocale);
    const fieldsToTranslate = Object.entries(sourceFields).filter(([, v]) => v && v.trim()) as [string, string][];
    if (fieldsToTranslate.length === 0) return {};
    const hasKeywords = "keywords" in sourceFields;

    const systemPrompt = `
    You are a native ${targetConfig.language} App Store copywriter for the ${targetConfig.market} market.
    You have been given the ${sourceConfig.language} source for reference only — to understand the meaning, structure and tone. Do NOT translate word-for-word. 
    Write the ${targetConfig.language} version as if you were briefed on what the app does and wrote the copy fresh in ${targetConfig.language} from the start.

    Quality bar:
    - Native, idiomatic phrasing. Fix awkward word order, literal translations, stiffness.
    - Match the marketing register of top apps in the ${targetConfig.market} App Store: clear, punchy, benefit-driven.
    - Cultural fit: localize idioms, examples and tone — do not translate them word-for-word.
    - Preserve meaning, feature claims and any concrete numbers/units. Never invent facts.
    - Keep brand names, trademarks and proper nouns untranslated. Keep emojis and formatting (line breaks, bullet markers) exactly as in the source.

    Strict App Store rules (hard limits):
    - name: max 30 characters
    - subtitle: max 30 characters
    - keywords: max 100 characters TOTAL, comma-separated, NO spaces after commas (spaces allowed inside multi-word phrases). No duplicates of words used in name/subtitle. No generic filler ("app", "the"), no plurals of words already covered, no special characters (#, @), no competitor or trademarked names.
    - description: max 4000 characters. PRESERVE the full length, structure and every detail of the source. Translate paragraph-for-paragraph. Do NOT summarize, shorten, merge or drop anything.
    - promotionalText: max 170 characters
    - whatsNew: max 4000 characters. PRESERVE the full length and every detail. Do NOT summarize.

    Output:
    - Return a single JSON object with EXACTLY the same keys as the input — no extra keys, no missing keys.
    - Values are the final, ready-to-publish ${targetConfig.language} text.
    - No markdown fences, no comments, no explanations.`;

    const keywordHint = hasKeywords
      ? `\nFor "keywords": output search terms a native ${targetConfig.promptLang} user would actually type in the ${targetConfig.market} App Store — not literal translations of the source keywords. Stay ≤100 chars total, comma-separated, no spaces after commas.`
      : "";

    const userPrompt = `
    Translate and localize the following App Store metadata from ${sourceConfig.language} into ${targetConfig.language} for the ${targetConfig.market} market. Return JSON only, with the same keys as the input.${keywordHint}

    INPUT:
    ${JSON.stringify(Object.fromEntries(fieldsToTranslate), null, 2)}`;

    logger.info(`Translation (single ${TRANSLATION_OPENAI_MODEL} pass) ${sourceLocale} → ${targetLocale}`);

    const response = await this.ai.query(systemPrompt, userPrompt, {
      openaiModel: TRANSLATION_OPENAI_MODEL,
      temperature: 1,
      maxTokens: 8000,
      jsonMode: true,
    });

    const parsed = parseTranslationJson(response.content);

    if (!parsed) {
      logger.warn("Translation produced no valid JSON", { content: response.content.substring(0, 500) });

      return {};
    }

    return parsed;
  }

  async analyzeAndSuggest(locales?: string[]): Promise<Map<string, ASOAnalysis>> {
    const targetLocales = locales ?? ["en-US"];
    const results = new Map<string, ASOAnalysis>();
    const appData = await this.gatherAppData();

    const analyses = await Promise.all(
      targetLocales.map(async (locale) => {
        logger.info(`Running AI ASO analysis for locale: ${locale}`);
        try {
          return {
            locale,
            analysis: await this.analyzeForLocale(locale, appData),
          };
        } catch (error) {
          logger.error(`AI analysis failed for locale ${locale}`, {
            error: error instanceof Error ? error.message : error,
          });

          return null;
        }
      }),
    );

    for (const item of analyses) {
      if (item) results.set(item.locale, item.analysis);
    }

    return results;
  }

  private async gatherAppData() {
    const ownApp = await prisma.app.findUnique({
      where: { bundleId: this.bundleId },
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
        competitors: {
          include: {
            competitor: {
              include: {
                snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
              },
            },
          },
        },
        rankings: {
          orderBy: { trackedAt: "desc" },
          take: 50,
          include: { keyword: true },
        },
      },
    });

    if (!ownApp) {
      throw new Error("Own app not found. Run scrape first.");
    }

    return ownApp;
  }

  private async analyzeForLocale(
    locale: string,
    ownApp: Awaited<ReturnType<typeof this.gatherAppData>>,
  ): Promise<ASOAnalysis> {
    const lc = getLocaleConfig(locale);
    const ownSnapshot = ownApp.snapshots[0];

    const competitorData = ownApp.competitors.map((rel) => ({
      name: rel.competitor.name,
      title: rel.competitor.currentTitle,
      subtitle: rel.competitor.currentSubtitle,
      description: rel.competitor.snapshots[0]?.description?.substring(0, 500),
      rating: rel.competitor.snapshots[0]?.rating,
      ratingsCount: rel.competitor.snapshots[0]?.ratingsCount,
    }));

    const keywordData = ownApp.rankings.map((r) => ({
      keyword: r.keyword.term,
      rank: r.rank,
      popularity: r.keyword.popularity,
      difficulty: r.keyword.difficulty,
    }));

    const systemPrompt = `You are an expert App Store Optimization (ASO) specialist.
You analyze app metadata, competitor apps, and keyword rankings to generate
data-driven optimization suggestions.

TARGET LOCALE: ${locale} (${lc.language})
TARGET MARKET: ${lc.market} market

CRITICAL RULES:
- App title: max 30 characters
- Subtitle: max 30 characters
- Keywords: max 100 characters total, comma-separated, NO spaces after commas, spaces allowed within multi-word phrases (e.g. "real estate,house search")
- Keyword rules (Apple policy):
  * Do NOT repeat words already in the app name, subtitle, or category
  * Do NOT use plurals of already included words ("climb" covers "climbs")
  * Do NOT use generic terms ("app", "game"), filler words ("the", "to"), or special characters (#, @)
  * Do NOT include competitor app names, trademarked terms, or irrelevant/offensive terms
  * Maximize unique terms — every character counts
- Description: iOS descriptions are NOT indexed by the App Store algorithm — they affect conversion only, not search ranking
  * Use the full 4000 characters for conversion: features, benefits, social proof, use cases, CTAs
  * First ~250 characters (before "more" fold) are critical — hook the user with the core value proposition
  * Do NOT stuff keywords for SEO purposes; write for humans, not algorithms
- ALL suggestions (title, subtitle, keywords, description) MUST be written in ${lc.promptLang}
- Use keywords natural in title and subtitle
- Analyze what works for competitors
- Optimize specifically for the ${lc.market} market and ${lc.promptLang}-speaking users
- Consider cultural nuances and local search behavior

ALWAYS respond as valid JSON in this format:
{
  "titleSuggestions": [{"value": "...", "reasoning": "...", "confidence": 0.0-1.0}],
  "subtitleSuggestions": [{"value": "...", "reasoning": "...", "confidence": 0.0-1.0}],
  "keywordSuggestions": [{"value": "...", "reasoning": "...", "confidence": 0.0-1.0}],
  "descriptionSuggestions": [{"value": "...", "reasoning": "...", "confidence": 0.0-1.0}],
  "competitorInsights": "...",
  "overallStrategy": "..."
}

IMPORTANT - "value" fields must ALWAYS contain the final, ready-to-use text:
- titleSuggestions.value: the actual title text (e.g. "KalBuddy - Calorie Tracker")
- subtitleSuggestions.value: the actual subtitle text (e.g. "Track Macros & Lose Weight")
- keywordSuggestions.value: the actual keyword string (e.g. "calorie,macro,diet,weight loss")
- descriptionSuggestions.value: the complete app store description text, ready to copy-paste into App Store Connect. Write it as marketing copy, NOT as advice or bullet points about what to change.
- "reasoning" is for your analysis/explanation, never for the actual suggestion content.

Write ALL suggestion values in ${lc.promptLang}. Reasoning can be in English.`;

    const userPrompt = `Analyze this app and generate ASO suggestions for ${lc.language} (${locale}):

## OUR APP
Name: ${ownApp.name}
Bundle ID: ${ownApp.bundleId}
Current Title: ${ownApp.currentTitle}
Current Subtitle: ${ownApp.currentSubtitle ?? "none"}
Current Keywords: ${ownApp.currentKeywords ?? "not available"}
Current Description (excerpt): ${ownSnapshot?.description?.substring(0, 800) ?? "not available"}
Rating: ${ownSnapshot?.rating ?? "?"} (${ownSnapshot?.ratingsCount ?? "?"} ratings)

## KEYWORD RANKINGS
${
  keywordData.length > 0
    ? keywordData
        .map(
          (k) =>
            `- "${k.keyword}": Rank ${k.rank ?? "unranked"} (Popularity: ${k.popularity ?? "?"}, Difficulty: ${k.difficulty ?? "?"})`,
        )
        .join("\n")
    : "No keywords tracked yet"
}

## COMPETITOR APPS (${competitorData.length} apps)
${competitorData
  .map(
    (c) => `### ${c.name}
Title: ${c.title}
Subtitle: ${c.subtitle ?? "-"}
Description (excerpt): ${c.description ?? "-"}
Rating: ${c.rating ?? "?"} (${c.ratingsCount ?? "?"} ratings)`,
  )
  .join("\n\n")}

Generate detailed ASO optimization suggestions in ${lc.promptLang} for the ${lc.market} market.`;

    const response = await this.ai.query(systemPrompt, userPrompt, {
      temperature: 0.7,
      maxTokens: 10000,
      jsonMode: true,
    });

    let analysis: ASOAnalysis;
    try {
      let jsonStr = response.content;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);

      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      analysis = JSON.parse(jsonStr);
    } catch (error) {
      logger.error(`Failed to parse AI response as JSON for locale ${locale}`, {
        content: response.content.substring(0, 200),
      });
      throw new Error("AI response was not valid JSON");
    }

    await this.saveSuggestions(analysis, response, locale);

    logger.info(`ASO analysis complete for ${locale}`, {
      titles: analysis.titleSuggestions.length,
      subtitles: analysis.subtitleSuggestions.length,
      keywords: analysis.keywordSuggestions.length,
      descriptions: analysis.descriptionSuggestions.length,
    });

    return analysis;
  }

  private async saveSuggestions(analysis: ASOAnalysis, aiResponse: AIResponse, locale: string): Promise<void> {
    const suggestions = [
      ...analysis.titleSuggestions.map((s) => ({
        type: SuggestionType.TITLE as SuggestionType,
        ...s,
      })),
      ...analysis.subtitleSuggestions.map((s) => ({
        type: SuggestionType.SUBTITLE as SuggestionType,
        ...s,
      })),
      ...analysis.keywordSuggestions.map((s) => ({
        type: SuggestionType.KEYWORDS as SuggestionType,
        ...s,
      })),
      ...analysis.descriptionSuggestions.map((s) => ({
        type: SuggestionType.DESCRIPTION as SuggestionType,
        ...s,
      })),
    ];

    const appBundleId = this.bundleId;
    await Promise.all(
      suggestions.map((suggestion) =>
        prisma.aSOSuggestion.create({
          data: {
            type: suggestion.type,
            locale,
            appBundleId,
            suggestedValue: suggestion.value,
            reasoning: suggestion.reasoning,
            confidenceScore: suggestion.confidence,
            status: SuggestionStatus.PENDING,
            aiProvider: aiResponse.provider,
            aiModel: aiResponse.model,
            promptTokens: aiResponse.promptTokens,
            completionTokens: aiResponse.completionTokens,
          },
        }),
      ),
    );

    logger.info(`Saved ${suggestions.length} ASO suggestions for locale ${locale}`);
  }

  async extractKeywordsFromCompetitors(): Promise<Array<{ keyword: string; frequency: number; relevance: number }>> {
    const competitors = await prisma.app.findMany({
      where: { isOwnApp: false },
      include: { snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 } },
    });

    const descriptions = competitors
      .map((c) => ({
        name: c.name,
        title: c.currentTitle ?? "",
        subtitle: c.currentSubtitle ?? "",
        description: c.snapshots[0]?.description?.substring(0, 500) ?? "",
      }))
      .filter((c) => c.description.length > 0);

    if (descriptions.length === 0) {
      logger.warn("No competitor data available for keyword extraction");

      return [];
    }

    const systemPrompt = `Du bist ein ASO-Keyword-Analyst. Extrahiere die wichtigsten Keywords 
aus den Konkurrenz-App-Beschreibungen. Fokus auf den deutschen Markt.

Antworte als JSON:
{
  "keywords": [
    {"keyword": "...", "frequency": 1-10, "relevance": 0.0-1.0}
  ]
}`;

    const userPrompt = `Analysiere diese Konkurrenz-Apps und extrahiere die wichtigsten ASO-Keywords:

${descriptions
  .map(
    (d) => `## ${d.name}
Titel: ${d.title}
Untertitel: ${d.subtitle}
Beschreibung: ${d.description}`,
  )
  .join("\n\n")}

Extrahiere die 30 wichtigsten Keywords/Suchbegriffe die Nutzer verwenden würden.`;

    const response = await this.ai.query(systemPrompt, userPrompt, {
      jsonMode: true,
    });

    try {
      let jsonStr = response.content;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      const parsed = JSON.parse(jsonStr);

      return parsed.keywords ?? [];
    } catch {
      logger.error("Failed to parse keyword extraction response");

      return [];
    }
  }
}
