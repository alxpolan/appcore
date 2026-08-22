export interface DayData {
  date: string;
  downloads: number;
  updates: number;
  proceeds: number;
  impressions: number;
  pageViews: number;
  sessions: number;
}

export type DownloadsDayData = Pick<DayData, "date" | "downloads" | "updates" | "proceeds">;

export interface CountryData {
  country: string;
  downloads: number;
  impressions: number;
  pageViews: number;
}

export interface DownloadsData {
  byDay: DayData[];
  byCountry: CountryData[];
}

export interface PlatformVersionData {
  iosVersion: string;
  impressions: number;
  pageViews: number;
  taps: number;
  sessions: number;
}

export interface PlatformsData {
  byVersion: PlatformVersionData[];
}

export interface PurchaseData {
  date: string;
  purchaseType: string;
  contentName: string;
  paymentMethod: string;
  territory: string;
  purchases: number;
  proceedsUsd: number;
  salesUsd: number;
  payingUsers: number;
}

export interface AnalyticsSummary {
  totalDownloads: number;
  totalProceeds: number;
  totalImpressions: number;
  totalPageViews: number;
  totalSessions: number;
  totalPayingUsers: number;
  minimumOsVersion: string | null;
  impressionsBelowMinOs: number | null;
  conversionRate: number | null;
  avgRating: number | null;
  reviewCount: number;
  lastSyncAt: string | null;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  reviewerNickname: string | null;
  territory: string | null;
  reviewedAt: string;
}

export interface AppItem {
  id: string;
  bundleId: string;
  name: string;
  displayName: string | null;
  isOwnApp: boolean;
  rating: number | null;
  ratingsCount: number | null;
  iconUrl: string | null;
  accentColor: string | null;
  subtitle: string | null;
  competitorCount: number;
  updatedAt: string;
}

export interface AscApp {
  ascId: string;
  name: string;
  bundleId: string;
  sku: string | null;
  primaryLocale: string | null;
  iconUrl: string | null;
}

export interface StoreApp {
  trackId: string;
  name: string;
  bundleId: string;
  sellerName: string;
  iconUrl: string | null;
  rating: number | null;
  ratingsCount: number | null;
  genre: string | null;
}

export interface AppInfo {
  name: string;
  displayName: string | null;
  bundleId: string;
  title: string;
  subtitle: string;
  keywords: string;
  rating: number;
  ratingsCount: number;
  iconUrl: string;
  accentColor: string | null;
}

export interface Stats {
  apps: number;
  snapshots: number;
  keywords: number;
  rankings: number;
  pendingSuggestions: number;
  appliedSuggestions: number;
  jobs: number;
}

export interface DashboardConfig {
  bundleId: string;
  country: string;
  locales: string;
  hasASC: boolean;
  hasSearchAds: boolean;
  scrapeInterval: number;
}

export interface LastJob {
  type: string;
  status: string;
  createdAt: string;
  itemsCount: number;
}

export interface RecentSuggestion {
  id: string;
  type: string;
  locale: string;
  value: string;
  confidence: number;
  status: string;
  createdAt: string;
}

export interface DashboardData {
  app: AppInfo | null;
  stats: Stats;
  config: DashboardConfig;
  lastJob: LastJob | null;
  recentSuggestions: RecentSuggestion[];
}

