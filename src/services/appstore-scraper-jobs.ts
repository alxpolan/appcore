import { prisma, logger } from "../config";
import { AppStoreScraperPage } from "./appstore-scraper-page";

export class AppStoreScraper extends AppStoreScraperPage {
  async scrapeAndSaveApp(bundleId: string, isOwnApp = false): Promise<string | null> {
    const itunesData = await this.lookupByBundleId(bundleId);

    if (!itunesData) {
      logger.warn(`App not found: ${bundleId}`);

      return null;
    }

    const app = await prisma.app.upsert({
      where: { bundleId },
      create: {
        bundleId,
        name: itunesData.trackName,
        trackId: BigInt(itunesData.trackId),
        country: this.country,
        isOwnApp,
        currentTitle: itunesData.trackName,
        currentDescription: itunesData.description,
        minimumOsVersion: itunesData.minimumOsVersion,
      },
      update: {
        name: itunesData.trackName,
        trackId: BigInt(itunesData.trackId),
        currentTitle: itunesData.trackName,
        currentDescription: itunesData.description,
        minimumOsVersion: itunesData.minimumOsVersion,
      },
    });

    const webData = await this.scrapeAppStorePage(itunesData.trackId);

    if (webData?.subtitle) {
      await prisma.app.update({
        where: { id: app.id },
        data: { currentSubtitle: webData.subtitle },
      });
    }

    const prevSnapshot = await prisma.appSnapshot.findFirst({
      where: { appId: app.id },
      orderBy: { scrapedAt: "desc" },
    });

    if (prevSnapshot) {
      const changes: Array<{
        field: string;
        oldValue: string | null;
        newValue: string | null;
        detectedAt?: Date;
      }> = [];

      const compare = (
        field: string,
        oldVal: string | null | undefined,
        newVal: string | null | undefined,
        detectedAt?: Date,
      ) => {
        const o = oldVal ?? null;
        const n = newVal ?? null;
        if (o !== n)
          changes.push({
            field,
            oldValue: o ? String(o).substring(0, 5000) : null,
            newValue: n ? String(n).substring(0, 5000) : null,
            detectedAt,
          });
      };

      const releaseDate = itunesData.currentVersionReleaseDate
        ? new Date(itunesData.currentVersionReleaseDate)
        : undefined;

      compare("title", prevSnapshot.title, itunesData.trackName);
      compare("subtitle", prevSnapshot.subtitle, webData?.subtitle);
      compare("description", prevSnapshot.description, itunesData.description);
      compare("version", prevSnapshot.version, itunesData.version, releaseDate);
      compare("releaseNotes", prevSnapshot.releaseNotes, itunesData.releaseNotes ?? webData?.whatsNew);
      compare("rating", prevSnapshot.rating?.toFixed(2), itunesData.averageUserRating?.toFixed(2));
      compare("price", prevSnapshot.price?.toString(), itunesData.price?.toString());

      if (changes.length > 0) {
        await prisma.appMetadataChange.createMany({
          data: changes.map((c) => ({
            appId: app.id,
            field: c.field,
            oldValue: c.oldValue,
            newValue: c.newValue,
            ...(c.detectedAt ? { detectedAt: c.detectedAt } : {}),
          })),
        });
        logger.info(
          `Detected ${changes.length} metadata changes for ${bundleId}: ${changes.map((c) => c.field).join(", ")}`,
        );
      }
    }

    const description = itunesData.description;
    const screenshotUrls = itunesData.screenshotUrls?.length ? itunesData.screenshotUrls : (webData?.screenshots ?? []);

    await prisma.appSnapshot.create({
      data: {
        appId: app.id,
        title: itunesData.trackName,
        subtitle: webData?.subtitle,
        description,
        rating: itunesData.averageUserRating,
        ratingsCount: itunesData.userRatingCount,
        price: itunesData.price,
        version: itunesData.version,
        releaseNotes: itunesData.releaseNotes ?? webData?.whatsNew,
        screenshotUrls,
        iconUrl: itunesData.artworkUrl512,
        developerName: itunesData.sellerName,
        category: itunesData.primaryGenreName,
        categoryId: itunesData.primaryGenreId,
        descriptionLength: description.length,
        wordCount: description.split(/\s+/).length,
      },
    });

    if (isOwnApp && itunesData.trackId) {
      const history = await this.scrapeVersionHistory(itunesData.trackId);

      if (history.length > 0) {
        const existing = await prisma.appMetadataChange.findMany({
          where: { appId: app.id, field: "version" },
          select: { newValue: true },
        });

        const existingVersions = new Set(existing.map((e) => e.newValue));
        const toCreate = history.filter(({ version }) => !existingVersions.has(version));

        if (toCreate.length > 0) {
          await prisma.appMetadataChange.createMany({
            data: toCreate.map(({ version, date }) => ({
              appId: app.id,
              field: "version",
              oldValue: null,
              newValue: version,
              detectedAt: new Date(date),
            })),
          });
          logger.info(
            `Backfilled ${toCreate.length} version(s) for ${bundleId}: ${toCreate.map((v) => v.version).join(", ")}`,
          );
        }
      }
    }

    logger.info(`Scraped and saved: ${itunesData.trackName} (${bundleId})`);

    return app.id;
  }

  async discoverCompetitors(searchTerms: string[], ownBundleId: string, maxResults = 100): Promise<string[]> {
    const seen = new Set<string>();
    const competitorIds: string[] = [];

    for (const term of searchTerms) {
      const results = await this.searchApps(term, 10);

      for (const result of results) {
        if (result.bundleId === ownBundleId || seen.has(result.bundleId)) {
          continue;
        }

        seen.add(result.bundleId);

        if (competitorIds.length >= maxResults) break;

        const appId = await this.scrapeAndSaveApp(result.bundleId, false);
        if (appId) competitorIds.push(appId);
      }

      if (competitorIds.length >= maxResults) break;

      await this.sleep(1000);
    }

    const ownApp = await prisma.app.findUnique({
      where: { bundleId: ownBundleId },
    });

    if (ownApp) {
      await Promise.all(
        competitorIds.map((competitorId) =>
          prisma.competitorRelation.upsert({
            where: { appId_competitorId: { appId: ownApp.id, competitorId } },
            create: { appId: ownApp.id, competitorId },
            update: {},
          }),
        ),
      );
    }

    logger.info(`Discovered ${competitorIds.length} competitors for "${ownBundleId}"`);

    return competitorIds;
  }

  async runFullScrapeJob(): Promise<void> {
    try {
      await this.scrapeAndSaveApp(this.bundleId, true);

      const ownApp = await prisma.app.findUnique({
        where: { bundleId: this.bundleId },
        include: { competitors: { include: { competitor: true } } },
      });

      let count = 1;

      if (ownApp) {
        for (const rel of ownApp.competitors) {
          await this.scrapeAndSaveApp(rel.competitor.bundleId, false);
          count++;
          await this.sleep(500);
        }
      }

      logger.info(`Full scrape job completed: ${count} apps scraped`);
    } catch (error) {
      throw error;
    }
  }
}
