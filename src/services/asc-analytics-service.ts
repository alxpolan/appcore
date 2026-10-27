import zlib from "zlib";
import axios from "./utils/http";
import { prisma, logger } from "../config";
import { needsCampaignBackfill } from "./utils/google-ads-mapping";
import {
  TRACKED_ANALYTICS_REPORTS,
  parseAnalyticsSegment,
  parseDownloadsSegment,
  parseInstallDeletionSegment,
  parsePlatformSegment,
  parsePurchasesSegment,
  parseSessionCohortSegment,
  parseTsv,
  storeAnalyticsSegment,
  storeDownloadsSegment,
  storeInstallDeletionSegment,
  storePlatformSegment,
  storePurchasesSegment,
  storeSessionCohortSegment,
  type ReportKind,
} from "./asc-analytics-core";
import { parseCampaignPurchasesSegment, storeCampaignMetricsSegment } from "./asc-analytics-campaign";
import { MAX_TRIAL_CANCELLATION_BACKFILL_DAYS, type AnalyticsSyncResult } from "./asc-analytics-trials";
import { AscAnalyticsServiceBase } from "./asc-analytics-service-base";

export class AscAnalyticsService extends AscAnalyticsServiceBase {
  private async processAnalyticsRequest(
    bundleId: string,
    requestId: string,
    daysBack: number,
    daysBackByKind?: Partial<Record<ReportKind, number>>,
  ): Promise<number> {
    const headers = this.authHeaders();

    let reportItems: Array<{ id: string; kind: ReportKind }> = [];
    try {
      const reportsResp = await axios.get(`${this.BASE}/analyticsReportRequests/${requestId}/reports`, { headers });

      this.logRateLimit(reportsResp.headers);

      const reports: any[] = reportsResp.data?.data ?? [];

      logger.debug(
        `Analytics request ${requestId}: ${reports.length} report(s) – categories: ${reports.map((r) => r.attributes?.category).join(", ")}`,
      );

      reportItems = reports
        .map((r: any) => {
          const match = TRACKED_ANALYTICS_REPORTS.find(
            (t) =>
              t.category === r.attributes?.category &&
              (t.name === r.attributes?.name || t.namePattern?.test(r.attributes?.name ?? "")),
          );

          return match && r.id ? { id: r.id as string, kind: match.kind } : null;
        })
        .filter((r): r is { id: string; kind: ReportKind } => r !== null);

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
      const kindDaysBack = daysBackByKind?.[reportItem.kind] ?? daysBack;
      const sinceCutoff = new Date();

      sinceCutoff.setDate(sinceCutoff.getDate() - kindDaysBack);
      let instances: any[] = [];

      try {
        const all: any[] = [];
        let cursor: string | null = null;
        const maxPages = 10;

        for (let page = 0; page < maxPages; page++) {
          const params: Record<string, any> = {
            "filter[granularity]": "DAILY",
            limit: 200,
          };

          if (cursor) params["cursor"] = cursor;

          const instResp = await axios.get(`${this.BASE}/analyticsReports/${reportId}/instances`, {
            headers,
            params,
          });

          this.logRateLimit(instResp.headers);

          const pageItems: any[] = instResp.data?.data ?? [];

          all.push(...pageItems);

          const nextLink = instResp.data?.links?.next;
          if (!nextLink || pageItems.length === 0) break;
          try {
            cursor = new URL(nextLink).searchParams.get("cursor");
          } catch {
            break;
          }

          if (!cursor) break;
        }

        instances = all.filter((inst: any) => {
          const pd: string | undefined = inst.attributes?.processingDate;

          return !pd || new Date(pd) >= sinceCutoff;
        });

        logger.debug(
          `Report ${reportId}: ${all.length} total instances fetched, ${instances.length} within daysBack=${kindDaysBack}`,
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
            logger.debug(`${reportItem.kind} segment columns: ${Object.keys(rows[0]).join(" | ")}`);

            if (reportItem.kind === "engagement" || reportItem.kind === "usage") {
              const metricsByDayCountry = parseAnalyticsSegment(rows, reportItem.kind);

              storedRows += await storeAnalyticsSegment(bundleId, reportItem.kind, metricsByDayCountry);

              const metricsByDayPlatform = parsePlatformSegment(rows, reportItem.kind);

              await storePlatformSegment(bundleId, reportItem.kind, metricsByDayPlatform);

              if (reportItem.kind === "usage") {
                const cohortRows = parseSessionCohortSegment(rows);

                await storeSessionCohortSegment(bundleId, cohortRows);
              }
            } else if (reportItem.kind === "installDeletion") {
              const installDeletionRows = parseInstallDeletionSegment(rows);

              storedRows += await storeInstallDeletionSegment(bundleId, installDeletionRows);
            } else if (reportItem.kind === "downloads") {
              const downloadRows = parseDownloadsSegment(rows);

              storedRows += await storeDownloadsSegment(bundleId, downloadRows);
            } else if (reportItem.kind === "purchases") {
              const purchaseRows = parsePurchasesSegment(rows);

              storedRows += await storePurchasesSegment(bundleId, purchaseRows);
            } else if (reportItem.kind === "downloadsDetailed") {
              logger.debug("Skipping official campaign downloads segment (superseded by web sync)");
            } else if (reportItem.kind === "purchasesDetailed") {
              const campaignRows = parseCampaignPurchasesSegment(rows);
              storedRows += await storeCampaignMetricsSegment(bundleId, campaignRows, [
                "purchases",
                "trials",
                "proceedsUsd",
              ]);
            }
          } catch (err: any) {
            logger.warn(`Downloading/parsing ${reportItem.kind} segment: ${err?.message ?? err}`);
          }
        }
      }
    }

