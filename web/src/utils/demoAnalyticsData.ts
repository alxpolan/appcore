import type {
  AnalyticsSummary,
  CountryData,
  DayData,
  DownloadsData,
  LtvData,
  PlatformsData,
  PurchaseData,
  RatingsData,
  Review,
} from "../types";
import { type RangeKey } from "./analyticsRange";

// Deterministic pseudo-random generator so demo charts stay stable across re-renders
// instead of jumping around on every render like Math.random() would.
function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rangeToDays(range: RangeKey): number {
  switch (range) {
    case "1d":
      return 1;
    case "7d":
      return 7;
    case "14d":
      return 14;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "180d":
      return 180;
    case "365d":
      return 365;
    case "ytd": {
      const start = new Date(new Date().getFullYear(), 0, 1);
      return Math.max(1, Math.ceil((Date.now() - start.getTime()) / 86400000) + 1);
    }
    case "all":
      return 180;
    default:
      return 30;
  }
}

export const DEMO_COUNTRIES = ["US", "GB", "DE", "FR", "CA", "AU", "JP", "BR", "IN", "NL"];
const COUNTRY_WEIGHTS = [0.32, 0.14, 0.11, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05, 0.05];
// Must match the exact strings DownloadSourcesChart.tsx's SOURCE_ORDER recognizes,
// otherwise it can't match them to a known series and everything falls out of the chart.
const SOURCE_TYPES = ["App Store search", "App Store browse", "App referrer", "Web referrer", "Unavailable"];
const SOURCE_WEIGHTS = [0.45, 0.2, 0.15, 0.12, 0.08];

export function generateDemoDownloads(range: RangeKey, seed = 42, scale = 1): DownloadsData {
  const days = rangeToDays(range);
  const rand = mulberry32(seed);
  const today = new Date();
  const base = 140 * scale;

  const byDay: DayData[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const trend = 1 + ((days - i) / days) * 0.35;
    const weekendDip = d.getDay() === 0 || d.getDay() === 6 ? 0.82 : 1;
    const noise = 0.75 + rand() * 0.5;
    const downloads = Math.max(1, Math.round(base * trend * weekendDip * noise));
    const impressions = Math.round(downloads * (18 + rand() * 6));
    const pageViews = Math.round(impressions * (0.22 + rand() * 0.08));
    const sessions = Math.round(downloads * (2.5 + rand() * 1.5));
    const proceeds = Math.round(downloads * (0.15 + rand() * 0.1) * 100) / 100;
    byDay.push({
      date,
      downloads,
      updates: Math.round(downloads * (0.3 + rand() * 0.2)),
      proceeds,
      impressions,
      pageViews,
      sessions,
      installs: downloads,
      deletions: Math.round(downloads * (0.05 + rand() * 0.05)),
    });
  }

  const totalDownloads = byDay.reduce((s, d) => s + d.downloads, 0);
  const totalImpressions = byDay.reduce((s, d) => s + d.impressions, 0);
  const totalPageViews = byDay.reduce((s, d) => s + d.pageViews, 0);

  const byCountry: CountryData[] = DEMO_COUNTRIES.map((country, i) => ({
    country,
    downloads: Math.round(totalDownloads * COUNTRY_WEIGHTS[i]),
    impressions: Math.round(totalImpressions * COUNTRY_WEIGHTS[i]),
    pageViews: Math.round(totalPageViews * COUNTRY_WEIGHTS[i]),
  }));

  const countrySeries = DEMO_COUNTRIES.slice(0, 5);
  const byCountryDay = byDay.map((d) => {
    const row: { date: string } & Record<string, number | string> = { date: d.date };
    let used = 0;
    countrySeries.forEach((code, i) => {
      const v = Math.round(d.downloads * COUNTRY_WEIGHTS[i]);
      row[code] = v;
      used += v;
    });
    row.Other = Math.max(0, d.downloads - used);
    return row;
  });

  const bySourceDay = byDay.map((d) => {
    const row: { date: string } & Record<string, number | string> = { date: d.date };
    SOURCE_TYPES.forEach((s, i) => {
      row[s] = Math.round(d.downloads * SOURCE_WEIGHTS[i]);
    });
    return row;
  });

  return { byDay, byCountry, countrySeries, byCountryDay, sourceTypes: SOURCE_TYPES, bySourceDay };
}

export function generateDemoSummary(downloads: DownloadsData): AnalyticsSummary {
  const totalDownloads = downloads.byDay.reduce((s, d) => s + d.downloads, 0);
  const totalProceeds = downloads.byDay.reduce((s, d) => s + d.proceeds, 0);
  const totalImpressions = downloads.byDay.reduce((s, d) => s + d.impressions, 0);
  const totalPageViews = downloads.byDay.reduce((s, d) => s + d.pageViews, 0);
  const totalSessions = downloads.byDay.reduce((s, d) => s + d.sessions, 0);
  return {
    totalDownloads,
    totalProceeds,
    totalImpressions,
    totalPageViews,
    totalSessions,
    totalPayingUsers: Math.round(totalDownloads * 0.06),
    minimumOsVersion: "16.0",
    impressionsBelowMinOs: Math.round(totalImpressions * 0.08),
    conversionRate: totalImpressions > 0 ? (totalDownloads / totalImpressions) * 100 : null,
    avgRating: 4.6,
    reviewCount: 128,
    lastSyncAt: null,
  };
}

