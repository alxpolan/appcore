/**
 * Manually re-scrape all own apps for the admin@fringelo.com team.
 * Uses the same runFullScrapeJob() path as a fresh import, so it also
 * backfills fields added after the app was first imported (e.g. minimumOsVersion).
 *
 * Example:
 *   npx tsx scripts/rescrape-admin-apps.ts
 *   npx tsx scripts/rescrape-admin-apps.ts --bundle-id com.fringelo.gymnio.Gymnio
 */
import "dotenv/config";
import { prisma } from "../src/config/database";
import { AppStoreScraper } from "../src/services/appstore-scraper";

const USER_EMAIL = "admin@fringelo.com";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const bundleIdFilter = option("--bundle-id");

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User ${USER_EMAIL} not found.`);

  const member = await prisma.teamMember.findFirst({ where: { userId: user.id } });
  if (!member) throw new Error(`${USER_EMAIL} has no team membership.`);

  const apps = await prisma.app.findMany({
    where: {
      teamId: member.teamId,
      isOwnApp: true,
      ...(bundleIdFilter ? { bundleId: bundleIdFilter } : {}),
    },
    select: { bundleId: true, name: true, country: true },
  });

  console.log(`Found ${apps.length} own app(s) for ${USER_EMAIL}.`);

  for (const app of apps) {
    console.log(`\n=== ${app.name} (${app.bundleId}) ===`);
    try {
      await new AppStoreScraper(app.country, undefined, app.bundleId).runFullScrapeJob();
      const updated = await prisma.app.findUnique({
        where: { bundleId: app.bundleId },
        select: { minimumOsVersion: true },
      });
      console.log(`  ok — minimumOsVersion: ${updated?.minimumOsVersion ?? "(not returned by iTunes lookup)"}`);
    } catch (err) {
      console.log(`  failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error("Rescrape failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