    return storedRows;
  }

  private async createAndProcessSnapshot(
    ascAppId: string,
    bundleId: string,
    daysBack: number,
    daysBackByKind?: Partial<Record<ReportKind, number>>,
  ): Promise<{ snapshotRequestId: string | null; rows: number }> {
    const headers = this.authHeaders();
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

        snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack, daysBackByKind);
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
            snapshotRows = await this.processAnalyticsRequest(bundleId, resolvedSnapshotId, daysBack, daysBackByKind);
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

    return { snapshotRequestId: resolvedSnapshotId, rows: snapshotRows };
  }

  async fetchEngagementReport(
    ascAppId: string,
    bundleId: string,
    requestId: string | null,
    snapshotRequestId: string | null,
    daysBack = 60,
    daysBackByKind?: Partial<Record<ReportKind, number>>,
    needsSnapshotBackfill = false,
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

      const snap = await this.createAndProcessSnapshot(ascAppId, bundleId, daysBack, daysBackByKind);

      return {
        rows: snap.rows,
        requestId,
        snapshotRequestId: snap.snapshotRequestId,
      };
    }

    let storedRows = await this.processAnalyticsRequest(bundleId, requestId, daysBack, daysBackByKind);

    if (snapshotRequestId) {
      const snapRows = await this.processAnalyticsRequest(bundleId, snapshotRequestId, daysBack, daysBackByKind);

      storedRows += snapRows;

      if (snapRows > 0) {
        logger.info(`ONE_TIME_SNAPSHOT catch-up: ${snapRows} rows for ${bundleId} (snapshot: ${snapshotRequestId})`);
      }
    } else if (needsSnapshotBackfill) {
      logger.info(`No ONE_TIME_SNAPSHOT on file for ${bundleId} yet a backfill is needed — requesting one now.`);
      const snap = await this.createAndProcessSnapshot(ascAppId, bundleId, daysBack, daysBackByKind);

      storedRows += snap.rows;
      snapshotRequestId = snap.snapshotRequestId;
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

          const [installDeletionCount, sessionCohortCount, mappingCount, oldestCampaignRow] = await Promise.all([
            prisma.appStoreInstallDeletion.count({ where: { bundleId } }),
            prisma.appStoreSessionCohort.count({ where: { bundleId } }),
            prisma.googleAdsCampaignToken.count({ where: { app: { bundleId } } }),
            prisma.appStoreCampaignMetrics.findFirst({
              where: { bundleId },
              orderBy: { reportDate: "asc" },
              select: { reportDate: true },
            }),
          ]);

          const overrides: Partial<
            Record<"installDeletion" | "usage" | "downloadsDetailed" | "purchasesDetailed", number>
          > = {};

          if (installDeletionCount === 0) overrides.installDeletion = 365;
          if (sessionCohortCount === 0) overrides.usage = 365;
          const campaignBackfillNeeded = needsCampaignBackfill({
            mappingCount,
            oldestReportDate: oldestCampaignRow?.reportDate ?? null,
          });

          if (campaignBackfillNeeded) {
            overrides.downloadsDetailed = 365;
            overrides.purchasesDetailed = 365;
            logger.info(`Campaign metrics backfill scheduled for ${bundleId} (365 days).`);
          }

          const daysBackByKind = Object.keys(overrides).length > 0 ? overrides : undefined;

          const result = await this.fetchEngagementReport(
            ascAppId,
            bundleId,
            currentRequestId,
            currentSnapshotId,
            engagementDaysBack,
            daysBackByKind,
            campaignBackfillNeeded,
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

      let trialCancellationsFetched = 0;

      if (ascAppId) {
        try {
          const existingCancellations = await prisma.appStoreTrialCancellation.count({ where: { bundleId } });
          const trialCancelDaysBack = existingCancellations === 0 ? MAX_TRIAL_CANCELLATION_BACKFILL_DAYS : 3;

          trialCancellationsFetched = await this.fetchTrialCancellations(bundleId, ascAppId, trialCancelDaysBack);
        } catch (err: any) {
          logger.warn(`Trial cancellation sync error (non-fatal): ${err?.message ?? err}`);
        }
      }

      logger.info(
        `ASC analytics sync done: ${downloadDays} report-days, ${reviewsFetched} reviews, ${engagementRows} engagement rows, ${trialCancellationsFetched} trial cancellations`,
      );

      return { downloadDays, reviewsFetched };
    } catch (err: any) {
      const error = err?.message ?? String(err);

      logger.error("ASC analytics sync failed", { error });

      return { downloadDays: 0, reviewsFetched: 0, error };
    }
  }
}
