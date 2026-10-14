import axios from "./utils/http";
import { prisma, logger, env } from "../config";
import { storeCampaignMetricsSegment, type CampaignMetricsRow } from "./asc-analytics";
import { parseWebTimeseries } from "./utils/asc-web-timeseries";
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
const CHUNK_DAYS = 90;

export class WebSessionExpiredError extends Error {}

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchWebCampaignSeries(
  cookies: string,
  adamId: string,
  ctToken: string,
  startDay: string,
  endDay: string,
  measures: string[] = MEASURES,
) {
  let res;
  try {
    res = await axios.post(
      TIMESERIES_URL,
      {
        adamId: [adamId],
        startTime: `${startDay}T00:00:00Z`,
        endTime: `${endDay}T00:00:00Z`,
        measures,
        dimensionFilters: [{ dimensionKey: "campaignId", optionKeys: [ctToken] }],
        frequency: "day",
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
        timeout: 30_000,
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
  return parseWebTimeseries(res.data);
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
        let dlByDate = new Map<string, number>();
        try {
          const dlDays = await fetchWebCampaignSeries(cookies, trackId, ctToken, start, end, DOWNLOADS_MEASURES);
          dlByDate = new Map(dlDays.map((d) => [d.dateStr, Math.round(d.downloads)]));
        } catch (err) {
          logger.warn(`[asc-web-analytics] ${bundleId} ${ctToken}: downloads fetch failed (${(err as Error)?.message})`);
        }
        const storeRows: CampaignMetricsRow[] = days.map((d) => ({
          dateStr: d.dateStr,
          campaign: ctToken,
          territory: WEB_METRICS_TERRITORY,
          downloads: dlByDate.get(d.dateStr) ?? 0,
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
