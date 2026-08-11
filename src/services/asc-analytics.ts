import zlib from "zlib";
import axios from "./utils/http";
import { prisma, logger } from "../config";
import type { EffectiveSettings } from "../config/userSettings";
import { generateASCToken } from "./utils/asc-token";

function parseTsv(raw: string): Record<string, string>[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cols[i] ?? "").trim()]));
  });
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const TRACKED_ANALYTICS_REPORTS: Record<string, string> = {
  APP_STORE_ENGAGEMENT: "App Store Discovery and Engagement Standard",
  APP_USAGE: "App Sessions Standard",
};

type AnalyticsCategory = keyof typeof TRACKED_ANALYTICS_REPORTS;
type AnalyticsMetrics = { impressions: number; pageViews: number; taps: number; sessions: number };

function aggregateAnalyticsSegment(
  rows: Record<string, string>[],
  category: AnalyticsCategory,
  dimensionColumn: string,
  normalizeDimension: (raw: string) => string,
): Record<string, AnalyticsMetrics> {
  const metricsByDayDimension: Record<string, AnalyticsMetrics> = {};

  for (const row of rows) {
    const dateStr = (row["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    const dimension = normalizeDimension(row[dimensionColumn] ?? "");
    const key = `${dateStr}::${dimension}`;
    const metrics = (metricsByDayDimension[key] ??= { impressions: 0, pageViews: 0, taps: 0, sessions: 0 });

    if (category === "APP_USAGE") {
      metrics.sessions += parseInt(row["Sessions"] ?? "0", 10) || 0;
      continue;
    }

    const eventType = (row["Event"] ?? "").trim();
    const counts = parseInt(row["Counts"] ?? "0", 10) || 0;

    if (eventType === "Impression") metrics.impressions += counts;
    if (eventType === "Page view") metrics.pageViews += counts;
    if (eventType === "Tap") metrics.taps += counts;
  }

  return metricsByDayDimension;
}

function parseAnalyticsSegment(rows: Record<string, string>[], category: AnalyticsCategory) {
  return aggregateAnalyticsSegment(rows, category, "Territory", (raw) => raw.toUpperCase().trim() || "WW");
}

function parsePlatformSegment(rows: Record<string, string>[], category: AnalyticsCategory) {
  return aggregateAnalyticsSegment(rows, category, "Platform Version", (raw) => raw.trim() || "Unknown");
}

async function storeAnalyticsSegment(
  bundleId: string,
  category: AnalyticsCategory,
  metricsByDayCountry: Record<string, AnalyticsMetrics>,
): Promise<number> {
  const entries = Object.entries(metricsByDayCountry);
  await Promise.all(
    entries.map(([key, metrics]) => {
      const [dateStr, country] = key.split("::");
      const reportDate = new Date(dateStr);
      const update =
        category === "APP_USAGE"
          ? { sessions: metrics.sessions }
          : { impressions: metrics.impressions, pageViews: metrics.pageViews, taps: metrics.taps };

      return prisma.appStoreAnalytics.upsert({
        where: { bundleId_reportDate_country: { bundleId, reportDate, country } },
        create: { bundleId, reportDate, country, ...metrics },
        update,
      });
    }),
  );
  return entries.length;
}

async function storePlatformSegment(
  bundleId: string,
  category: AnalyticsCategory,
  metricsByDayPlatform: Record<string, AnalyticsMetrics>,
): Promise<number> {
  const entries = Object.entries(metricsByDayPlatform);
  await Promise.all(
    entries.map(([key, metrics]) => {
      const [dateStr, platformVersion] = key.split("::");
      const reportDate = new Date(dateStr);
      const update =
        category === "APP_USAGE"
          ? { sessions: metrics.sessions }
          : { impressions: metrics.impressions, pageViews: metrics.pageViews, taps: metrics.taps };

      return prisma.appStoreAnalyticsPlatform.upsert({
        where: { bundleId_reportDate_platformVersion: { bundleId, reportDate, platformVersion } },
        create: { bundleId, reportDate, platformVersion, ...metrics },
        update,
      });
    }),
  );
  return entries.length;
}

export interface AnalyticsSyncResult {
  downloadDays: number;
  reviewsFetched: number;
  error?: string;
}

export class AscAnalyticsService {
  private readonly settings: EffectiveSettings;
  private readonly BASE = "https://api.appstoreconnect.apple.com/v1";

  constructor(settings: EffectiveSettings) {
    this.settings = settings;
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${generateASCToken({
        issuerId: this.settings.ascIssuerId,
        keyId: this.settings.ascKeyId,
        privateKey: this.settings.ascPrivateKey,
      })}`,
    };
  }

  private logRateLimit(headers: Record<string, any>): void {
    const header = headers?.["x-rate-limit"];
    if (!header) return;

    const lim = String(header).match(/user-hour-lim:(\d+)/)?.[1];
    const rem = String(header).match(/user-hour-rem:(\d+)/)?.[1];
    if (!lim || !rem) return;

    const limit = parseInt(lim, 10);
    const remaining = parseInt(rem, 10);
    const pct = Math.round((remaining / limit) * 100);
    logger.debug(`ASC rate limit: ${remaining}/${limit} remaining (${pct}%)`);

    const teamId = this.settings.teamId;
    if (teamId) {
      prisma.ascRateLimit
        .upsert({
          where: { teamId },
          update: { hourLimit: limit, hourRemaining: remaining },
          create: { teamId, hourLimit: limit, hourRemaining: remaining },
        })
        .catch((err: unknown) => logger.warn("Failed to persist ASC rate limit", err));
    }
  }

  async fetchSalesReports(bundleId: string, ascAppId: string, daysBack = 60): Promise<number> {
    if (!this.settings.ascVendorNumber) {
      logger.warn("ASC vendor number not configured - skipping sales reports");
      return 0;
    }

    const headers = this.authHeaders();
    let storedDays = 0;

    for (let i = 1; i <= daysBack; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = fmtDate(date);

      if (i > 2) {
        const existing = await prisma.appStoreAnalytics.findFirst({
          where: {
            bundleId,
            reportDate: new Date(dateStr),
          },
        });
        if (existing) continue;
      }

      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SALES",
            "filter[reportSubType]": "SUMMARY",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": dateStr,
          },
          responseType: "arraybuffer",
        });
        this.logRateLimit(resp.headers);

        const raw = zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8");
        const rows = parseTsv(raw);

        const byCountry: Record<
          string,
          {
            downloads: number;
            updates: number;
            proceeds: number;
          }
        > = {};

        for (const row of rows) {
          const rowAppId = (row["Apple Identifier"] ?? "").trim();
          if (ascAppId && rowAppId && rowAppId !== ascAppId) continue;

          const typeId = row["Product Type Identifier"] ?? "";
          const units = parseInt(row["Units"] ?? "0", 10) || 0;
          const proceeds = parseFloat(row["Developer Proceeds"] ?? "0") || 0;
          const country = (row["Country Code"] ?? "").toUpperCase().trim();
          if (!country) continue;

          if (!byCountry[country]) {
            byCountry[country] = {
              downloads: 0,
              updates: 0,
              proceeds: 0,
            };
          }

          if (typeId === "1" || typeId === "1F") {
            byCountry[country].downloads += units;
            byCountry[country].proceeds += proceeds;
          } else if (typeId === "1T") {
            byCountry[country].updates += units;
          } else if (typeId === "7") {
            byCountry[country].proceeds += proceeds;
          }
        }

        const reportDate = new Date(dateStr);
        const countryEntries = Object.entries(byCountry);

        if (countryEntries.length > 0) {
          await Promise.all(
            countryEntries.map(([country, agg]) =>
              prisma.appStoreAnalytics.upsert({
                where: {
                  bundleId_reportDate_country: { bundleId, reportDate, country },
                },
                create: { bundleId, reportDate, country, ...agg },
                update: agg,
              }),
            ),
          );

          storedDays++;
          logger.debug(`Sales report stored: ${bundleId} ${dateStr} (${countryEntries.length} countries)`);
        }
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 400) {
          logger.debug(`No sales report for ${dateStr}`);
          continue;
        }
        logger.warn(`Sales report fetch failed for ${dateStr}: ${err?.message ?? err}`);
      }
    }

    return storedDays;
  }

  private async processAnalyticsRequest(bundleId: string, requestId: string, daysBack: number): Promise<number> {
    const headers = this.authHeaders();
    const sinceCutoff = new Date();
    sinceCutoff.setDate(sinceCutoff.getDate() - daysBack);

    let reportItems: Array<{ id: string; category: AnalyticsCategory }> = [];
    try {
      const reportsResp = await axios.get(`${this.BASE}/analyticsReportRequests/${requestId}/reports`, { headers });
      this.logRateLimit(reportsResp.headers);

      const reports: any[] = reportsResp.data?.data ?? [];

      logger.debug(
        `Analytics request ${requestId}: ${reports.length} report(s) – categories: ${reports.map((r) => r.attributes?.category).join(", ")}`,
      );

      const relevant = reports.filter(
        (r: any) => TRACKED_ANALYTICS_REPORTS[r.attributes?.category] === r.attributes?.name,
      );

      reportItems = relevant
        .map((r: any) => ({
          id: r.id as string,
          category: r.attributes?.category as AnalyticsCategory,
        }))
        .filter((r) => r.id);

      if (reportItems.length === 0) {
        logger.info(`No standard engagement or session reports available yet for request ${requestId} (${bundleId}).`);
        return 0;
      }
    } catch (err: any) {
      logger.warn(
        `Listing reports for request ${requestId}: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
      );
      return 0;
    }

    let storedRows = 0;

    for (const reportItem of reportItems) {
      const reportId = reportItem.id;
      let instances: any[] = [];

      try {
        const instResp = await axios.get(`${this.BASE}/analyticsReports/${reportId}/instances`, {
          headers,
          params: { "filter[granularity]": "DAILY", limit: 200 },
        });

        this.logRateLimit(instResp.headers);
        const all: any[] = instResp.data?.data ?? [];

        instances = all.filter((inst: any) => {
          const pd: string | undefined = inst.attributes?.processingDate;
          return !pd || new Date(pd) >= sinceCutoff;
        });

        logger.debug(
          `Report ${reportId}: ${all.length} total instances, ${instances.length} within daysBack=${daysBack}`,
        );
      } catch (err: any) {
        logger.warn(
          `Fetching instances for report ${reportId}: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
        );
        continue;
      }

      for (const instance of instances) {
        let segmentUrls: string[] = [];

        try {
          const segResp = await axios.get(`${this.BASE}/analyticsReportInstances/${instance.id}/segments`, {
            headers,
          });

          this.logRateLimit(segResp.headers);
          segmentUrls = (segResp.data?.data ?? []).map((s: any) => s.attributes?.url).filter(Boolean);
        } catch (err: any) {
          logger.warn(`Fetching segments for instance ${instance.id}: ${err?.message ?? err}`);
          continue;
        }

        for (const url of segmentUrls) {
          try {
            const dlResp = await axios.get(url, { responseType: "arraybuffer" });
            const raw = zlib.gunzipSync(Buffer.from(dlResp.data)).toString("utf-8");
            const rows = parseTsv(raw);

            if (rows.length === 0) continue;
            logger.debug(`${reportItem.category} segment columns: ${Object.keys(rows[0]).join(" | ")}`);

            const metricsByDayCountry = parseAnalyticsSegment(rows, reportItem.category);
            storedRows += await storeAnalyticsSegment(bundleId, reportItem.category, metricsByDayCountry);

            const metricsByDayPlatform = parsePlatformSegment(rows, reportItem.category);
            await storePlatformSegment(bundleId, reportItem.category, metricsByDayPlatform);
          } catch (err: any) {
            logger.warn(`Downloading/parsing engagement segment: ${err?.message ?? err}`);
          }
        }
      }
    }

    return storedRows;
  }

  async fetchEngagementReport(
    ascAppId: string,
    bundleId: string,
    requestId: string | null,
    snapshotRequestId: string | null,
    daysBack = 60,
  ): Promise<{
    rows: number;
    requestId: string | null;
    snapshotRequestId: string | null;
  }> {
    if (!ascAppId) {
      logger.warn("ASC App ID not configured – skipping engagement report fetch");
      return { rows: 0, requestId: null, snapshotRequestId: null };
    }

    const headers = this.authHeaders();

    if (!requestId) {
      try {
        const createResp = await axios.post(
          `${this.BASE}/analyticsReportRequests`,
          {
            data: {
              type: "analyticsReportRequests",
              attributes: { accessType: "ONGOING" },
              relationships: {
                app: { data: { type: "apps", id: ascAppId } },
              },
            },
          },
          { headers },
        );

        this.logRateLimit(createResp.headers);

        requestId = createResp.data?.data?.id ?? null;
        if (!requestId) throw new Error("No request ID in create response");
        logger.info(`Created ONGOING analytics report request ${requestId} for ${bundleId}.`);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 409) {
          try {
            const listResp = await axios.get(`${this.BASE}/apps/${ascAppId}/analyticsReportRequests`, {
              headers,
              params: { "filter[accessType]": "ONGOING", limit: 10 },
            });

            this.logRateLimit(listResp.headers);
            const existing = (listResp.data?.data ?? []).find((r: any) => r.attributes?.accessType === "ONGOING");
            requestId = existing?.id ?? null;

            if (requestId) {
              logger.info(`Recovered existing ONGOING analytics request ${requestId} for ${bundleId}.`);
            } else {
              logger.warn(`Could not recover existing ONGOING request for ${bundleId}.`);
            }
          } catch (listErr: any) {
            logger.warn(`Listing existing analytics requests failed: ${listErr?.message ?? listErr}`);
          }
        } else {
          logger.warn(
            `Creating ONGOING analytics report request failed: ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
          );
        }
      }

      let snapshotRows = 0;
      let resolvedSnapshotId: string | null = null;

      try {
        const snapResp = await axios.post(
          `${this.BASE}/analyticsReportRequests`,
          {
            data: {
              type: "analyticsReportRequests",
              attributes: { accessType: "ONE_TIME_SNAPSHOT" },
              relationships: {
                app: { data: { type: "apps", id: ascAppId } },
              },
            },
          },
          { headers },
        );

        this.logRateLimit(snapResp.headers);
        resolvedSnapshotId = snapResp.data?.data?.id ?? null;

        if (resolvedSnapshotId) {
          logger.info(
            `Created ONE_TIME_SNAPSHOT request ${resolvedSnapshotId} for ${bundleId} – processing historical data now.`,
          );

          snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack);
          logger.info(`ONE_TIME_SNAPSHOT processed: ${snapshotRows} rows stored for ${bundleId}.`);
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 409) {
          logger.info(`ONE_TIME_SNAPSHOT already exists for this month (${bundleId}), recovering it.`);
          try {
            const listResp = await axios.get(`${this.BASE}/apps/${ascAppId}/analyticsReportRequests`, {
              headers,
              params: { "filter[accessType]": "ONE_TIME_SNAPSHOT", limit: 10 },
            });

            this.logRateLimit(listResp.headers);
            const existingSnap = (listResp.data?.data ?? []).find(
              (r: any) => r.attributes?.accessType === "ONE_TIME_SNAPSHOT",
            );

            if (existingSnap?.id) {
              resolvedSnapshotId = existingSnap.id as string;
              snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack);
              logger.info(`Existing ONE_TIME_SNAPSHOT processed: ${snapshotRows} rows for ${bundleId}.`);
            }
          } catch (snapListErr: any) {
            logger.warn(`Could not process existing snapshot: ${snapListErr?.message ?? snapListErr}`);
          }
        } else {
          logger.info(
            `ONE_TIME_SNAPSHOT request failed (non-fatal): ${err?.response?.data ? JSON.stringify(err.response.data) : (err?.message ?? err)}`,
          );
        }
      }

      return {
        rows: snapshotRows,
        requestId,
        snapshotRequestId: resolvedSnapshotId,
      };
    }

    let storedRows = await this.processAnalyticsRequest(bundleId, requestId, daysBack);

    if (snapshotRequestId) {
      const snapRows = await this.processAnalyticsRequest(bundleId, snapshotRequestId, daysBack);
      storedRows += snapRows;
      if (snapRows > 0) {
        logger.info(`ONE_TIME_SNAPSHOT catch-up: ${snapRows} rows for ${bundleId} (snapshot: ${snapshotRequestId})`);
      }
    }

    logger.info(`Engagement report: stored ${storedRows} rows for ${bundleId} (ongoing: ${requestId})`);
    return { rows: storedRows, requestId, snapshotRequestId };
  }

  async fetchReviews(ascAppId: string, bundleId: string): Promise<number> {
    const headers = this.authHeaders();
    let cursor: string | null = null;
    let total = 0;
    const maxPages = 5;

    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, any> = {
        sort: "-createdDate",
        limit: 200,
        "fields[customerReviews]": "rating,title,body,reviewerNickname,territory,createdDate",
      };
      if (cursor) params["cursor"] = cursor;

      const resp = await axios.get(`${this.BASE}/apps/${ascAppId}/customerReviews`, {
        headers,
        params,
      });

      this.logRateLimit(resp.headers);

      const reviews: any[] = resp.data?.data ?? [];

      await Promise.all(
        reviews.map((r) => {
          const attrs = r.attributes ?? {};
          return prisma.appReview.upsert({
            where: { ascReviewId: r.id },
            create: {
              ascReviewId: r.id,
              bundleId,
              rating: attrs.rating ?? 0,
              title: attrs.title ?? null,
              body: attrs.body ?? null,
              reviewerNickname: attrs.reviewerNickname ?? null,
              territory: attrs.territory ?? null,
              reviewedAt: new Date(attrs.createdDate ?? Date.now()),
            },
            update: {
              rating: attrs.rating ?? 0,
              title: attrs.title ?? null,
              body: attrs.body ?? null,
            },
          });
        }),
      );
      total += reviews.length;

      const nextCursor = resp.data?.links?.next;
      if (!nextCursor || reviews.length === 0) break;
      try {
        const url = new URL(nextCursor);
        cursor = url.searchParams.get("cursor");
      } catch {
        break;
      }
    }

    return total;
  }

  async syncAllAnalytics(bundleId: string, ascAppId: string): Promise<AnalyticsSyncResult> {
    try {
      const latestRecord = await prisma.appStoreAnalytics.findFirst({
        where: { bundleId },
        orderBy: { reportDate: "desc" },
        select: { reportDate: true },
      });

      const isFirstSync = !latestRecord;
      const salesDaysBack = isFirstSync ? 365 : 3;
      const engagementDaysBack = isFirstSync ? 60 : 3;

      logger.info(
        `Analytics sync for ${bundleId}: ${isFirstSync ? "first sync, full backfill" : `incremental, last ${salesDaysBack} days`}`,
      );

      const downloadDays = await this.fetchSalesReports(bundleId, ascAppId, salesDaysBack);

      let reviewsFetched = 0;
      if (ascAppId) {
        reviewsFetched = await this.fetchReviews(ascAppId, bundleId);
      }

      let engagementRows = 0;
      if (ascAppId) {
        try {
          const appRecord = await prisma.app.findUnique({
            where: { bundleId },
            select: {
              analyticsRequestId: true,
              analyticsSnapshotRequestId: true,
            },
          });

          const currentRequestId = appRecord?.analyticsRequestId ?? null;
          const currentSnapshotId = appRecord?.analyticsSnapshotRequestId ?? null;

          const result = await this.fetchEngagementReport(
            ascAppId,
            bundleId,
            currentRequestId,
            currentSnapshotId,
            engagementDaysBack,
          );
          engagementRows = result.rows;

          const updates: Record<string, string> = {};
          if (result.requestId && result.requestId !== currentRequestId) {
            updates.analyticsRequestId = result.requestId;
          }

          if (result.snapshotRequestId && result.snapshotRequestId !== currentSnapshotId) {
            updates.analyticsSnapshotRequestId = result.snapshotRequestId;
          }

          if (Object.keys(updates).length > 0) {
            await prisma.app.update({ where: { bundleId }, data: updates });
            logger.info(`Stored analytics IDs for ${bundleId}: ${JSON.stringify(updates)}`);
          }
        } catch (err: any) {
          logger.warn(`Engagement report fetch error (non-fatal): ${err?.message ?? err}`);
        }
      }

      logger.info(
        `ASC analytics sync done: ${downloadDays} report-days, ${reviewsFetched} reviews, ${engagementRows} engagement rows`,
      );

      return { downloadDays, reviewsFetched };
    } catch (err: any) {
      const error = err?.message ?? String(err);
      logger.error("ASC analytics sync failed", { error });
      return { downloadDays: 0, reviewsFetched: 0, error };
    }
  }
}
