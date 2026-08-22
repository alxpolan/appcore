/**
 * Backfill the AppStoreAnalyticsPlatform table with older data.
 *
 * The table was introduced after most apps already had their initial (60-day)
 * engagement sync, so incremental syncs only ever pulled the last 3 days into it.
 * This reprocesses existing analytics report requests further back without
 * creating new requests, so it's safe to re-run (upserts are idempotent).
 *
 * Example:
 *   npx tsx scripts/backfill-asc-analytics-platform.ts --days-back 60
 */
import "dotenv/config";
import { prisma } from "../src/config/database";
import { getEffectiveSettings } from "../src/config/userSettings";
import { AscAnalyticsService } from "../src/services/asc-analytics";

const USER_EMAIL = "admin@fringelo.com";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const daysBack = parseInt(option("--days-back") ?? "60", 10);
  const bundleIdFilter = option("--bundle-id");

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL }, select: { id: true } });
  if (!user) throw new Error(`User ${USER_EMAIL} not found.`);

  const settings = await getEffectiveSettings(user.id);
  if (!settings.ascIssuerId || !settings.ascKeyId || !settings.ascPrivateKey) {
    throw new Error("ASC credentials not configured.");
  }

  const apps = await prisma.app.findMany({
    where: {
      teamId: settings.teamId!,
      trackId: { not: null },
      ...(bundleIdFilter ? { bundleId: bundleIdFilter } : {}),
      OR: [{ analyticsRequestId: { not: null } }, { analyticsSnapshotRequestId: { not: null } }],
    },
    select: { bundleId: true, name: true, trackId: true, analyticsRequestId: true, analyticsSnapshotRequestId: true },
  });

  const service = new AscAnalyticsService(settings);

  for (const app of apps) {
    console.log(`\n=== ${app.name} (${app.bundleId}) ===`);
    try {
      const result = await service.fetchEngagementReport(
        app.trackId!.toString(),
        app.bundleId,
        app.analyticsRequestId,
        app.analyticsSnapshotRequestId,
        daysBack,
      );
      console.log(`  stored ${result.rows} rows (daysBack=${daysBack})`);
    } catch (err) {
      console.log(`  failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Backfill failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
