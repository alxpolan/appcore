import { STUDIO_GEOMETRY_KEYS, type StudioStyle } from "./style";
type GeometryStylesMap = Record<string, Record<string, Partial<StudioStyle>>>;

export type StudioApplyMode = "device-locale" | "screen-all" | "device-all";
interface ApplyItem { basename: string; deviceLabel: string }
interface ApplyLocale { locale: string; items: ApplyItem[] }
const STUDIO_APPLY_GEOMETRY_KEYS = STUDIO_GEOMETRY_KEYS.filter((key) => key !== "titleLines");

export function applyStudioGeometry(
  overrides: GeometryStylesMap,
  locales: ApplyLocale[],
  activeLocale: string,
  selected: ApplyItem,
  source: StudioStyle,
  mode: StudioApplyMode,
): GeometryStylesMap {
  const geometry = Object.fromEntries(STUDIO_APPLY_GEOMETRY_KEYS.map((key) => [key, source[key]]));
  const next = { ...overrides };

  for (const locale of locales) {
    if (mode === "device-locale" && locale.locale !== activeLocale) continue;

    const styles = { ...(next[locale.locale] ?? {}) };
    for (const item of locale.items) {
      const matches = mode === "screen-all"
        ? item.basename === selected.basename
        : item.deviceLabel === selected.deviceLabel;
      if (matches) styles[item.basename] = { ...styles[item.basename], ...geometry };
    }
    next[locale.locale] = styles;
  }

  return next;
}
