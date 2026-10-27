import axios from "./utils/http";
import * as cheerio from "cheerio";
import { logger } from "../config";
import { AppStoreScraperItunes } from "./appstore-scraper-itunes";

export class AppStoreScraperPage extends AppStoreScraperItunes {
  private parseServerData($: cheerio.CheerioAPI): any | null {
    const raw = $("#serialized-server-data").html();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      logger.warn("Failed to parse App Store serialized-server-data", {
        error: error instanceof Error ? error.message : error,
      });

      return null;
    }
  }

  private buildArtworkUrl(screenshot: any): string | null {
    const template = screenshot?.template;
    if (typeof template !== "string" || !template.includes("{w}")) return null;
    const width = screenshot.width ?? 1290;
    const height = screenshot.height ?? 2796;
    const crop = typeof screenshot.crop === "string" ? screenshot.crop : "bb";
    const rawFormat = screenshot.variants?.[0]?.format;
    const format = rawFormat === "jpeg" ? "jpg" : rawFormat || "jpg";

    return template
      .replace("{w}", String(width))
      .replace("{h}", String(height))
      .replace("{c}", crop)
      .replace("{f}", format);
  }

  private extractScreenshots(serverData: any): string[] {
    const items = serverData?.data?.[0]?.data?.shelfMapping?.product_media_phone_?.items;
    if (!Array.isArray(items)) return [];

    return items
      .map((item: any) => this.buildArtworkUrl(item?.screenshot))
      .filter((url: string | null): url is string => Boolean(url));
  }

  async scrapeAppStorePage(trackId: number): Promise<{
    subtitle?: string;
    fullDescription?: string;
    whatsNew?: string;
    screenshots?: string[];
    ratings?: { average: number; count: number };
  } | null> {
    try {
      const url = `https://apps.apple.com/${this.country}/app/id${trackId}`;
      const { data: html } = await axios.get<string>(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": `${this.language},en;q=0.9`,
        },
      });

      const $ = cheerio.load(html);
      const serverData = this.parseServerData($);
      const lockup = serverData?.data?.[0]?.data?.lockup;

      const subtitle =
        (typeof lockup?.subtitle === "string" ? lockup.subtitle.trim() : "") ||
        $('h2[class*="subtitle"]').text().trim() ||
        $(".app-header__subtitle").text().trim() ||
        undefined;

      const fullDescription =
        $('[data-test-id="description"] .we-truncate__child').text().trim() ||
        $(".section__description .we-truncate__child").text().trim() ||
        undefined;

      const whatsNew = $('[data-test-id="version-notes"]').text().trim() || undefined;

      const screenshots = this.extractScreenshots(serverData);

      return { subtitle, fullDescription, whatsNew, screenshots };
    } catch (error) {
      logger.warn(`Failed to scrape App Store page for track ${trackId}`, {
        error: error instanceof Error ? error.message : error,
      });

      return null;
    }
  }

  async scrapeMonetization(trackId: number): Promise<Array<{ name: string; price: string | null }>> {
    try {
      const url = `https://apps.apple.com/${this.country}/app/id${trackId}`;
      const { data: html } = await axios.get<string>(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": `${this.language},en;q=0.9`,
        },
      });

      const $ = cheerio.load(html);
      const serverData = this.parseServerData($);
      const infoItems = serverData?.data?.[0]?.data?.shelfMapping?.information?.items;
      if (!Array.isArray(infoItems)) return [];

      const section = infoItems.find((it: any) =>
        /in.?app purchase/i.test(typeof it?.title === "string" ? it.title : ""),
      );

      if (!section) return [];

      const pairs: Array<[string, string | null]> = [];

      if (Array.isArray(section.items_V3)) {
        for (const p of section.items_V3) {
          const name = typeof p?.leadingText === "string" ? p.leadingText.trim() : "";
          const price = typeof p?.trailingText === "string" ? p.trailingText.trim() : null;
          if (name) pairs.push([name, price || null]);
        }
      } else if (Array.isArray(section.items)) {
        for (const group of section.items) {
          for (const tp of group?.textPairs ?? []) {
            if (!Array.isArray(tp)) continue;
            const name = typeof tp[0] === "string" ? tp[0].trim() : "";
            const price = typeof tp[1] === "string" ? tp[1].trim() : null;
            if (name) pairs.push([name, price || null]);
          }
        }
      }

      const items: Array<{ name: string; price: string | null }> = [];
      const seen = new Set<string>();
      for (const [name, price] of pairs) {
        const key = `${name}|${price ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ name, price });
      }

      return items;
    } catch (error) {
      logger.warn(`Failed to scrape monetization for track ${trackId}`, {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async scrapeLanguages(trackId: number): Promise<string[]> {
    try {
      const url = `https://apps.apple.com/us/app/id${trackId}`;
      const { data: html } = await axios.get<string>(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const $ = cheerio.load(html);
      const serverData = this.parseServerData($);
      const infoItems = serverData?.data?.[0]?.data?.shelfMapping?.information?.items;
      if (!Array.isArray(infoItems)) return [];

      const section = infoItems.find(
        (it: any) => (typeof it?.title === "string" ? it.title.trim() : "").toLowerCase() === "languages",
      );

      if (!section) return [];

      const raw: string =
        (typeof section.items?.[0]?.text === "string" && section.items[0].text) ||
        (typeof section.items_V3?.[0]?.linkableText?.styledText?.rawText === "string" &&
          section.items_V3[0].linkableText.styledText.rawText) ||
        "";

      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (error) {
      logger.warn(`Failed to scrape languages for track ${trackId}`, {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }

  async scrapeVersionHistory(trackId: number): Promise<Array<{ version: string; date: string }>> {
    try {
      const url = `https://apps.apple.com/us/app/id${trackId}`;
      const { data: html } = await axios.get<string>(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const $ = cheerio.load(html);
      const results: Array<{ version: string; date: string }> = [];
      const seen = new Set<string>();

      $("time[datetime]").each((_, el) => {
        const timeEl = $(el);
        const datetime = timeEl.attr("datetime");
        if (!datetime) return;
        const dateStr = datetime.slice(0, 10);
        const prevH4 = timeEl.prev("h4");
        const siblingText = prevH4.length ? prevH4.text().trim() : "";
        const versionFromH4 = siblingText.match(/^(?:Version\s+)?([\d]+(?:\.[\d]+)+)$/i)?.[1] ?? null;

        const container = timeEl.closest("li, .version-history__item, section, [data-test-id]");
        const containerText = (container.length ? container : timeEl.parent()).text();
        const versionFromText = containerText.match(/Version\s+([\d]+(?:\.[\d]+)*)/i)?.[1] ?? null;

        const version = versionFromH4 ?? versionFromText;

        if (version && dateStr && !seen.has(version)) {
          seen.add(version);
          results.push({ version, date: dateStr });
        }
      });

      return results.sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
      logger.warn(`Failed to scrape version history for track ${trackId}`, {
        error: error instanceof Error ? error.message : error,
      });

      return [];
    }
  }
}
