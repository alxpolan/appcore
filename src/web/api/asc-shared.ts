import type { Request, Response, RequestHandler } from "express";
import { prisma, logger } from "../../config";
import { ascClientForUser as ascClientForUserOrNull } from "../../services/asc-client";
import type { AppStoreConnectClient } from "../../services/appstore-connect";
import type { EqualizedPricePoint } from "../../services/asc-subscription-prices";
import { priceMultiplierFor } from "../../services/utils/price-multipliers";
import { isFirstVersionLocalizationSet, evaluateLocalizationQuality } from "../lib/localization-quality";

const CACHE_TTL_MS = 0;

const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "WAITING_FOR_REVIEW",
  "PENDING_DEVELOPER_RELEASE",
]);

export { CACHE_TTL_MS, EDITABLE_STATES };

export function isFresh(syncedAt: Date): boolean {
  return Date.now() - syncedAt.getTime() < CACHE_TTL_MS;
}

export function isDemoBundle(bundleId: string | undefined | null): boolean {
  return typeof bundleId === "string" && bundleId.startsWith("com.marteso.demo.");
}

export function toLocalizationResponse(l: any) {
  return {
    locale: l.locale,
    appInfoLocalizationId: l.appInfoLocalizationId,
    versionLocalizationId: l.versionLocalizationId,
    name: l.name,
    subtitle: l.subtitle,
    description: l.description,
    keywords: l.keywords,
    whatsNew: l.whatsNew,
    promotionalText: l.promotionalText,
    supportUrl: l.supportUrl,
    marketingUrl: l.marketingUrl,
    privacyPolicyUrl: l.privacyPolicyUrl,
  };
}

export function toLocalizationSummaries(localizations: any[]) {
  const isFirstVersion = isFirstVersionLocalizationSet(localizations);

  return localizations.map((l) => {
    const quality = evaluateLocalizationQuality(l, isFirstVersion);

    return {
      locale: l.locale,
      appInfoLocalizationId: l.appInfoLocalizationId,
      versionLocalizationId: l.versionLocalizationId,
      isComplete: quality.isComplete,
      isOptimal: quality.isOptimal,
      qualityReasons: quality.reasons,
    };
  });
}

export function pickInitialLocale(
  localizations: Array<{ locale: string }>,
  requestedLocale?: string,
  primaryLocale?: string | null,
): string | null {
  if (requestedLocale && localizations.some((l) => l.locale === requestedLocale)) return requestedLocale;
  if (primaryLocale && localizations.some((l) => l.locale === primaryLocale)) return primaryLocale;
  if (localizations.some((l) => l.locale === "en-US")) return "en-US";

  return localizations[0]?.locale ?? null;
}

export function handle(label: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const ascErrors = err?.response?.data?.errors;

      logger.error(`ASC ${label} failed`, ascErrors ?? err);
      const detail =
        ascErrors?.map((e: any) => e.detail ?? e.title).filter(Boolean).join("; ") ||
        err?.message ||
        "An error occurred. Please try again.";

      res.status(500).json({ error: detail, _debug: { label, ascErrors: ascErrors ?? null } });
    }
  };
}

export async function tryCreateLocalization<T>(
  label: string,
  locale: string,
  fn: () => Promise<T>,
  swallowCodes: number[] = [],
): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    const msg: string = err?.message ?? "";

    if (msg.includes("409")) {
      logger.info(`${label}: locale ${locale} already exists in ASC (409), will try fallback lookup`);

      return null;
    }

    const swallowed = swallowCodes.find((c) => msg.includes(String(c)));

    if (swallowed) {
      logger.warn(`${label}: locale ${locale} creation returned ${swallowed} — ${msg.split("\n")[0]}`);

      return null;
    }
    throw err;
  }
}

export async function upsertVersionsToDb(
  bundleId: string,
  ascAppId: string,
  appName: string,
  versions: Array<{
    id: string;
    attributes: {
      versionString: string;
      appStoreState: string;
      platform: string;
      releaseType?: string;
    };
  }>,
): Promise<void> {
  await Promise.all(
    versions.map((v) =>
      prisma.appStoreVersion.upsert({
        where: { id: v.id },
        create: {
          id: v.id,
          bundleId,
          ascAppId,
          appName,
          versionString: v.attributes.versionString,
          appStoreState: v.attributes.appStoreState,
          platform: v.attributes.platform,
          releaseType: v.attributes.releaseType ?? null,
          syncedAt: new Date(),
        },
        update: {
          appStoreState: v.attributes.appStoreState,
          versionString: v.attributes.versionString,
          syncedAt: new Date(),
        },
      }),
    ),
  );
}