export function generateDemoPlatforms(totalImpressions: number): PlatformsData {
  const versions = ["17.4", "17.3", "17.0", "16.5", "16.0", "15.7"];
  const weights = [0.34, 0.22, 0.18, 0.12, 0.09, 0.05];
  return {
    byVersion: versions.map((iosVersion, i) => {
      const impressions = Math.round(totalImpressions * weights[i]);
      const tapRate = Math.max(0.03, 0.12 - i * 0.015);
      const taps = Math.round(impressions * tapRate);
      return {
        iosVersion,
        impressions,
        pageViews: Math.round(impressions * 0.25),
        taps,
        sessions: Math.round(taps * 2.2),
      };
    }),
  };
}

const DEMO_PRODUCTS = [
  { name: "Pro Monthly", type: "Auto-Renewable Subscription" },
  { name: "Pro Yearly", type: "Auto-Renewable Subscription" },
  { name: "Remove Ads", type: "Non-Consumable" },
  { name: "50 Credits", type: "Consumable" },
];
const PAYMENT_METHODS = ["Apple Wallet", "Credit Card", "PayPal via Apple"];

export function generateDemoPurchases(count: number, seed = 7): PurchaseData[] {
  const rand = mulberry32(seed);
  const today = new Date();
  const rows: PurchaseData[] = Array.from({ length: count }, () => {
    const d = new Date(today);
    d.setDate(d.getDate() - Math.floor(rand() * 14));
    const product = DEMO_PRODUCTS[Math.floor(rand() * DEMO_PRODUCTS.length)];
    const country = DEMO_COUNTRIES[Math.floor(rand() * DEMO_COUNTRIES.length)];
    const purchases = 1 + Math.floor(rand() * 4);
    const unitPrice = 2 + rand() * 8;
    return {
      date: d.toISOString().slice(0, 10),
      purchaseType: product.type,
      contentName: product.name,
      paymentMethod: PAYMENT_METHODS[Math.floor(rand() * PAYMENT_METHODS.length)],
      territory: country,
      purchases,
      proceedsUsd: Math.round(purchases * unitPrice * 0.7 * 100) / 100,
      salesUsd: Math.round(purchases * unitPrice * 100) / 100,
      payingUsers: purchases,
    };
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

const DEMO_REVIEW_SNIPPETS: { rating: number; title: string; body: string }[] = [
  { rating: 5, title: "Exactly what I needed", body: "Clean design and does everything I want. Highly recommend!" },
  { rating: 5, title: "Great app", body: "Works flawlessly, no crashes, love the UI." },
  { rating: 5, title: "Best in class", body: "Switched from a competitor and never looking back." },
  { rating: 4, title: "Pretty good", body: "Solid app overall, a few minor bugs but nothing major." },
  { rating: 4, title: "Does the job", body: "Not flashy but reliable. Would like more customization options." },
  { rating: 3, title: "It's okay", body: "Works fine but the onboarding was confusing at first." },
  { rating: 2, title: "Needs work", body: "Crashes occasionally on my device. Please fix." },
];
const DEMO_NICKNAMES = ["Alex", "Jamie", "Sam", "Chris", "Jordan", "Taylor", "Morgan", "Casey"];

export function generateDemoReviews(count: number, seed = 11): Review[] {
  const rand = mulberry32(seed);
  const today = new Date();
  const rows: Review[] = Array.from({ length: count }, (_, i) => {
    const snippet = DEMO_REVIEW_SNIPPETS[Math.floor(rand() * DEMO_REVIEW_SNIPPETS.length)];
    const d = new Date(today);
    d.setDate(d.getDate() - Math.floor(rand() * 60));
    return {
      id: `demo-review-${i}`,
      rating: snippet.rating,
      title: snippet.title,
      body: snippet.body,
      reviewerNickname: DEMO_NICKNAMES[Math.floor(rand() * DEMO_NICKNAMES.length)],
      territory: DEMO_COUNTRIES[Math.floor(rand() * DEMO_COUNTRIES.length)],
      reviewedAt: d.toISOString(),
    };
  });
  return rows.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
}

export function generateDemoRatings(days = 90, seed = 13): RatingsData {
  const rand = mulberry32(seed);
  const today = new Date();
  const byDay = Array.from({ length: days }, (_, idx) => {
    const i = days - 1 - idx;
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return {
      date: d.toISOString().slice(0, 10),
      rating: Math.round((4.3 + rand() * 0.4) * 10) / 10,
      ratingsCount: 80 + Math.floor(rand() * 40),
    };
  });
  return { byDay, current: { rating: 4.6, ratingsCount: 128 } };
}

export function generateDemoLtv(downloads: DownloadsData): LtvData {
  let cumDownloads = 0;
  let cumRevenue = 0;
  const byDay = downloads.byDay.map((d) => {
    cumDownloads += d.downloads;
    cumRevenue += d.proceeds;
    return {
      date: d.date,
      cumulativeDownloads: cumDownloads,
      cumulativeRevenue: Math.round(cumRevenue * 100) / 100,
      ltv: cumDownloads > 0 ? Math.round((cumRevenue / cumDownloads) * 100) / 100 : 0,
    };
  });
  return { byDay, currentLtv: byDay[byDay.length - 1]?.ltv ?? 0 };
}
