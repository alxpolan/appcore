import { generateScreenshotSublines } from "../screenshot-subline-generator";
import { normalizeCppCaptions, type CppCaptions } from "./proposals";

export function themeDescriptions(
  descriptions: Record<string, string>,
  label: string,
  topTerms: string[],
): Record<string, string> {
  const context = `Ad theme "${label}" (top searches: ${topTerms.join(", ")})`;

  return Object.fromEntries(Object.entries(descriptions).map(([key, desc]) => [key, `${desc} — ${context}`]));
}

export async function generateGroupCaptions(args: {
  appId: string;
  label: string;
  topTerms: string[];
  descriptions: Record<string, string>;
  locales: string[];
}): Promise<CppCaptions> {
  if (Object.keys(args.descriptions).length === 0) throw new Error("Source run has no screen descriptions");

  const sublines = await generateScreenshotSublines(
    args.appId,
    themeDescriptions(args.descriptions, args.label, args.topTerms.slice(0, 5)),
    args.locales,
  );

  const captions = normalizeCppCaptions(sublines);

  for (const locale of args.locales) {
    const localeCaptions = captions[locale] ?? {};

    for (const key of Object.keys(args.descriptions)) {
      if (!localeCaptions[key]) localeCaptions[key] = args.label;
    }

    captions[locale] = localeCaptions;
  }

  return captions;
}