export async function upsertVersionDetailToDb(
  bundleId: string,
  ascAppId: string,
  appName: string,
  version: {
    id: string;
    attributes: {
      versionString: string;
      appStoreState: string;
      platform: string;
      releaseType?: string;
    };
  },
  localizations: Array<{
    locale: string;
    appInfoLocalizationId: string | null;
    versionLocalizationId: string | null;
    name: string;
    subtitle: string;
    description: string;
    keywords: string;
    whatsNew: string;
    promotionalText: string;
    supportUrl: string;
    marketingUrl: string;
    privacyPolicyUrl: string;
  }>,
  copyright?: string | null,
  ageRating?: string | null,
): Promise<void> {
  await prisma.appStoreVersion.upsert({
    where: { id: version.id },
    create: {
      id: version.id,
      bundleId,
      ascAppId,
      appName,
      versionString: version.attributes.versionString,
      appStoreState: version.attributes.appStoreState,
      platform: version.attributes.platform,
      releaseType: version.attributes.releaseType ?? null,
      copyright: copyright ?? null,
      ageRating: ageRating ?? null,
      syncedAt: new Date(),
    },
    update: {
      appStoreState: version.attributes.appStoreState,
      versionString: version.attributes.versionString,
      copyright: copyright !== undefined ? (copyright ?? null) : undefined,
      ageRating: ageRating !== undefined ? (ageRating ?? null) : undefined,
      syncedAt: new Date(),
    },
  });

  const existing = await prisma.appStoreVersion.findUnique({
    where: { id: version.id },
    select: { reviewerFirstName: true, reviewDetailId: true },
  });

  if (!existing?.reviewerFirstName && !existing?.reviewDetailId) {
    const app = await prisma.app.findUnique({
      where: { bundleId },
      select: { teamId: true },
    });

    if (app?.teamId) {
      const ts = await prisma.teamSettings.findUnique({
        where: { teamId: app.teamId },
        select: {
          presetCopyright: true,
          reviewerFirstName: true,
          reviewerLastName: true,
          reviewerPhone: true,
          reviewerEmail: true,
          reviewerDemoAccountRequired: true,
          reviewerDemoUsername: true,
          reviewerDemoPassword: true,
        },
      });

      if (ts) {
        await prisma.appStoreVersion.update({
          where: { id: version.id },
          data: {
            copyright: copyright ?? ts.presetCopyright ?? null,
            reviewerFirstName: ts.reviewerFirstName ?? null,
            reviewerLastName: ts.reviewerLastName ?? null,
            reviewerPhone: ts.reviewerPhone ?? null,
            reviewerEmail: ts.reviewerEmail ?? null,
            reviewerDemoAccountRequired: ts.reviewerDemoAccountRequired ?? false,
            reviewerDemoUsername: ts.reviewerDemoUsername ?? null,
            reviewerDemoPassword: ts.reviewerDemoPassword ?? null,
          },
        });
      }
    }
  }

  await Promise.all(
    localizations.map((loc) =>
      prisma.appStoreVersionLocalization.upsert({
        where: {
          versionId_locale: { versionId: version.id, locale: loc.locale },
        },
        create: { versionId: version.id, ...loc },
        update: { ...loc },
      }),
    ),
  );

  await prisma.appStoreVersionLocalization.deleteMany({
    where: {
      versionId: version.id,
      locale: { notIn: localizations.map((loc) => loc.locale) },
    },
  });
}

export async function invalidateVersionCache(bundleId: string): Promise<void> {
  await prisma.appStoreVersion
    .updateMany({
      where: { bundleId },
      data: { syncedAt: new Date(0) },
    })
    .catch(() => {});
}

export async function ascClientForUser(userId: string): Promise<AppStoreConnectClient> {
  const asc = await ascClientForUserOrNull(userId);
  if (!asc) throw new Error("App Store Connect credentials missing.");

  return asc;
}

export const SMART_PRICING_BASE_TERRITORY = "USA";

export function nearestPricePoint(
  catalog: Array<{ id: string; customerPrice: string | null }>,
  target: number,
): { id: string; customerPrice: string | null } | null {
  let best: { id: string; customerPrice: string | null } | null = null;
  let bestDiff = Infinity;
  for (const point of catalog) {
    const price = Number(point.customerPrice);
    if (!Number.isFinite(price)) continue;
    const diff = Math.abs(price - target);

    if (diff < bestDiff || (diff === bestDiff && best && price < Number(best.customerPrice))) {
      best = point;
      bestDiff = diff;
    }
  }

  return best;
}