export interface Job {
  id: string;
  type: string;
  status: string;
  result: string | null;
  error: string | null;
  itemsCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Keyword {
  id: string;
  term: string;
  country: string;
  language: string;
  popularity: number | null;
  difficulty: number | null;
  searchVolume: number | null;
  ourRank: number | null;
  rankTrend: number | null;
  // topCompetitor: { name: string; rank: number } | null;
  topCompetitors: { name: string; iconUrl: string | null; rank: number }[];
  suggestionCount: number;
  groupId: string | null;
  updatedAt: string;
}

export interface KeywordGroup {
  id: string;
  name: string;
  sortOrder: number;
}

export interface RankingEntry {
  rank: number | null;
  appName: string;
  appBundleId: string;
  country: string;
  trackedAt: string;
}

export interface KeywordCompetitorRow {
  bundleId: string;
  name: string;
  iconUrl: string | null;
  rank: number | null;
  isTracked: boolean;
  isOwn: boolean;
}

export interface KeywordHistoryData {
  keyword: {
    id: string;
    term: string;
    popularity: number | null;
    difficulty: number | null;
  };
  ownAppId: string | null;
  rankings: RankingEntry[];
  competitors?: KeywordCompetitorRow[];
}

export interface Suggestion {
  id: string;
  type: string;
  locale: string;
  suggestedValue: string;
  currentValue: string | null;
  reasoning: string;
  confidenceScore: number | null;
  estimatedImpact: number | null;
  status: string;
  aiProvider: string;
  aiModel: string;
  keyword: string | null;
  createdAt: string;
  appliedAt: string | null;
}

export type TeamRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  teamId: string | null;
  teamRole: TeamRole | null;
  plan?: "pro" | "free";
  isDemo?: boolean;
  isFringeloTeam?: boolean;
}

export type AppRole = "OWNER" | "EDITOR" | "VIEWER";

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: AppRole;
  invitedBy: string | null;
  createdAt: string;
}

export interface SettingsData {
  ascIssuerId: string;
  ascKeyId: string;
  ascPrivateKey: string;
  ascPrivateKeySet: boolean;
  ascAppId: string;
  ascBundleId: string;
  ascVendorNumber: string;
  presetCopyright: string;
  reviewerFirstName: string;
  reviewerLastName: string;
  reviewerPhone: string;
  reviewerEmail: string;
  reviewerDemoAccountRequired: boolean;
  reviewerDemoUsername: string;
  reviewerDemoPassword: string;
}

export interface BillingPlan {
  price: number;
  currency: string;
  interval: "monthly" | "yearly";
}

export interface BillingSubscription {
  status: string;
  interval: "monthly" | "yearly" | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  renewsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  customerPortalUrl: string | null;
  updatePaymentMethodUrl: string | null;
}

export interface BillingStatus {
  configured: boolean;
  plans: { monthly: BillingPlan; yearly: BillingPlan };
  subscription: BillingSubscription | null;
}

