export type StudioFontId = "rounded" | "inter" | "baloo";
export type StudioTextPosition = "top" | "bottom";

export interface StudioStyle {
  bgColor1: string;
  bgColor2: string;
  textColor: string;
  font: StudioFontId;
  textPosition: StudioTextPosition;
  offsetX: number;
  offsetY: number;
  titleOffsetX: number;
  titleOffsetY: number;
  titleScale: number;
  deviceScale: number;
  titleBoxW: number;
  titleBoxH: number;
  titleLines: string[];
}

export const STUDIO_FONT_IDS: StudioFontId[] = ["rounded", "inter", "baloo"];

export const STUDIO_GEOMETRY_KEYS: Array<keyof StudioStyle> = [
  "offsetX",
  "offsetY",
  "titleOffsetX",
  "titleOffsetY",
  "titleScale",
  "deviceScale",
  "titleBoxW",
  "titleBoxH",
  "titleLines",
];

export const DEFAULT_STUDIO_GEOMETRY: Pick<StudioStyle, (typeof STUDIO_GEOMETRY_KEYS)[number]> = {
  offsetX: 0,
  offsetY: 0,
  titleOffsetX: 0,
  titleOffsetY: 0,
  titleScale: 1,
  deviceScale: 1,
  titleBoxW: 0,
  titleBoxH: 0,
  titleLines: [],
};

export const DEFAULT_STUDIO_STYLE: StudioStyle = {
  bgColor1: "#667eea",
  bgColor2: "#764ba2",
  textColor: "#ffffff",
  font: "rounded",
  textPosition: "top",
  offsetX: 0,
  offsetY: 0,
  titleOffsetX: 0,
  titleOffsetY: 0,
  titleScale: 1,
  deviceScale: 1,
  titleBoxW: 0,
  titleBoxH: 0,
  titleLines: [],
};

export const STUDIO_OFFSET_RANGE = 2048;

export function normalizeStudioOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  return Math.max(-STUDIO_OFFSET_RANGE, Math.min(STUDIO_OFFSET_RANGE, Math.round(value)));
}

export function normalizeTitleScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;

  return Math.max(0.2, Math.min(3, Math.round(value * 100) / 100));
}

export function normalizeDeviceScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;

  return Math.max(0.2, Math.min(2, Math.round(value * 100) / 100));
}

export const STUDIO_TITLE_MAX_LENGTH = 60;

export const STUDIO_TITLE_BOX_RANGE = 4096;

export function normalizeTitleBoxSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  return Math.max(0, Math.min(STUDIO_TITLE_BOX_RANGE, Math.round(value)));
}

export const STUDIO_TITLE_LINES_MAX = 12;

export function normalizeTitleLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const lines: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;

    const line = entry.replace(/\s+/g, " ").trim().slice(0, STUDIO_TITLE_MAX_LENGTH);

    if (!line) continue;

    lines.push(line);
  }

  if (lines.length <= STUDIO_TITLE_LINES_MAX) return lines;

  return [...lines.slice(0, STUDIO_TITLE_LINES_MAX - 1), lines.slice(STUDIO_TITLE_LINES_MAX - 1).join(" ")];
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;

const DEVICE_PATTERNS: Array<[RegExp, string]> = [
  [/iphone[_-]?6\.9/i, 'iPhone 6.9"'],
  [/iphone[_-]?6\.7/i, 'iPhone 6.7"'],
  [/iphone[_-]?6\.5/i, 'iPhone 6.5"'],
  [/iphone[_-]?6\.3/i, 'iPhone 6.3"'],
  [/iphone[_-]?5\.5/i, 'iPhone 5.5"'],
  [/iphone[_-]?4\.7/i, 'iPhone 4.7"'],
  [/ipad[_-]?13/i, 'iPad 13"'],
  [/ipad[_-]?12\.9/i, 'iPad 12.9"'],
  [/ipad[_-]?11/i, 'iPad 11"'],
  [/ipad/i, "iPad"],
];

export function isStudioFontId(value: unknown): value is StudioFontId {
  return typeof value === "string" && (STUDIO_FONT_IDS as string[]).includes(value);
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;

  const hex = value.startsWith("#") ? value : `#${value}`;
  const lower = hex.toLowerCase();

  if (!HEX_COLOR_RE.test(lower)) return fallback;

  if (lower.length === 4) {
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
  }

  return lower;
}

