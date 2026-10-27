import Anthropic from "@anthropic-ai/sdk";
import { prisma, logger } from "../config";
import { env } from "../config/env";
import { ASOMemory } from "./memory";
import type { AsoExperiment } from "@prisma/client";

interface AISuggestion {
  type: string;
  from_value: string;
  to_value: string;
  reason: string;
  confidence: number;
  expected_rank_improvement?: number;
}

export class ASOBrain {
  private memory: ASOMemory;
  private static readonly MAX_RETRIES = 2;
  private static readonly CONFIDENCE_THRESHOLD = 0.65;

  constructor(memory?: ASOMemory) {
    this.memory = memory ?? new ASOMemory();
  }

  async analyze(appId: string, userId: string): Promise<AsoExperiment[]> {
    logger.info(`[ASOBrain] Starting analysis for app ${appId}`);

    const app = await prisma.app.findUniqueOrThrow({
      where: { id: appId },
      include: {
        snapshots: { orderBy: { scrapedAt: "desc" }, take: 1 },
        competitors: {
          include: { competitor: true },
        },
      },
    });

    const latestSnapshot = app.snapshots[0];
    const category = latestSnapshot?.category ?? "Unknown";

    const metadata = {
      title: app.currentTitle ?? latestSnapshot?.title ?? "",
      subtitle: app.currentSubtitle ?? latestSnapshot?.subtitle ?? "",
      keywords: app.currentKeywords ?? "",
    };

    const thirtyDaysAgo = new Date();

    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rankings = await prisma.keywordRanking.findMany({
      where: { appId },
      include: { keyword: true },
      orderBy: { trackedAt: "desc" },
    });

    const keywordMap = new Map<
      string,
      {
        term: string;
        rankCurrent: number | null;
        rank30dAgo: number | null;
        volume: number | null;
        popularity: number | null;
      }
    >();

    for (const r of rankings) {
      const existing = keywordMap.get(r.keywordId);

      if (!existing) {
        keywordMap.set(r.keywordId, {
          term: r.keyword.term,
          rankCurrent: r.rank,
          rank30dAgo: null,
          volume: r.keyword.searchVolume,
          popularity: r.keyword.popularity,
        });
      } else if (!existing.rank30dAgo && r.trackedAt <= thirtyDaysAgo) {
        existing.rank30dAgo = r.rank;
      }
    }

    const keywords = [...keywordMap.values()]
      .sort((a, b) => (a.rankCurrent ?? 999) - (b.rankCurrent ?? 999))
      .slice(0, 50);

    const history = await this.memory.getHistory(appId, 90);
    const ourKeywordTerms = new Set(keywords.map((k) => k.term.toLowerCase()));
    const competitorAppIds = app.competitors.map((c) => c.competitorId);

    let competitorKeywords: { term: string; appsUsing: number }[] = [];

    if (competitorAppIds.length > 0) {
      const compRankings = await prisma.keywordRanking.findMany({
        where: {
          appId: { in: competitorAppIds },
          rank: { not: null, lte: 50 },
        },
        include: { keyword: true },
        orderBy: { trackedAt: "desc" },
      });

      const compKeywordCount = new Map<string, Set<string>>();
      for (const r of compRankings) {
        const term = r.keyword.term.toLowerCase();
        if (ourKeywordTerms.has(term)) continue;
        if (!compKeywordCount.has(term)) compKeywordCount.set(term, new Set());
        compKeywordCount.get(term)!.add(r.appId);
      }

      competitorKeywords = [...compKeywordCount.entries()]
        .map(([term, apps]) => ({ term, appsUsing: apps.size }))
        .sort((a, b) => b.appsUsing - a.appsUsing)
        .slice(0, 30);
    }

    const prompt = this.buildPrompt(
      app,
      category,
      metadata,
      keywords,
      history,
      competitorKeywords,
    );

    if (!env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured. Required for ASOBrain.");
    }

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const suggestions = await this.callAI(anthropic, prompt);
    const qualified = suggestions.filter(
      (s) => s.confidence >= ASOBrain.CONFIDENCE_THRESHOLD,
    );

    logger.info(
      `[ASOBrain] AI returned ${suggestions.length} suggestions, ` +
        `${qualified.length} passed confidence threshold (≥ ${ASOBrain.CONFIDENCE_THRESHOLD})`,
    );

    const saved: AsoExperiment[] = [];
    for (const s of qualified) {
      const experiment = await this.memory.saveExperiment({
        appId,
        type: s.type,
        fromValue: s.from_value,
        toValue: s.to_value,
        reason: s.reason,
        confidence: s.confidence,
      });

      saved.push(experiment);
    }

    logger.info(
      `[ASOBrain] Analysis complete for app ${appId}: ${saved.length} experiments created`,
    );

    return saved;
  }