export interface GitHubStatus {
  connected: boolean;
  username: string | null;
  avatarUrl: string | null;
  connectedAt: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export type Framework = "capacitor" | "native";

export interface AppRepoLink {
  linked: boolean;
  repoFullName: string | null;
  repoOwner: string | null;
  repoName: string | null;
  iosDir: string | null;
  framework: Framework | null;
}

export interface BuildJob {
  id: string;
  appId: string;
  branch: string | null;
  commitSha: string | null;
  status: string;
  logs: string[];
  errors: string[];
  ipaPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ScreenshotJob {
  id: string;
  appId: string;
  commitSha: string;
  commitMessage: string | null;
  branch: string | null;
  pusher: string | null;
  status: string;
  logs: string[];
  error: string | null;
  screenshotUrls: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SchedulerStatus {
  running: boolean;
  jobCount: number;
}

export interface McpConfig {
  mcpEnabled: boolean;
}

export interface OAuthClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  userId: string | null;
  createdAt: string;
}

export interface VersionSummary {
  versionId: string;
  versionString: string;
  appStoreState: string;
  platform: string;
  isEditable: boolean;
}

export interface VersionLocalization {
  locale: string;
  appInfoLocalizationId: string | null;
  versionLocalizationId: string | null;
  name: string;
  subtitle: string;
  description: string;
  keywords: string;
  whatsNew: string;
  promotionalText: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
  marketingUrl?: string;
}

export interface VersionLocalizationSummary {
  locale: string;
  appInfoLocalizationId: string | null;
  versionLocalizationId: string | null;
  isComplete: boolean;
  isOptimal: boolean;
  // Human-readable reasons the locale is yellow (non-optimal) or gray (incomplete); empty when green.
  qualityReasons: string[];
}

export interface VersionsData {
  appId: string;
  appName: string;
  bundleId: string;
  primaryLocale?: string | null;
  versionId: string | null;
  versionString: string | null;
  appStoreState: string | null;
  isEditable: boolean;
  copyright: string;
  ageRating?: string;
  reviewerFirstName?: string;
  reviewerLastName?: string;
  reviewerPhone?: string;
  reviewerEmail?: string;
  reviewerDemoAccountRequired?: boolean;
  reviewerDemoUsername?: string;
  reviewerDemoPassword?: string;
  reviewDetailId?: string | null;
  translatingLocales?: string[];
  localizationSummaries: VersionLocalizationSummary[];
  localizations: VersionLocalization[];
}

export interface CompetitorReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: string | null;
  territory: string | null;
  reviewedAt: string;
}

export interface CompetitorReviewSummary {
  id: string;
  reviewCount: number;
  averageRating: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  topThemes: string[];
  sentiment: string | null;
  createdAt: string;
}

export interface MetadataChange {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

export interface CompetitorKeywordRanking {
  keyword: string;
  keywordId: string;
  popularity: number | null;
  competitorRank: number | null;
  ourRank: number | null;
}

export interface CompetitorDetail {
  id: string;
  bundleId: string;
  name: string;
  trackId: string | null;
  country: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  rating: number | null;
  ratingsCount: number | null;
  iconUrl: string | null;
  version: string | null;
  developerName: string | null;
  category: string | null;
  reviews: CompetitorReview[];
  reviewSummary: CompetitorReviewSummary | null;
  metadataChanges: MetadataChange[];
  keywordRankings: CompetitorKeywordRanking[];
  untrackedKeywords?: string[];
  inAppPurchases?: CompetitorInAppPurchase[];
}

export interface CompetitorInAppPurchase {
  id: string;
  name: string;
  price: string | null;
  kind: string;
}

export interface SubscriptionItem {
  id: string;
  name: string;
  productId: string;
  familySharable: boolean;
  state: string;
  subscriptionPeriod: string | null;
  reviewNote: string | null;
  groupLevel: number | null;
}

export interface SubscriptionGroup {
  id: string;
  referenceName: string;
  subscriptions: SubscriptionItem[];
}

export interface SubscriptionGroupLocalization {
  id: string;
  locale: string;
  name: string;
  customAppName: string | null;
  state: string;
}

export interface SubscriptionLocalization {
  id: string;
  locale: string;
  name: string;
  description: string;
  state: string;
}

export interface SubscriptionPricePoint {
  id: string;
  customerPrice: string | null;
  proceeds: string | null;
  territory: string | null;
  currency: string | null;
}

export interface SubscriptionPrice {
  id: string;
  territory: string | null;
  currency: string | null;
  customerPrice: string | null;
  proceeds: string | null;
  pricePointId: string | null;
  startDate: string | null;
  preserved: boolean;
}

export interface SubscriptionReviewScreenshot {
  id: string;
  fileName: string | null;
  fileSize: number | null;
  assetDeliveryState: { state: string } | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductItem {
  id: string;
  name: string;
  productId: string;
  inAppPurchaseType: string;
  state: string;
  reviewNote: string | null;
}

export interface ProductLocalization {
  id: string;
  locale: string;
  name: string;
  description: string;
}

export interface ProductPricePoint {
  id: string;
  customerPrice: string | null;
  proceeds: string | null;
  territory: string | null;
  currency: string | null;
}

export interface ProductPrice {
  id: string;
  territory: string | null;
  currency: string | null;
  customerPrice: string | null;
  proceeds: string | null;
  startDate: string | null;
  pricePointId: string | null;
}

export interface SmartPriceRow {
  territory: string;
  currency: string | null;
  multiplier: number;
  currentPricePointId: string | null;
  currentPrice: string | null;
  suggestedPricePointId: string;
  suggestedPrice: string | null;
  suggestedProceeds: string | null;
  changed: boolean;
}
