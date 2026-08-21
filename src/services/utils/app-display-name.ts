import { logger, prisma } from "../../config";
import { AIClient } from "../ai-client";

const NANO_MODEL = "gpt-5.2-nano";

const SYSTEM_PROMPT = `You extract the clean brand name from an App Store app title. App Store titles are often keyword-stuffed for SEO, e.g. "Streaks - Habit Tracker & To Do List" or "CapCut: Video & Photo Editor". Reply with ONLY the clean brand name, nothing else, no quotes, no punctuation at the end. If the title is already clean, return it unchanged.`;

export async function guessCleanAppName(rawTitle: string): Promise<string | null> {
  const ai = new AIClient();
  if (!ai.hasOpenAI) return null;

  try {
    const response = await ai.query(SYSTEM_PROMPT, rawTitle, {
      provider: "openai",
      openaiModel: NANO_MODEL,
      temperature: 0,
      maxTokens: 20,
    });

    const clean = response.content.trim().replace(/^["']|["']$/g, "");
    if (!clean || clean.length > 60) return null;
    return clean;
  } catch (err) {
    logger.warn("Failed to guess clean app name", { err: String(err), rawTitle });
    return null;
  }
}

export async function fillDisplayNameFromTitle(appId: string, rawTitle: string): Promise<void> {
  const clean = await guessCleanAppName(rawTitle);
  if (!clean || clean === rawTitle) return;

  await prisma.app
    .updateMany({ where: { id: appId, displayName: null }, data: { displayName: clean } })
    .catch((err) => logger.warn(`Failed to save guessed display name for app ${appId}`, { err: String(err) }));
}
