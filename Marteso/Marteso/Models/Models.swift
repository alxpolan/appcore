import Foundation

struct DayData: Codable, Identifiable {
    var id: String { date }
    let date: String
    let downloads: Int
    let updates: Int
    let proceeds: Double
    let impressions: Int
    let pageViews: Int
    let sessions: Int
}

struct CountryData: Codable, Identifiable {
    var id: String { country }
    let country: String
    let downloads: Int
    let impressions: Int
    let pageViews: Int
}

struct DownloadsData: Codable {
    let byDay: [DayData]
    let byCountry: [CountryData]
}

struct AnalyticsSummary: Codable {
    let totalDownloads: Int
    let totalProceeds: Double
    let totalImpressions: Int
    let totalPageViews: Int
    let totalSessions: Int
    let conversionRate: Double?
    let avgRating: Double?
    let reviewCount: Int
    let lastSyncAt: String?
}

struct Review: Codable, Identifiable {
    let id: String
    let rating: Int
    let title: String?
    let body: String?
    let reviewerNickname: String?
    let territory: String?
    let reviewedAt: String?
}

struct AppItem: Codable, Identifiable {
    let id: String
    let bundleId: String
    let name: String
    let displayName: String?
    let isOwnApp: Bool

    var displayNameOrName: String { displayName ?? name }
    let rating: Double?
    let ratingsCount: Int?
    let iconUrl: String?
    let subtitle: String?
    let competitorCount: Int?
    let updatedAt: String?
}

struct AscApp: Codable, Identifiable {
    var id: String { ascId }
    let ascId: String
    let name: String
    let bundleId: String
    let sku: String?
    let primaryLocale: String?
    let iconUrl: String?
}

struct AppInfo: Codable {
    let name: String
    let displayName: String?
    let bundleId: String

    var displayNameOrName: String { displayName ?? name }
    let title: String?
    let subtitle: String?
    let keywords: String?
    let rating: Double?
    let ratingsCount: Int?
    let iconUrl: String?
}

struct Stats: Codable {
    let apps: Int
    let snapshots: Int
    let keywords: Int
    let rankings: Int
    let pendingSuggestions: Int
    let appliedSuggestions: Int
}

struct DashboardConfig: Codable {
    let bundleId: String?
    let country: String?
    let locales: String?
    let aiProvider: String?
    let hasOpenAI: Bool?
    let hasAnthropic: Bool?
    let hasASC: Bool?
    let hasSearchAds: Bool?
    let scrapeInterval: Int?

    var localeList: [String] { locales?.components(separatedBy: ",") ?? [] }
}

struct LastJob: Codable {
    let type: String
    let status: String
    let createdAt: String
    let itemsCount: Int?
}

struct RecentSuggestion: Codable, Identifiable {
    let id: String
    let type: String
    let locale: String
    let value: String
    let confidence: Double?
    let status: String
    let createdAt: String
}

struct DashboardData: Codable {
    let app: AppInfo?
    let stats: Stats
    let config: DashboardConfig
    let lastJob: LastJob?
    let recentSuggestions: [RecentSuggestion]
}

struct DashboardAllResponse: Codable {
    let dashboard: DashboardData
    let downloads: DownloadsData
}

struct TopCompetitor: Codable {
    let name: String
    let rank: Int
}

struct Keyword: Codable, Identifiable {
    let id: String
    let term: String
    let country: String
    let language: String?
    let popularity: Int?
    let difficulty: Double?
    let searchVolume: Int?
    let ourRank: Int?
    let topCompetitor: TopCompetitor?
    let trackingCount: Int?
    let suggestionCount: Int?
    let updatedAt: String?
}

struct RankingEntry: Codable, Identifiable {
    var id: String { "\(appBundleId)-\(trackedAt)" }
    let rank: Int?
    let appName: String
    let appBundleId: String
    let country: String
    let trackedAt: String
}

struct KeywordInfo: Codable {
    let id: String
    let term: String
    let popularity: Int?
    let difficulty: Double?
}

struct KeywordHistoryData: Codable {
    let keyword: KeywordInfo
    let rankings: [RankingEntry]
}

struct VersionSummary: Codable, Identifiable {
    var id: String { versionId }
    let versionId: String
    let versionString: String
    let appStoreState: String
    let platform: String?
    let isEditable: Bool?
}

