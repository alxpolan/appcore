import axios from "./utils/http";
import { prisma, logger, env } from "../config";
import { storeCampaignMetricsSegment, type CampaignMetricsRow } from "./asc-analytics";
import {
  collectUnknownStorefrontKeys,
  downloadRemainderPerDay,
  parseGroupedWebTimeseries,
  parseWebTimeseries,
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
const GROUPED_DOWNLOADS_MEASURE = "totalDownloads";
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

/** Per-storefront downloads; unknown storefront keys are reported for mapping. */
export async function fetchWebCampaignGroupedDownloads(
  cookies: string,
  adamId: string,
  ctToken: string,
  startDay: string,
  endDay: string,
) {
  const data = await postTimeseries(cookies, adamId, {
    startTime: `${startDay}T00:00:00Z`,
    endTime: `${endDay}T00:00:00Z`,
    measures: [GROUPED_DOWNLOADS_MEASURE],
    dimensionFilters: [{ dimensionKey: "campaignId", optionKeys: [ctToken] }],
    frequency: "day",
    group: { metric: GROUPED_DOWNLOADS_MEASURE, dimension: "storefront", limit: 0, rank: "DESCENDING" },
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
        let unitsByDate = new Map<string, number>();
        let unitsOk = false;
        try {
          const dlDays = await fetchWebCampaignSeries(cookies, trackId, ctToken, start, end, DOWNLOADS_MEASURES);
          unitsByDate = new Map(dlDays.map((d) => [d.dateStr, Math.round(d.downloads)]));
          unitsOk = true;
        } catch (err) {
          logger.warn(`[asc-web-analytics] ${bundleId} ${ctToken}: downloads fetch failed (${(err as Error)?.message})`);
        }
        // Territory split; XW keeps only the unattributed remainder so
        // territories + remainder add up to the units total. Falls back to
        // full units on XW when the grouped request fails.
        let xwDownloadsByDate = unitsByDate;
        try {
          const grouped = await fetchWebCampaignGroupedDownloads(cookies, trackId, ctToken, start, end);
          if (grouped.unknownKeys.length > 0) {
            logger.warn(
              `[asc-web-analytics] ${bundleId} ${ctToken}: unknown storefronts ${grouped.unknownKeys.join(",")}`,
            );
          }
          const positive = grouped.rows.filter((g) => g.downloads > 0);
          if (positive.length > 0) {
            rows += await storeCampaignMetricsSegment(
              bundleId,
              positive.map((g) => ({
                dateStr: g.dateStr,
                campaign: ctToken,
                territory: g.territory,
                downloads: Math.round(g.downloads),
                purchases: 0,
                trials: 0,
                proceedsUsd: 0,
              })),
              ["downloads"],
            );
          }
          if (unitsOk) {
            const official = await prisma.appStoreCampaignMetrics.findMany({
              where: {
                bundleId,
                campaign: ctToken,
                territory: { not: WEB_METRICS_TERRITORY },
                reportDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) },
              },
              select: { reportDate: true, territory: true, downloads: true },
            });
            xwDownloadsByDate = downloadRemainderPerDay({
              unitsByDate,
              grouped: grouped.rows,
              official: official.map((o) => ({
                dateStr: o.reportDate.toISOString().slice(0, 10),
                territory: o.territory,
                downloads: o.downloads,
              })),
            });
          } else {
            xwDownloadsByDate = new Map();
          }
        } catch (err) {
          logger.warn(
            `[asc-web-analytics] ${bundleId} ${ctToken}: grouped downloads fetch failed (${(err as Error)?.message})`,
          );
        }
        const storeRows: CampaignMetricsRow[] = days.map((d) => ({
          dateStr: d.dateStr,
          campaign: ctToken,
          territory: WEB_METRICS_TERRITORY,
          downloads: xwDownloadsByDate.get(d.dateStr) ?? 0,
          purchases: Math.round(d.purchases),
          trials: Math.round(d.trials),
          proceedsUsd: d.proceedsUsd,
        }));
        rows += await storeCampaignMetricsSegment(bundleId, storeRows, [
          "downloads",
          "purchases",
          "trials",
          "proceedsUsd",
        ]);
      }
      logger.info(`[asc-web-analytics] ${bundleId} ${ctToken}: web metrics synced`);
    }
  }
  return { tokens, rows };
}