export async function buildSmartPriceRows(opts: {
  basePricePointId: string;
  baseCatalog: Array<{ id: string; customerPrice: string | null }>;
  currentByTerritory: Map<
    string,
    { pricePointId: string | null; customerPrice: string | null; currency: string | null }
  >;
  fetchEqualizations: (pricePointId: string) => Promise<EqualizedPricePoint[]>;
}) {
  const basePoint = opts.baseCatalog.find((p) => p.id === opts.basePricePointId);
  const basePrice = Number(basePoint?.customerPrice);

  if (!basePoint || !Number.isFinite(basePrice)) {
    throw new Error("Base price point not found in the USA price point catalog");
  }

  const charmCatalog = opts.baseCatalog.filter((p) => p.customerPrice?.endsWith(".99"));
  const snapCatalog = charmCatalog.length > 0 ? charmCatalog : opts.baseCatalog;

  const baseEqualizations = await opts.fetchEqualizations(opts.basePricePointId);
  const parityByTerritory = new Map<string, EqualizedPricePoint>();
  const territoryGroups = new Map<string, string[]>();
  for (const point of baseEqualizations) {
    if (!point.territory || point.territory === SMART_PRICING_BASE_TERRITORY) continue;
    parityByTerritory.set(point.territory, point);
    const multiplier = priceMultiplierFor(point.territory);
    const targetPoint = nearestPricePoint(snapCatalog, basePrice * multiplier);
    if (!targetPoint) continue;
    const group = territoryGroups.get(targetPoint.id) ?? [];

    group.push(point.territory);
    territoryGroups.set(targetPoint.id, group);
  }

  const suggestedByTerritory = new Map<string, EqualizedPricePoint>();

  await Promise.all(
    [...territoryGroups.entries()].map(async ([targetPointId, territories]) => {
      const equalized =
        targetPointId === opts.basePricePointId ? baseEqualizations : await opts.fetchEqualizations(targetPointId);

      const byTerritory = new Map(equalized.filter((p) => p.territory).map((p) => [p.territory!, p]));
      for (const territory of territories) {
        const point = byTerritory.get(territory) ?? parityByTerritory.get(territory);
        if (point) suggestedByTerritory.set(territory, point);
      }
    }),
  );

  const rows = [...suggestedByTerritory.entries()].map(([territory, suggested]) => {
    const current = opts.currentByTerritory.get(territory) ?? null;

    return {
      territory,
      currency: suggested.currency ?? current?.currency ?? null,
      multiplier: priceMultiplierFor(territory),
      currentPricePointId: current?.pricePointId ?? null,
      currentPrice: current?.customerPrice ?? null,
      suggestedPricePointId: suggested.id,
      suggestedPrice: suggested.customerPrice,
      suggestedProceeds: suggested.proceeds,
      changed: current?.pricePointId !== suggested.id,
    };
  });

  rows.sort((a, b) => a.territory.localeCompare(b.territory));

  const baseCurrent = opts.currentByTerritory.get(SMART_PRICING_BASE_TERRITORY) ?? null;

  rows.unshift({
    territory: SMART_PRICING_BASE_TERRITORY,
    currency: "USD",
    multiplier: 1,
    currentPricePointId: baseCurrent?.pricePointId ?? null,
    currentPrice: baseCurrent?.customerPrice ?? null,
    suggestedPricePointId: basePoint.id,
    suggestedPrice: basePoint.customerPrice,
    suggestedProceeds: null,
    changed: baseCurrent?.pricePointId !== basePoint.id,
  });

  return rows;
}

export async function getGameCenterDetailId(asc: AppStoreConnectClient, appId: string): Promise<string | null> {
  try {
    const { data: resp } = await asc.client.get(`/apps/${appId}/gameCenterDetail`);

    return resp.data?.id ?? null;
  } catch {
    return null;
  }
}

export async function gcDetailIdForBundle(asc: AppStoreConnectClient, bundleId: string): Promise<string | null> {
  const app = await asc.getApp(bundleId);
  if (!app) return null;

  return getGameCenterDetailId(asc, app.id);
}

export async function verifyGcResource(
  asc: AppStoreConnectClient,
  resourcePath: "gameCenterLeaderboards" | "gameCenterAchievements" | "gameCenterLeaderboardSets",
  resourceId: string,
  gcDetailId: string,
): Promise<boolean> {
  try {
    const { data: resp } = await asc.client.get(`/${resourcePath}/${resourceId}/relationships/gameCenterDetail`);

    return resp.data?.id === gcDetailId;
  } catch {
    return false;
  }
}

export const LOCALIZATION_PARENT: Record<
  string,
  {
    locPath: string;
    parentRel: string;
    parentPath: "gameCenterLeaderboards" | "gameCenterAchievements" | "gameCenterLeaderboardSets";
  }
> = {
  leaderboard: {
    locPath: "gameCenterLeaderboardLocalizations",
    parentRel: "gameCenterLeaderboard",
    parentPath: "gameCenterLeaderboards",
  },
  achievement: {
    locPath: "gameCenterAchievementLocalizations",
    parentRel: "gameCenterAchievement",
    parentPath: "gameCenterAchievements",
  },
  challenge: {
    locPath: "gameCenterLeaderboardSetLocalizations",
    parentRel: "gameCenterLeaderboardSet",
    parentPath: "gameCenterLeaderboardSets",
  },
};

export async function verifyGcLocalization(
  asc: AppStoreConnectClient,
  kind: "leaderboard" | "achievement" | "challenge",
  localizationId: string,
  gcDetailId: string,
): Promise<boolean> {
  const cfg = LOCALIZATION_PARENT[kind];
  try {
    const { data: resp } = await asc.client.get(`/${cfg.locPath}/${localizationId}/relationships/${cfg.parentRel}`);
    const parentId = resp.data?.id;
    if (!parentId) return false;

    return verifyGcResource(asc, cfg.parentPath, parentId, gcDetailId);
  } catch {
    return false;
  }
}

export function forbidResource(res: Response) {
  res.status(404).json({ error: "Resource not found" });
}
