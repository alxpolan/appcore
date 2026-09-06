import { logger } from "../../config";
import { AIClient } from "../ai-client";

const NANO_MODEL = "gpt-5.2-nano";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a senior iOS build engineer. You are given the tail of a failed Fastlane/gym/xcodebuild CI log plus any captured error lines. Explain in plain, non-technical-friendly language what went wrong, in 2-4 sentences, and add a one-line suggested fix if the cause is clear. Do not quote large chunks of the raw log back verbatim. If the cause isn't clear from the given text, say so plainly instead of guessing.`;

export async function summarizeBuildError(logs: string[], errors: string[]): Promise<string | null> {
  const ai = new AIClient();
  if (!ai.hasProvider) return null;

  const tailLogs = logs.slice(-150).join("\n").slice(-12000);
  const errorText = errors.join("\n").slice(-4000);
  if (!tailLogs && !errorText) return null;

  const userPrompt = [
    errorText ? `Captured errors:\n${errorText}` : "",
    tailLogs ? `Tail of the build log:\n${tailLogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await ai.query(SYSTEM_PROMPT, userPrompt, {
      openaiModel: NANO_MODEL,
      anthropicModel: HAIKU_MODEL,
      temperature: 0,
      maxTokens: 300,
    });
    return response.content.trim() || null;
  } catch (err) {
    logger.warn("Failed to summarize build error via AI", { error: err instanceof Error ? err.message : err });
    return null;
  }
}