export function normalizeStudioStyle(value: unknown): StudioStyle {
  const input = (value ?? {}) as Partial<StudioStyle>;

  return {
    bgColor1: normalizeHexColor(input.bgColor1, DEFAULT_STUDIO_STYLE.bgColor1),
    bgColor2: normalizeHexColor(input.bgColor2, DEFAULT_STUDIO_STYLE.bgColor2),
    textColor: normalizeHexColor(input.textColor, DEFAULT_STUDIO_STYLE.textColor),
    font: isStudioFontId(input.font) ? input.font : DEFAULT_STUDIO_STYLE.font,
    textPosition: input.textPosition === "bottom" ? "bottom" : "top",
    offsetX: normalizeStudioOffset(input.offsetX),
    offsetY: normalizeStudioOffset(input.offsetY),
    titleOffsetX: normalizeStudioOffset(input.titleOffsetX),
    titleOffsetY: normalizeStudioOffset(input.titleOffsetY),
    titleScale: normalizeTitleScale(input.titleScale),
    deviceScale: normalizeDeviceScale(input.deviceScale),
    titleBoxW: normalizeTitleBoxSize(input.titleBoxW),
    titleBoxH: normalizeTitleBoxSize(input.titleBoxH),
    titleLines: normalizeTitleLines(input.titleLines),
  };
}

export function storedShotPatch(patch: unknown): Partial<StudioStyle> | null {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;

  const rest = { ...(patch as Partial<StudioStyle>) };
  delete rest.titleLines;

  if (JSON.stringify({ ...DEFAULT_STUDIO_GEOMETRY, ...rest }) === JSON.stringify(DEFAULT_STUDIO_GEOMETRY)) {
    return null;
  }

  return rest;
}

export function storedShotStyles(value: unknown): Record<string, Partial<StudioStyle>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, Partial<StudioStyle>> = {};

  for (const [base, patch] of Object.entries(value as Record<string, unknown>)) {
    const clean = storedShotPatch(patch);

    if (clean) out[base] = clean;
  }

  return out;
}

function shotCoreAndDevice(basename: string): { core: string; device: string } | null {
  const match = /^(\d+)_(.+)__(.+?)\.[^.]+$/.exec(basename);

  if (!match) return null;

  return { core: match[2], device: match[3] };
}

export function matchShotStyle(
  styles: Record<string, Partial<StudioStyle>>,
  basename: string,
): Partial<StudioStyle> | null {
  if (styles[basename]) return styles[basename];

  const want = shotCoreAndDevice(basename);

  if (!want) return null;

  let found: Partial<StudioStyle> | null = null;

  for (const [key, patch] of Object.entries(styles)) {
    const have = shotCoreAndDevice(key);

    if (!have || have.core !== want.core || have.device !== want.device) continue;

    if (found) return null;

    found = patch;
  }

  return found;
}

export function resolveShotStyles(
  styles: Record<string, Partial<StudioStyle>>,
  basenames: string[],
): Record<string, Partial<StudioStyle>> {
  const out: Record<string, Partial<StudioStyle>> = {};

  for (const basename of basenames) {
    const patch = matchShotStyle(styles, basename);

    if (patch) out[basename] = patch;
  }

  return out;
}

export function normalizeStudioTitle(value: unknown): string {
  if (typeof value !== "string") return "";

  return value.replace(/\s+/g, " ").trim().slice(0, STUDIO_TITLE_MAX_LENGTH);
}

export function titleLinesForTitle(value: unknown, title: string): string[] {
  const lines = normalizeTitleLines(value);

  if (lines.length === 0) return [];

  const expected = normalizeStudioTitle(title);

  if (!expected) return [];

  const joined = normalizeStudioTitle(lines.join(" "));

  if (joined !== expected) return [];

  return lines;
}

export function matchDescriptionKey(basename: string, descriptions: Record<string, string>): string | null {
  const base = basename.replace(/\.[^.]+$/, "");
  const hit = Object.keys(descriptions).find((key) => base === key || base.startsWith(`${key}_`));

  return hit ?? null;
}

export function resolveStudioTitle(args: {
  basename: string;
  locale: string;
  sublines: Record<string, Record<string, string>>;
  descriptions: Record<string, string>;
  fallback: string;
}): string {
  const key = matchDescriptionKey(args.basename, args.descriptions);

  if (!key) return args.fallback;

  const localeSublines = args.sublines[args.locale] ?? args.sublines["en-US"] ?? {};

  return localeSublines[key] ?? args.fallback;
}

export function studioDeviceLabel(url: string): string {
  const filename = decodeURIComponent(url.split("/").pop() ?? url);

  for (const [re, label] of DEVICE_PATTERNS) {
    if (re.test(filename)) return label;
  }

  return "Other";
}

export function studioBasename(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? url);
}
