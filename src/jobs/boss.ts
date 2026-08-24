import { PgBoss } from "pg-boss";
import { logger } from "../config";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { QUEUE_NAME as TRACK_KEYWORDS_QUEUE, handler as trackKeywordsHandler } from "./workers/track-keywords.worker";
import type { TrackKeywordsData } from "./workers/track-keywords.worker";
import { QUEUE_NAME as SCRAPE_QUEUE, handler as scrapeHandler } from "./workers/scrape.worker";
import type { ScrapeData } from "./workers/scrape.worker";
import { QUEUE_NAME as SYNC_ANALYTICS_QUEUE, handler as syncAnalyticsHandler } from "./workers/sync-analytics.worker";
import type { SyncAnalyticsData } from "./workers/sync-analytics.worker";
import {
  QUEUE_NAME as EXTRACT_KEYWORDS_QUEUE,
  handler as extractKeywordsHandler,
} from "./workers/extract-keywords.worker";
import type { ExtractKeywordsData } from "./workers/extract-keywords.worker";
import {
  QUEUE_NAME as DISCOVER_KEYWORDS_QUEUE,
  handler as discoverKeywordsHandler,
} from "./workers/discover-keywords.worker";
import type { DiscoverKeywordsData } from "./workers/discover-keywords.worker";
import {
  QUEUE_NAME as DISCOVER_COMPETITORS_QUEUE,
  handler as discoverCompetitorsHandler,
} from "./workers/discover-competitors.worker";
import type { DiscoverCompetitorsData } from "./workers/discover-competitors.worker";
import { QUEUE_NAME as ANALYZE_QUEUE, handler as analyzeHandler } from "./workers/analyze.worker";
import type { AnalyzeData } from "./workers/analyze.worker";
import { QUEUE_NAME as SYNC_METADATA_QUEUE, handler as syncMetadataHandler } from "./workers/sync-metadata.worker";
import {
  QUEUE_NAME as COMPETITOR_INTEL_QUEUE,
  handler as competitorIntelHandler,
} from "./workers/competitor-intel.worker";
import {
  QUEUE_NAME as TRANSLATE_LOCALIZATION_QUEUE,
  handler as translateLocalizationHandler,
} from "./workers/translate-localization.worker";
import { QUEUE_NAME as ASC_MAILBOX_QUEUE, handler as ascMailboxHandler } from "./workers/asc-mailbox.worker";

async function loadTeamApps() {
  return prisma.team.findMany({
    include: {
      apps: { where: { isOwnApp: true } },
    },
  });
}

export class BossScheduler {
  private boss: InstanceType<typeof PgBoss>;

  constructor() {
    this.boss = new PgBoss({ connectionString: env.DATABASE_URL });
    this.boss.on("error", (err: Error) => logger.error("[BOSS] Unexpected error", { error: err }));
  }

  private _running = false;

  get isRunning(): boolean {
    return this._running;
  }

