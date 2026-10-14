import axios from "./utils/http";
import { prisma, logger, env } from "../config";
import { storeCampaignMetricsSegment, type CampaignMetricsRow } from "./asc-analytics";
import {
  collectUnknownStorefrontKeys,
  parseGroupedWebTimeseries,
  splitRemainderPerDay,
  type GroupedWebDayRow,
} from "./utils/asc-web-timeseries";
import { WEB_METRICS_TERRITORY } from "./utils/google-ads-mapping";

const TIMESERIES_URL = "https://appstoreconnect.apple.com/analytics/api/v1/data/timeseries";
const MEASURES = [
  "subscription-events-offerstarts-freetrial",
  "subscription-events-paidstarts",
  "proceeds",
];
// Separate request: downloads must not break the proven measures above.
// "units" = App Units (downloads), verified against the live API.
const DOWNLOADS_MEASURES = ["units"];
const GROUPED_MEASURES = {
  downloads: "totalDownloads",
  trials: "subscription-events-offerstarts-freetrial",
  proceedsUsd: "proceeds",
} as const;
type GroupedMetric = keyof typeof GROUPED_MEASURES;
const GROUPED_METRICS = Object.keys(GROUPED_MEASURES) as GroupedMetric[];
const CHUNK_DAYS = 90;

export class WebSessionExpiredError extends Error {}

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function postTimeseries(cookies: string, adamId: string, payload: Record<string, unknown>): Promise<any> {
  let res;
  try {
    res = await axios.post(
      TIMESERIES_URL,
      {
        adamId: [adamId],
        ...payload,
      },
      {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-requested-by": "appstoreconnect.apple.com",
          Cookie: cookies,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
          Referer: `https://appstoreconnect.apple.com/apps/${adamId}/analytics`,
        },
        timeout: 60_000,
      },
    );
  } catch (err: any) {
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      throw new WebSessionExpiredError(`ASC web session rejected (${err.response.status})`);
    }
    throw err;
  }
  if (typeof res.data === "string") {
    throw new WebSessionExpiredError("ASC web session returned a login page instead of JSON");
  }
  return res.data;
}

export async function fetchWebCampaignSeries(
  cookies: string,
  adamId: string,
  ctToken: string,
  startDay: string,
  endDay: string,
  measures: string[] = MEASURES,
) {
  const data = await postTimeseries(cookies, adamId, {
    startTime: `${startDay}T00:00:00Z`,
    endTime: `${endDay}T00:00:00Z`,
    measures,
    dimensionFilters: [{ dimensionKey: "campaignId", optionKeys: [ctToken] }],
    frequency: "day",
  });
  return parseWebTimeseries(data);
}

/** Per-storefront split for one measure; unknown storefront keys are reported for mapping. */
export async function fetchWebCampaignGroupedSeries(
  cookies: string,
  adamId: string,
  ctToken: string,
  startDay: string,
  endDay: string,
  measure: string,
) {
  const data = await postTimeseries(cookies, adamId, {
    startTime: `${startDay}T00:00:00Z`,
    endTime: `${endDay}T00:00:00Z`,
    measures: [measure],
    dimensionFilters: [{ dimensionKey: "campaignId", optionKeys: [ctToken] }],
    frequency: "day",
    group: { metric: measure, dimension: "storefront", limit: 0, rank: "DESCENDING" },
  });
  return { rows: parseGroupedWebTimeseries(data), unknownKeys: collectUnknownStorefrontKeys(data) };
}