  private buildPrompt(
    app: { name: string; bundleId: string },
    category: string,
    metadata: { title: string; subtitle: string; keywords: string },
    keywords: {
      term: string;
      rankCurrent: number | null;
      rank30dAgo: number | null;
      volume: number | null;
      popularity: number | null;
    }[],
    history: AsoExperiment[],
    competitorKeywords: { term: string; appsUsing: number }[],
  ): string {
    const keywordLines = keywords
      .map(
        (k) =>
          `- "${k.term}": Rang ${k.rankCurrent ?? "nicht gerankt"} ` +
          `(vorher: ${k.rank30dAgo ?? "N/A"}, Volume: ${k.popularity ?? k.volume ?? "N/A"})`,
      )
      .join("\n");

    const historyLines =
      history.length > 0
        ? history
            .map((e) => {
              const outcome =
                e.rankAfter != null
                  ? `Rang ${e.rankBefore}→${e.rankAfter}`
                  : "noch nicht evaluiert";
              return `- ${e.deployedAt?.toISOString() ?? e.createdAt.toISOString()}: ${e.type} "${e.fromValue ?? ""}" → "${e.toValue ?? ""}" | Ergebnis: ${outcome}`;
            })
            .join("\n")
        : "Keine bisherigen Experimente.";

    const competitorLines =
      competitorKeywords.length > 0
        ? competitorKeywords
            .map((k) => `- "${k.term}" (${k.appsUsing} Konkurrenten nutzen es)`)
            .join("\n")
        : "Keine Competitor-Keywords verfügbar.";

    return `Du bist ein professioneller ASO-Stratege (App Store Optimization).

APP: ${app.name} (${app.bundleId})
KATEGORIE: ${category}

=== AKTUELLE METADATEN ===
Title: ${metadata.title}
Subtitle: ${metadata.subtitle}
Keywords (100 Zeichen): ${metadata.keywords}

=== KEYWORD-RANKINGS (letzte 30 Tage) ===
${keywordLines}

=== EXPERIMENT-HISTORY (letzte 90 Tage) ===
${historyLines}

=== COMPETITOR-KEYWORDS (nicht in deinen Keywords) ===
${competitorLines}

=== DEINE AUFGABE ===
Analysiere die Daten und schlage MAXIMAL 3 konkrete Änderungen vor.
Berücksichtige:
- Keywords mit schlechtem Rank-to-Volume-Verhältnis austauschen
- Competitor-Keywords mit hohem Volume und wenig Konkurrenz bevorzugen
- Keine Änderung wiederholen, die in der History als gescheitert markiert ist
- Apple erlaubt max. 100 Zeichen im Keywords-Feld (mit Kommas)

Antworte NUR als JSON-Array, kein anderer Text:
[
  {
    "type": "keyword_replace",
    "from_value": "fitness app",
    "to_value": "workout log",
    "reason": "fitness app Rang 145 trotz Volume 8/10 — zu kompetitiv. workout log Volume 6/10 aber nur 23 konkurrierende Apps",
    "confidence": 0.82,
    "expected_rank_improvement": 30
  }
]

Erlaubte types: keyword_add, keyword_remove, keyword_replace, title_change, subtitle_change
confidence muss zwischen 0.0 und 1.0 sein.
Schlage nichts vor mit confidence < 0.65.`;
  }

  private async callAI(
    anthropic: Anthropic,
    prompt: string,
    attempt = 0,
  ): Promise<AISuggestion[]> {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];

    if (attempt > 0) {
      messages.push({
        role: "assistant",
        content: "Ich werde es als gültiges JSON-Array formatieren:",
      });
      messages.push({
        role: "user",
        content:
          "Deine letzte Antwort war kein valides JSON. Antworte NUR als JSON-Array.",
      });
    }

    logger.info(
      `[ASOBrain] Calling claude-opus-4-5 (attempt ${attempt + 1}/${ASOBrain.MAX_RETRIES + 1})`,
    );

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5-20250219",
      max_tokens: 2000,
      messages,
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const raw = textBlock?.text ?? "";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      if (attempt < ASOBrain.MAX_RETRIES) {
        logger.warn(
          `[ASOBrain] Response is not valid JSON, retrying (attempt ${attempt + 1})`,
        );
        return this.callAI(anthropic, prompt, attempt + 1);
      }

      throw new Error(
        `AI response is not valid JSON after ${ASOBrain.MAX_RETRIES + 1} attempts. Raw: ${raw.slice(0, 500)}`,
      );
    }

    try {
      const parsed: AISuggestion[] = JSON.parse(jsonMatch[0]);

      for (const s of parsed) {
        if (
          typeof s.type !== "string" ||
          typeof s.confidence !== "number" ||
          typeof s.reason !== "string"
        ) {
          throw new Error("Malformed suggestion object");
        }
      }

      return parsed;
    } catch (err) {
      if (attempt < ASOBrain.MAX_RETRIES) {
        logger.warn(
          `[ASOBrain] Failed to parse JSON, retrying (attempt ${attempt + 1}): ${(err as Error).message}`,
        );
        return this.callAI(anthropic, prompt, attempt + 1);
      }

      throw new Error(
        `AI response JSON parse failed after ${ASOBrain.MAX_RETRIES + 1} attempts: ${(err as Error).message}`,
      );
    }
  }
}
