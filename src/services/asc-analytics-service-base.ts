import zlib from "zlib";
import axios from "./utils/http";
import { prisma, logger } from "../config";
import type { EffectiveSettings } from "../config/userSettings";
import { generateASCToken } from "./utils/asc-token";
import { AppStoreConnectClient } from "./appstore-connect";
import { fetchSubscriptionPrices } from "./asc-subscription-prices";
import { ALPHA2_TO_ALPHA3 } from "./utils/territory-codes";
import { fmtDate, parseTsv } from "./asc-analytics-core";
import {
  MAX_TRIAL_CANCELLATION_BACKFILL_DAYS,
  activeFreeTrials,
  parseTrialCancellationSegment,
  storeTrialCancellationSegment,
  type TrialPotential,
} from "./asc-analytics-trials";

export class AscAnalyticsServiceBase {
  protected readonly settings: EffectiveSettings;
  protected readonly BASE = "https://api.appstoreconnect.apple.com/v1";

  constructor(settings: EffectiveSettings) {
    this.settings = settings;
  }

  protected authHeaders() {
    return {
      Authorization: `Bearer ${generateASCToken({
        issuerId: this.settings.ascIssuerId,
        keyId: this.settings.ascKeyId,
        privateKey: this.settings.ascPrivateKey,
      })}`,
    };
  }

