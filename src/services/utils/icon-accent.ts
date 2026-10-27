import { Vibrant } from "node-vibrant/node";
import { logger, prisma } from "../../config";

function clampHsl(hex: string): string {
  const m = hex.match(/^#([\da-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff,
    g = (n >> 8) & 0xff,
    b = n & 0xff;

  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;

  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);

  const l = (max + min) / 2;
  const d = max - min;
  let h = 0,
    s = 0;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      case bn:
        h = ((rn - gn) / d + 4) * 60;
        break;
    }
  }

  const lClamped = Math.min(0.6, Math.max(0.35, l));
  const sClamped = Math.max(0.4, s);
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0,
      g1 = 0,
      b1 = 0;

    if (hp < 1) [r1, g1, b1] = [c, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, c];
    else if (hp < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = l - c / 2;

    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
  };

  const [rr, gg, bb] = hslToRgb(h, sClamped, lClamped);

  return "#" + [rr, gg, bb].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function extractAccentColor(iconUrl: string): Promise<string | null> {
  try {
    const palette = await Vibrant.from(iconUrl).getPalette();
    const swatch =
      palette.Vibrant ??
      palette.DarkVibrant ??
      palette.LightVibrant ??
      palette.Muted ??
      palette.DarkMuted ??
      palette.LightMuted;

    if (!swatch) return null;

    return clampHsl(swatch.hex);
  } catch (err) {
    logger.warn(`Failed to extract accent color from ${iconUrl}`, {
      err: String(err),
    });

    return null;
  }
}

const inFlight = new Map<string, Promise<string | null>>();

export async function ensureAccentColor(
  appId: string,
  iconUrl: string | null | undefined,
  cached: { accentColor: string | null; accentColorIconUrl: string | null },
): Promise<string | null> {
  if (!iconUrl) return cached.accentColor;

  if (cached.accentColor && cached.accentColorIconUrl === iconUrl) {
    return cached.accentColor;
  }

  const key = `${appId}:${iconUrl}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = (async () => {
    const hex = await extractAccentColor(iconUrl);

    if (hex) {
      await prisma.app
        .update({
          where: { id: appId },
          data: { accentColor: hex, accentColorIconUrl: iconUrl },
        })
        .catch((err) => {
          logger.warn(`Failed to cache accent color for app ${appId}`, {
            err: String(err),
          });
        });
    }

    return hex;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