  async start(): Promise<void> {
    await this.boss.start();

    const allQueues = [
      TRACK_KEYWORDS_QUEUE,
      `${TRACK_KEYWORDS_QUEUE}/dispatch`,
      SCRAPE_QUEUE,
      `${SCRAPE_QUEUE}/dispatch`,
      SYNC_ANALYTICS_QUEUE,
      `${SYNC_ANALYTICS_QUEUE}/dispatch`,
      EXTRACT_KEYWORDS_QUEUE,
      `${EXTRACT_KEYWORDS_QUEUE}/dispatch`,
      DISCOVER_KEYWORDS_QUEUE,
      `${DISCOVER_KEYWORDS_QUEUE}/dispatch`,
      DISCOVER_COMPETITORS_QUEUE,
      `${DISCOVER_COMPETITORS_QUEUE}/dispatch`,
      ANALYZE_QUEUE,
      `${ANALYZE_QUEUE}/dispatch`,
      SYNC_METADATA_QUEUE,
      COMPETITOR_INTEL_QUEUE,
      TRANSLATE_LOCALIZATION_QUEUE,
      ASC_MAILBOX_QUEUE,
    ];
    for (const q of allQueues) {
      await this.boss.createQueue(q);
    }

    // ── track-keywords ──────────────────────────────────────────────────────
    await this.boss.work(`${TRACK_KEYWORDS_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: TrackKeywordsData = {
            teamId: team.id,
            appId: app.id,
            bundleId: app.bundleId,
            country: app.country,
          };
          await this.boss.send(TRACK_KEYWORDS_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${TRACK_KEYWORDS_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(TRACK_KEYWORDS_QUEUE, trackKeywordsHandler);
    await this.boss.schedule(`${TRACK_KEYWORDS_QUEUE}/dispatch`, "0 */12 * * *", {}, { tz: "Europe/Berlin" });

    // ── scrape ──────────────────────────────────────────────────────────────
    await this.boss.work(`${SCRAPE_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: ScrapeData = {
            bundleId: app.bundleId,
            country: app.country,
          };
          await this.boss.send(SCRAPE_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${SCRAPE_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(SCRAPE_QUEUE, scrapeHandler);
    await this.boss.schedule(
      `${SCRAPE_QUEUE}/dispatch`,
      "0 */12 * * *",
      {},
      { tz: "Europe/Berlin" },
    );

    // ── sync-analytics ──────────────────────────────────────────────────────
    await this.boss.work(`${SYNC_ANALYTICS_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          if (!app.trackId) continue;
          const data: SyncAnalyticsData = {
            teamId: team.id,
            bundleId: app.bundleId,
            ascAppId: app.trackId.toString(),
          };
          await this.boss.send(SYNC_ANALYTICS_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${SYNC_ANALYTICS_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(SYNC_ANALYTICS_QUEUE, syncAnalyticsHandler);
    await this.boss.schedule(
      `${SYNC_ANALYTICS_QUEUE}/dispatch`,
      "0 2,6,10,14,18,22 * * *",
      {},
      { tz: "Europe/Berlin" },
    );

    // ── extract-keywords ─────────────────────────────────────────────────────
    /*await this.boss.work(`${EXTRACT_KEYWORDS_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: ExtractKeywordsData = {
            teamId: team.id,
            bundleId: app.bundleId,
            country: app.country,
          };
          await this.boss.send(EXTRACT_KEYWORDS_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${EXTRACT_KEYWORDS_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(EXTRACT_KEYWORDS_QUEUE, extractKeywordsHandler);
    await this.boss.schedule(
      `${EXTRACT_KEYWORDS_QUEUE}/dispatch`,
      "0 6 * * 1",
      {},
      { tz: "Europe/Berlin" },
    );*/

    // ── discover-keywords ────────────────────────────────────────────────────
    /*await this.boss.work(`${DISCOVER_KEYWORDS_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: DiscoverKeywordsData = {
            teamId: team.id,
            bundleId: app.bundleId,
          };
          await this.boss.send(DISCOVER_KEYWORDS_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${DISCOVER_KEYWORDS_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(DISCOVER_KEYWORDS_QUEUE, discoverKeywordsHandler);
    await this.boss.schedule(
      `${DISCOVER_KEYWORDS_QUEUE}/dispatch`,
      "0 3,11,19 * * *",
      {},
      { tz: "Europe/Berlin" },
    );*/

    // ── discover-competitors ─────────────────────────────────────────────────
    /*await this.boss.work(`${DISCOVER_COMPETITORS_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: DiscoverCompetitorsData = {
            bundleId: app.bundleId,
            country: app.country,
          };
          await this.boss.send(DISCOVER_COMPETITORS_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${DISCOVER_COMPETITORS_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(DISCOVER_COMPETITORS_QUEUE, discoverCompetitorsHandler);
    await this.boss.schedule(
      `${DISCOVER_COMPETITORS_QUEUE}/dispatch`,
      "0 5 * * *",
      {},
      { tz: "Europe/Berlin" },
    );*/

    // ── analyze ──────────────────────────────────────────────────────────────
    /*await this.boss.work(`${ANALYZE_QUEUE}/dispatch`, async () => {
      const teams = await loadTeamApps();
      for (const team of teams) {
        for (const app of team.apps) {
          const data: AnalyzeData = {
            teamId: team.id,
            bundleId: app.bundleId,
          };
          await this.boss.send(ANALYZE_QUEUE, data);
          logger.info(`[BOSS] Enqueued ${ANALYZE_QUEUE} for ${app.bundleId}`);
        }
      }
    });
    await this.boss.work(ANALYZE_QUEUE, analyzeHandler);
    await this.boss.schedule(
      `${ANALYZE_QUEUE}/dispatch`,
      "0 8 * * *",
      {},
      { tz: "Europe/Berlin" },
    );*/

    // ── sync-metadata (manual only) ─────────────────────────────────────────
    await this.boss.work(SYNC_METADATA_QUEUE, syncMetadataHandler);

    // ── competitor-intel (manual only) ───────────────────────────────────────
    await this.boss.work(COMPETITOR_INTEL_QUEUE, competitorIntelHandler);

    // ── translate-localization (manual only) ─────────────────────────────────
    await this.boss.work(TRANSLATE_LOCALIZATION_QUEUE, translateLocalizationHandler);

    // ── asc-mailbox (auto-accept App Store Connect team invites) ─────────────
    await this.boss.work(ASC_MAILBOX_QUEUE, ascMailboxHandler);
    if (env.ASC_MAILBOX_IMAP_HOST) {
      await this.boss.schedule(ASC_MAILBOX_QUEUE, "*/2 * * * *", {}, { tz: "Europe/Berlin" });
    } else {
      logger.info(`[BOSS] ${ASC_MAILBOX_QUEUE} not scheduled — ASC_MAILBOX_IMAP_HOST not configured`);
    }

    logger.info(
      `[BOSS] Scheduler started — queues: ${TRACK_KEYWORDS_QUEUE}, ${SCRAPE_QUEUE}, ${SYNC_ANALYTICS_QUEUE}, ${EXTRACT_KEYWORDS_QUEUE}, ${DISCOVER_KEYWORDS_QUEUE}, ${DISCOVER_COMPETITORS_QUEUE}, ${ANALYZE_QUEUE}, ${SYNC_METADATA_QUEUE}, ${COMPETITOR_INTEL_QUEUE}, ${TRANSLATE_LOCALIZATION_QUEUE}, ${ASC_MAILBOX_QUEUE}`,
    );
    this._running = true;
  }

  async stop(): Promise<void> {
    await this.boss.stop();
    this._running = false;
    logger.info("[BOSS] Scheduler stopped");
  }

  async triggerDispatch(queue: string): Promise<void> {
    await this.boss.send(`${queue}/dispatch`, {});
  }

  async sendJob<T extends object>(queue: string, data: T): Promise<void> {
    await this.boss.send(queue, data);
  }

  async cancelAllJobs(queue?: string): Promise<void> {
    await this.boss.deleteAllJobs(queue);
  }
}

export const bossScheduler = new BossScheduler();