struct VersionLocalization: Codable, Identifiable {
    var id: String { locale }
    let locale: String
    let appInfoLocalizationId: String?
    let versionLocalizationId: String?
    let name: String?
    let subtitle: String?
    let description: String?
    let keywords: String?
    let whatsNew: String?
    let promotionalText: String?
}

struct VersionsData: Codable {
    let appId: String
    let appName: String
    let bundleId: String
    let versionId: String
    let versionString: String
    let appStoreState: String
    let isEditable: Bool
    let localizations: [VersionLocalization]
}

struct Suggestion: Codable, Identifiable {
    let id: String
    let type: String
    let locale: String
    let suggestedValue: String
    let currentValue: String?
    let reasoning: String?
    let confidenceScore: Double?
    let estimatedImpact: String?
    let status: String
    let aiProvider: String?
    let aiModel: String?
    let keyword: String?
    let createdAt: String
    let appliedAt: String?
}

struct KeywordListResponse: Codable {
    let items: [Keyword]
    let total: Int
}

struct BuildJob: Codable, Identifiable {
    let id: String
    let appId: String
    let branch: String?
    let commitSha: String?
    let status: String
    let logs: [String]?
    let errors: [String]
    let errorSummary: String?
    let ipaPath: String?
    let version: String?
    let buildNumber: String?
    let startedAt: String?
    let completedAt: String?
    let createdAt: String
}

struct LatestBuildInfo: Codable {
    let builtAt: String
    let originalFilename: String
    let bundleId: String
    let exportMethod: String
    let sizeBytes: Int
    let iconUrl: String?
    let version: String?
    let buildNumber: String?
}

struct LatestBuildResponse: Codable {
    let build: LatestBuildInfo?
}

struct ScreenshotJob: Codable, Identifiable {
    let id: String
    let appId: String
    let commitSha: String
    let commitMessage: String?
    let branch: String?
    let pusher: String?
    let status: String
    let logs: [String]
    let error: String?
    let screenshotUrls: [String]
    let startedAt: String?
    let completedAt: String?
    let createdAt: String
}

struct GoogleAdsCampaign: Codable, Identifiable {
    let id: String
    let name: String
    let status: String
    let dailyBudget: Double?
    let currency: String?
    let spend: Double
    let impressions: Int
    let clicks: Int
    let conversions: Double
    let ctr: Double?
    let avgCpc: Double?
}

struct GoogleAdsCampaignsResponse: Codable {
    let campaigns: [GoogleAdsCampaign]
}

struct AppleAdsCampaign: Codable, Identifiable {
    let id: String
    let name: String
    let status: String
    let servingStatus: String
    let dailyBudget: Double?
    let totalBudget: Double?
    let currency: String?
    let countriesOrRegions: [String]?
    let startTime: String?
    let endTime: String?
    let spend: Double
    let impressions: Int
    let taps: Int
    let installs: Int
    let avgCpa: Double?
}

struct AppleAdsCampaignsResponse: Codable {
    let campaigns: [AppleAdsCampaign]
}

struct ProductPageVersion: Codable, Identifiable {
    let id: String
    let version: String?
    let state: String?
    let deepLink: String?
    let isEditable: Bool?
}

struct ProductPage: Codable, Identifiable {
    let id: String
    let name: String
    let url: String?
    let visible: Bool?
    let versions: [ProductPageVersion]?
}

struct ProductPagesResponse: Codable {
    let pages: [ProductPage]
}

struct SuggestionsResponse: Codable {
    let suggestions: [String: [Suggestion]]
    let total: Int

    var flat: [Suggestion] { suggestions.values.flatMap { $0 }
        .sorted { $0.createdAt > $1.createdAt } }
}

struct AuthUser: Codable {
    let id: String
    let email: String
    let name: String?
    let role: String
    let teamId: String?
    let teamRole: String?
}

struct AuthResponse: Codable {
    let user: AuthUser
    let hasPasskeys: Bool?
}

struct DeviceTokenRegistration: Codable {
    let deviceToken: String
    let bundleId: String?
}

struct PushNotificationPayload: Codable {
    let title: String
    let body: String
    let category: String?
    let data: [String: String]?
}