export async function syncWebCampaignMetrics(): Promise<{ tokens: number; rows: number }> {
  const cookies = env.ASC_ANALYTICS_COOKIES;
  if (!cookies) {
    logger.info("[asc-web-analytics] ASC_ANALYTICS_COOKIES not configured — skipping");
    return { tokens: 0, rows: 0 };
  }
  const mappings = await prisma.googleAdsCampaignToken.findMany({
    include: { app: { select: { bundleId: true, trackId: true } } },
  });
  const byApp = new Map<string, { bundleId: string; trackId: string; tokens: string[] }>();
  for (const m of mappings) {
    if (!m.app?.trackId) continue;
    const e = byApp.get(m.app.bundleId) ?? {
      bundleId: m.app.bundleId,
      trackId: String(m.app.trackId),
      tokens: [],
    };
    if (!e.tokens.includes(m.ctToken)) e.tokens.push(m.ctToken);
    byApp.set(m.app.bundleId, e);
  }

  let tokens = 0;
  let rows = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const { bundleId, trackId, tokens: ctTokens } of byApp.values()) {
    for (const ctToken of ctTokens) {
      const existing = await prisma.appStoreCampaignMetrics.findFirst({
        where: { bundleId, campaign: ctToken, territory: WEB_METRICS_TERRITORY },
        select: { reportDate: true },
      });
      const daysBack = existing ? 14 : 365;
      const chunks: [string, string][] = [];
      for (let end = new Date(today); end > new Date(today.getTime() - daysBack * 86_400_000); ) {
        const start = new Date(Math.max(end.getTime() - CHUNK_DAYS * 86_400_000, today.getTime() - daysBack * 86_400_000));
        chunks.push([fmtDay(start), fmtDay(end)]);
        end = new Date(start.getTime() - 86_400_000);
      }
      tokens++;
      for (const [start, end] of chunks) {
        const days = await fetchWebCampaignSeries(cookies, trackId, ctToken, start, end);
        const totalsByMetric: Record<GroupedMetric, Map<string, number>> = {
          downloads: new Map(),
          trials: new Map(days.map((d) => [d.dateStr, Math.round(d.trials)])),
          proceedsUsd: new Map(days.map((d) => [d.dateStr, d.proceedsUsd])),
        };
        let unitsOk = false;
        try {
          const dlDays = await fetchWebCampaignSeries(cookies, trackId, ctToken, start, end, DOWNLOADS_MEASURES);
          totalsByMetric.downloads = new Map(dlDays.map((d) => [d.dateStr, Math.round(d.downloads)]));
          unitsOk = true;
        } catch (err) {
          logger.warn(`[asc-web-analytics] ${bundleId} ${ctToken}: downloads fetch failed (${(err as Error)?.message})`);
        }
        // Territory splits; XW keeps only the unattributed remainder per
        // metric so split + remainder add up to the total. A metric's stored
        // values are only rewritten when its grouped request succeeded,
        // otherwise the previous values stay (stale but never double-counted).
        const splitOk: Record<GroupedMetric, boolean> = { downloads: false, trials: false, proceedsUsd: false };
        const splitByKey = new Map<string, GroupedWebDayRow>();
        for (const metric of GROUPED_METRICS) {
          try {
            const grouped = await fetchWebCampaignGroupedSeries(
              cookies,
              trackId,
              ctToken,
              start,
              end,
              GROUPED_MEASURES[metric],
            );
            if (grouped.unknownKeys.length > 0) {
              logger.warn(
                `[asc-web-analytics] ${bundleId} ${ctToken}: unknown storefronts ${grouped.unknownKeys.join(",")}`,
              );
            }
            for (const r of grouped.rows) {
              const key = `${r.dateStr}\n${r.territory}`;
              const e = splitByKey.get(key) ?? {
                dateStr: r.dateStr,
                territory: r.territory,
                downloads: 0,
                trials: 0,
                proceedsUsd: 0,
              };
              e.downloads += r.downloads;
              e.trials += r.trials;
              e.proceedsUsd += r.proceedsUsd;
              splitByKey.set(key, e);
            }
            splitOk[metric] = true;
          } catch (err) {
            logger.warn(
              `[asc-web-analytics] ${bundleId} ${ctToken}: grouped ${metric} fetch failed (${(err as Error)?.message})`,
            );
          }
        }
        const splitColumns = GROUPED_METRICS.filter((m) => splitOk[m]);
        const totalsOk: Record<GroupedMetric, boolean> = { downloads: unitsOk, trials: true, proceedsUsd: true };
        const remainderMetrics = GROUPED_METRICS.filter((m) => splitOk[m] && totalsOk[m]);
        if (splitColumns.length > 0) {
          const toStore = [...splitByKey.values()].filter((r) => splitColumns.some((c) => r[c] > 0));
          if (toStore.length > 0) {
            rows += await storeCampaignMetricsSegment(
              bundleId,
              toStore.map((r) => ({
                dateStr: r.dateStr,
                campaign: ctToken,
                territory: r.territory,
                downloads: Math.round(r.downloads),
                purchases: 0,
                trials: Math.round(r.trials),
                proceedsUsd: r.proceedsUsd,
              })),
              splitColumns,
            );
          }
        }
        const remainderByMetric: Record<GroupedMetric, Map<string, number>> = {
          downloads: new Map(),
          trials: new Map(),
          proceedsUsd: new Map(),
        };
        if (remainderMetrics.length > 0) {
          const legacy = await prisma.appStoreCampaignMetrics.findMany({
            where: {
              bundleId,
              campaign: ctToken,
              territory: { not: WEB_METRICS_TERRITORY },
              reportDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
            },
            select: { reportDate: true, territory: true, downloads: true, trials: true, proceedsUsd: true },
          });
          for (const metric of remainderMetrics) {
            remainderByMetric[metric] = splitRemainderPerDay({
              totalsByDate: totalsByMetric[metric],
              split: [...splitByKey.values()].map((r) => ({ dateStr: r.dateStr, territory: r.territory, value: r[metric] })),
              legacy: legacy.map((o) => ({
                dateStr: o.reportDate.toISOString().slice(0, 10),
                territory: o.territory,
                value: o[metric],
              })),
            });
          }
        }
        const storeRows: CampaignMetricsRow[] = days.map((d) => ({
          dateStr: d.dateStr,
          campaign: ctToken,
          territory: WEB_METRICS_TERRITORY,
          downloads: Math.round(remainderByMetric.downloads.get(d.dateStr) ?? 0),
          purchases: Math.round(d.purchases),
          trials: Math.round(remainderByMetric.trials.get(d.dateStr) ?? 0),
          proceedsUsd: remainderByMetric.proceedsUsd.get(d.dateStr) ?? 0,
        }));
        rows += await storeCampaignMetricsSegment(bundleId, storeRows, ["purchases", ...remainderMetrics]);
      }
      logger.info(`[asc-web-analytics] ${bundleId} ${ctToken}: web metrics synced`);
    }
  }
  return { tokens, rows };
}