  protected logRateLimit(headers: Record<string, any>): void {
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

  async fetchTrialPotential(appAppleId: string, bundleId: string): Promise<TrialPotential> {
    if (!this.settings.ascVendorNumber) {
      return { reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] };
    }

    const headers = this.authHeaders();
    let reportDate: string | null = null;
    let rows: Record<string, string>[] = [];

    for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
      const day = new Date();

      day.setUTCDate(day.getUTCDate() - daysAgo);
      const date = fmtDate(day);
      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SUBSCRIPTION",
            "filter[reportSubType]": "SUMMARY",
            "filter[version]": "1_3",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": date,
          },
          responseType: "arraybuffer",
        });

        this.logRateLimit(resp.headers);
        rows = parseTsv(zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8"));
        reportDate = date;
        break;
      } catch (err: any) {
        if (err?.response?.status === 404) continue;
        throw err;
      }
    }

    if (!reportDate) return { reportDate: null, trialCount: 0, potentialProceedsUsd: null, unpricedTrials: 0, countryTotals: [] };

    const trialsBySubscriptionAndCountry = new Map<string, { subscriptionId: string; country: string; territory: string | null; count: number }>();
    let trialCount = 0;
    let unpricedTrials = 0;
    for (const row of rows) {
      if ((row["App Apple ID"] ?? "").trim() !== appAppleId) continue;
      const subscriptionId = (row["Subscription Apple ID"] ?? "").trim();
      const count = activeFreeTrials(row);
      if (count <= 0) continue;
      trialCount += count;
      const country = (row["Country"] ?? "").trim().toUpperCase();
      const territory = ALPHA2_TO_ALPHA3[country] ?? null;

      if (!subscriptionId || !territory) {
        unpricedTrials += count;
        continue;
      }

      const key = `${subscriptionId}:${territory}`;
      const current = trialsBySubscriptionAndCountry.get(key);

      trialsBySubscriptionAndCountry.set(key, { subscriptionId, country, territory, count: (current?.count ?? 0) + count });
    }

    const today = fmtDate(new Date());

    const cancellations = await prisma.appStoreTrialCancellation.findMany({
      where: { bundleId, trialEndDate: { gte: new Date(today) } },
      select: { subscriptionId: true, country: true, quantity: true },
    });

    const cancelledByKey = new Map<string, number>();
    for (const c of cancellations) {
      const key = `${c.subscriptionId}:${c.country}`;

      cancelledByKey.set(key, (cancelledByKey.get(key) ?? 0) + c.quantity);
    }

    const asc = new AppStoreConnectClient({
      issuerId: this.settings.ascIssuerId,
      keyId: this.settings.ascKeyId,
      privateKey: this.settings.ascPrivateKey,
    }, { teamId: this.settings.teamId });

    const pricesBySubscription = new Map<string, Awaited<ReturnType<typeof fetchSubscriptionPrices>>>();
    const countryTotals = new Map<string, { country: string; trialCount: number; proceedsUsd: number }>();
    for (const { subscriptionId, country, territory, count: rawCount } of trialsBySubscriptionAndCountry.values()) {
      const alreadyOptedOut = cancelledByKey.get(`${subscriptionId}:${country}`) ?? 0;
      const count = Math.max(0, rawCount - alreadyOptedOut);
      if (count <= 0) continue;

      try {
        let prices = pricesBySubscription.get(subscriptionId);

        if (!prices) {
          prices = await fetchSubscriptionPrices(asc, subscriptionId);
          pricesBySubscription.set(subscriptionId, prices);
        }

        const current = prices
          .filter((price) => price.territory === territory && (!price.startDate || price.startDate.slice(0, 10) <= today))
          .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];

        const proceedsUsd = current?.proceedsUsd == null ? NaN : Number(current.proceedsUsd);

        if (!Number.isFinite(proceedsUsd)) {
          unpricedTrials += count;
        } else {
          const total = countryTotals.get(country) ?? { country, trialCount: 0, proceedsUsd: 0 };

          total.trialCount += count;
          total.proceedsUsd += count * proceedsUsd;
          countryTotals.set(country, total);
        }
      } catch (err: any) {
        logger.warn(`Fetching prices for subscription ${subscriptionId}: ${err?.message ?? err}`);
        unpricedTrials += count;
      }
    }

    const totals = [...countryTotals.values()].sort((a, b) => b.trialCount - a.trialCount || a.country.localeCompare(b.country));
    const potentialProceedsUsd = totals.reduce((sum, total) => sum + total.proceedsUsd, 0);

    return {
      reportDate,
      trialCount,
      potentialProceedsUsd: unpricedTrials > 0 ? null : Math.round(potentialProceedsUsd * 100) / 100,
      unpricedTrials,
      countryTotals: totals.map((total) => ({ ...total, proceedsUsd: Math.round(total.proceedsUsd * 100) / 100 })),
    };
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

  async fetchTrialCancellations(bundleId: string, appAppleId: string, daysBack = 3): Promise<number> {
    if (!this.settings.ascVendorNumber || !appAppleId) return 0;

    const headers = this.authHeaders();
    const cappedDaysBack = Math.min(daysBack, MAX_TRIAL_CANCELLATION_BACKFILL_DAYS);
    let stored = 0;

    for (let i = 1; i <= cappedDaysBack; i++) {
      const day = new Date();

      day.setUTCDate(day.getUTCDate() - i);
      const dateStr = fmtDate(day);

      try {
        const resp = await axios.get(`${this.BASE}/salesReports`, {
          headers: { ...headers, Accept: "application/a-gzip" },
          params: {
            "filter[frequency]": "DAILY",
            "filter[reportType]": "SUBSCRIPTION_EVENT",
            "filter[reportSubType]": "SUMMARY",
            "filter[version]": "1_3",
            "filter[vendorNumber]": this.settings.ascVendorNumber,
            "filter[reportDate]": dateStr,
          },
          responseType: "arraybuffer",
        });

        this.logRateLimit(resp.headers);
        const raw = zlib.gunzipSync(Buffer.from(resp.data)).toString("utf-8");
        const rows = parseTsv(raw);
        const cancelRows = parseTrialCancellationSegment(rows, appAppleId);

        if (cancelRows.length > 0) {
          stored += await storeTrialCancellationSegment(bundleId, cancelRows);
        }
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 400) {
          logger.debug(`No subscription event report for ${dateStr}`);
          continue;
        }

        logger.warn(`Subscription event report fetch failed for ${dateStr}: ${err?.message ?? err}`);
      }
    }

    return stored;
  }
}
