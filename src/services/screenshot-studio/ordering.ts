import { getEffectiveFramed, writeEffectiveFramed, type FramedMap } from "./revisions";
import { studioBasename } from "./style";

export function reorderFramedScreenshots(
  framed: FramedMap,
  locale: string,
  basenames: string[],
  allLocales = false,
): FramedMap {
  const existing = framed[locale];
  if (!existing) throw new Error(`Locale ${locale} not found`);
  const byBasename = new Map(existing.map((url) => [studioBasename(url), url]));
  if (basenames.length !== existing.length || new Set(basenames).size !== existing.length ||
      !basenames.every((base) => byBasename.has(base))) {
    throw new Error("basenames must contain every existing screenshot exactly once");
  }
  const updated = { ...framed, [locale]: basenames.map((base) => byBasename.get(base)!) };
  if (allLocales) {
    const order = new Map(basenames.map((base, index) => [base, index]));
    for (const [otherLocale, urls] of Object.entries(framed)) {
      if (otherLocale === locale) continue;
      updated[otherLocale] = urls
        .map((url, index) => ({ url, index, rank: order.get(studioBasename(url)) ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((entry) => entry.url);
    }
  }
  return updated;
}

export async function reorderStudioScreenshots(jobId: string, locale: string, basenames: string[], allLocales = false) {
  const { framedByLocale } = await getEffectiveFramed(jobId);
  const updated = reorderFramedScreenshots(framedByLocale, locale, basenames, allLocales);
  await writeEffectiveFramed(jobId, updated);
  return { locales: Object.fromEntries(Object.entries(updated).map(([loc, urls]) => [loc, urls.map(studioBasename)])) };
}
