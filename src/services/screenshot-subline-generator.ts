import { prisma, logger } from "../config";
import { AIClient } from "./ai-client";
import { LOCALE_MAP, type LocaleConfig } from "./utils/country_lang";

export type ScreenshotSublines = Record<string, Record<string, string>>;

export type ScreenshotSublineMetadata = {
  locale: string;
  name?: string;
  subtitle?: string;
  keywords?: string;
};

function pickPreferredMetadata(metadata: ScreenshotSublineMetadata[]): ScreenshotSublineMetadata | null {
  if (metadata.length === 0) return null;

  return (
    metadata.find((item) => item.locale === "en-US") ??
    metadata.find((item) => item.locale.toLowerCase().startsWith("en-")) ??
    metadata[0]
  );
}

function getLocaleConfig(locale: string): LocaleConfig {
  return (
    LOCALE_MAP[locale] ?? {
      locale,
      language: locale,
      promptLang: locale,
      market: locale,
    }
  );
}

function metadataForLocale(
  locale: string,
  latestVersionMetadata: ScreenshotSublineMetadata[],
): ScreenshotSublineMetadata | undefined {
  const lower = locale.toLowerCase();
  const languageCode = lower.split("-")[0];

  return (
    latestVersionMetadata.find((item) => item.locale.toLowerCase() === lower) ??
    latestVersionMetadata.find((item) => item.locale.toLowerCase().split("-")[0] === languageCode)
  );
}

async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    }),
  );
}

export async function generateScreenshotSublines(
  appId: string,
  descriptions: Record<string, string>,
  detectedLocales: string[],
  latestVersionMetadata: ScreenshotSublineMetadata[] = [],
): Promise<ScreenshotSublines> {
  if (Object.keys(descriptions).length === 0) return {};

  const app = await prisma.app.findUnique({
    where: { id: appId },
    include: {
      rankings: {
        orderBy: { rank: "asc" },
        take: 30,
        include: { keyword: true },
      },
    },
  });
  if (!app) throw new Error(`App ${appId} not found`);

  const preferredMetadata = pickPreferredMetadata(latestVersionMetadata);
  const topKeywords = app.rankings
    .map((r) => ({
      term: r.keyword.term,
      popularity: r.keyword.popularity ?? 0,
    }))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 20);

  const ai = new AIClient();

  if (!ai.hasProvider) {
    throw new Error("No AI provider configured - set OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }

  const screenshotList = Object.entries(descriptions)
    .map(([key, desc]) => `  - ${key}: ${desc}`)
    .join("\n");

  const keywordList = topKeywords.map((k) => `  ${k.term} (popularity: ${k.popularity})`).join("\n");

  const systemPrompt = `
  You are an expert App Store conversion copywriter.
  Your task is to write ultra-concise screenshot sublines that make people download the app:
  1. Are ≤ 30 characters each (HARD LIMIT - space constraints)
  2. Sell the outcome: say what the user gets from what the screenshot shows, not the feature name
  3. Read like a native speaker wrote them - fluent, idiomatic language is more important than anything else; never keyword-stuffed, never robotic
  4. Use sentence case, not ALL CAPS

  You will get a list of search keywords. Treat it as market research only: it tells you what users
  are looking for, so you can speak to that need directly. Work a keyword in only when it fits the
  sentence naturally - mentioning them is optional, fluent copy always wins.

  Respond with valid JSON only - no markdown, no explanation.`;

  try {
    const sublines: ScreenshotSublines = {};
    const uniqueLocales = [...new Set(detectedLocales)];

    await runConcurrent(uniqueLocales, 4, async (locale) => {
      const localeConfig = getLocaleConfig(locale);
      const localeMetadata = metadataForLocale(locale, latestVersionMetadata);
      const contextMetadata = localeMetadata ?? preferredMetadata;

      const userPrompt = `
      App: ${contextMetadata?.name || preferredMetadata?.name || app.name}
      Target locale: ${locale}
      Target language: ${localeConfig.promptLang}
      Target market: ${localeConfig.market}
      Local App Store subtitle: ${localeMetadata?.subtitle || "none"}
      Local App Store keywords: ${localeMetadata?.keywords || "none"}
      Reference locale for meaning only: ${preferredMetadata?.locale ?? "none"}
      Reference subtitle: ${preferredMetadata?.subtitle || "none"}
      Reference keywords: ${preferredMetadata?.keywords || "none"}

      What users search for (inspiration only - address these needs in the sublines; using the terms themselves is optional and they must never be forced into ${localeConfig.promptLang} copy):
      ${keywordList || "  (none tracked yet)"}

      Screenshots to generate sublines for:
      ${screenshotList}

      Generate sublines only for ${locale}.
      Every value MUST be written in ${localeConfig.promptLang}. Do not output English for ${locale} unless ${localeConfig.promptLang} is English or the term is a brand/product name.
      Return JSON in this exact shape:
      {
        "${Object.keys(descriptions)[0] ?? "screenshot_key"}": "Localized subline"
      }

      Include every screenshot key exactly once. Every subline must be ≤ 30 characters.`;

      const response = await ai.query(systemPrompt, userPrompt, {
        maxTokens: 3000,
        jsonMode: true,
        openaiModel: "gpt-5.2",
        anthropicModel: "claude-sonnet-4-6",
      });

      const localeSublines = JSON.parse(response.content) as Record<string, string>;

      for (const [key, text] of Object.entries(localeSublines)) {
        if (text.length > 30) localeSublines[key] = `${text.slice(0, 29)}…`;
      }

      sublines[locale] = localeSublines;
    });

    logger.info(
      `[SublineGen] Generated sublines for ${Object.keys(sublines).length} locale(s), ` +
        `${Object.keys(descriptions).length} screenshot(s)`,
    );
    return sublines;
  } catch (err: any) {
    logger.error(`[SublineGen] AI call failed: ${err.message}`);
    throw err;
  }
}
