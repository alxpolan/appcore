import Foundation

// MARK: - API Service

@Observable
final class APIService {
    static let shared = APIService()

    let baseURL = "https://app.marteso.com"
    private(set) var isAuthenticated: Bool = false

    private var sessionActive: Bool {
        get { KeychainHelper.load(key: "auth_session") != nil }
        set {
            if newValue {
                KeychainHelper.save(key: "auth_session", value: "1")
            } else {
                KeychainHelper.delete(key: "auth_session")
                deleteCookies()
            }
            isAuthenticated = newValue
        }
    }

    private init() {
        isAuthenticated = KeychainHelper.load(key: "auth_session") != nil
    }

    private func deleteCookies() {
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies ?? [] where cookie.domain.contains("marteso.com") {
            storage.deleteCookie(cookie)
        }
    }

    // MARK: - Auth

    func login(email: String, password: String) async throws -> AuthResponse {
        let body: [String: String] = ["email": email, "password": password]
        let response: AuthResponse = try await post("/api/auth/login", body: body, authenticated: false)
        sessionActive = true
        return response
    }

    func register(email: String, password: String, name: String) async throws -> AuthResponse {
        let body: [String: String] = ["email": email, "password": password, "name": name]
        let response: AuthResponse = try await post("/api/auth/signup", body: body, authenticated: false)
        sessionActive = true
        return response
    }

    func logout() {
        Task {
            let url = URL(string: baseURL + "/api/auth/logout")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            _ = try? await URLSession.shared.data(for: request)
        }
        sessionActive = false
    }

    func getCurrentUser() async throws -> AuthUser {
        try await get("/api/auth/me")
    }

    // MARK: - Dashboard

    func getDashboard(bundleId: String?) async throws -> DashboardData {
        var path = "/api/dashboard"
        if let bundleId { path += "?bundleId=\(bundleId)" }
        return try await get(path)
    }

    func getAllDashboard(days: Int = 14) async throws -> (DashboardData, DownloadsData) {
        let response: DashboardAllResponse = try await get("/api/dashboard/all?days=\(days)")
        return (response.dashboard, response.downloads)
    }

    // MARK: - Apps

    func getApps(bundleId: String? = nil) async throws -> [AppItem] {
        var path = "/api/apps?ownOnly=true"
        if let bundleId { path += "&bundleId=\(bundleId)" }
        return try await get(path)
    }

    // MARK: - Analytics

    func getAnalyticsSummary(bundleId: String?, days: Int = 30) async throws -> AnalyticsSummary {
        var path = "/api/analytics/summary?days=\(days)"
        if let bundleId { path += "&bundleId=\(bundleId)" }
        return try await get(path)
    }

    func getDownloads(bundleId: String?, days: Int = 30) async throws -> DownloadsData {
        var path = "/api/analytics/downloads?days=\(days)"
        if let bundleId { path += "&bundleId=\(bundleId)" }
        return try await get(path)
    }

    func getReviews(bundleId: String?, limit: Int = 50) async throws -> [Review] {
        var path = "/api/analytics/reviews?limit=\(limit)"
        if let bundleId { path += "&bundleId=\(bundleId)" }
        return try await get(path)
    }

    func syncAnalytics() async throws {
        let _: EmptyResponse = try await post("/api/analytics/sync", body: EmptyBody())
    }

    func getAllAnalytics(days: Int = 30) async throws -> (AnalyticsSummary, DownloadsData) {
        let response: AnalyticsAllResponse = try await get("/api/analytics/all?days=\(days)")
        return (response.summary, response.downloads)
    }

    // MARK: - Keywords

    func getKeywords(bundleId: String?) async throws -> [Keyword] {
        var path = "/api/keywords"
        if let bundleId { path += "?bundleId=\(bundleId)" }
        let response: KeywordListResponse = try await get(path)
        return response.items
    }

    func getAllKeywords() async throws -> [(app: AppItem, items: [Keyword])] {
        let response: KeywordAllResponse = try await get("/api/keywords/all")
        return response.groups.map { (app: $0.app, items: $0.items) }
    }

    func getKeywordHistory(id: String) async throws -> KeywordHistoryData {
        try await get("/api/keywords/\(id)/history")
    }

    func addKeyword(term: String, country: String, language: String?, bundleId: String) async throws {
        var body: [String: String] = ["term": term, "country": country, "bundleId": bundleId]
        if let language { body["language"] = language }
        let _: EmptyResponse = try await post("/api/keywords", body: body)
    }

    func deleteKeyword(id: String) async throws {
        try await delete("/api/keywords/\(id)")
    }

    // MARK: - Versions

    func getVersionsList(bundleId: String?) async throws -> [VersionSummary] {
        var path = "/api/asc/versions/list"
        if let bundleId { path += "?bundleId=\(bundleId)" }
        return try await get(path)
    }

    func getVersionDetails(bundleId: String?, versionId: String?) async throws -> VersionsData {
        var params: [String] = []
        if let bundleId { params.append("bundleId=\(bundleId)") }
        if let versionId { params.append("versionId=\(versionId)") }
        let query = params.isEmpty ? "" : "?\(params.joined(separator: "&"))"
        return try await get("/api/asc/versions\(query)")
    }

    // MARK: - Suggestions

    func getSuggestions(bundleId: String?, status: String? = nil) async throws -> SuggestionsResponse {
        var params: [String] = []
        if let bundleId { params.append("bundleId=\(bundleId)") }
        if let status { params.append("status=\(status)") }
        let query = params.isEmpty ? "" : "?\(params.joined(separator: "&"))"
        return try await get("/api/suggestions\(query)")
    }

    func approveSuggestion(id: String) async throws {
        let _: EmptyResponse = try await post("/api/suggestions/\(id)/approve", body: EmptyBody())
    }

    func rejectSuggestion(id: String) async throws {
        let _: EmptyResponse = try await post("/api/suggestions/\(id)/reject", body: EmptyBody())
    }

    func applySuggestion(id: String) async throws {
        let _: EmptyResponse = try await post("/api/suggestions/\(id)/apply", body: EmptyBody())
    }

    // MARK: - Actions

    func triggerAction(_ action: String, bundleId: String) async throws {
        let _: EmptyResponse = try await post("/api/actions/\(action)", body: ["bundleId": bundleId])
    }

    // MARK: - Push Notifications

    func registerDeviceToken(_ deviceToken: String) async throws {
        let body = DeviceTokenRegistration(deviceToken: deviceToken, bundleId: Bundle.main.bundleIdentifier)
        let _: EmptyResponse = try await post("/api/push/register", body: body)
    }

    // MARK: - Builds

    func getBuildJobs(appId: String) async throws -> [BuildJob] {
        try await get("/api/github/builds/\(appId)")
    }

    func getLatestBuild(bundleId: String) async throws -> LatestBuildInfo? {
        let response: LatestBuildResponse = try await get("/api/submissions/build-info?bundleId=\(bundleId)")
        return response.build
    }

    func triggerBuild(appId: String) async throws {
        let _: EmptyResponse = try await post("/api/github/builds/trigger/\(appId)", body: EmptyBody())
    }

    // MARK: - Screenshots

    func getScreenshotJobs(appId: String) async throws -> [ScreenshotJob] {
        try await get("/api/github/screenshots/\(appId)")
    }

    // MARK: - Ads

    func getGoogleAdsCampaigns() async throws -> [GoogleAdsCampaign] {
        let response: GoogleAdsCampaignsResponse = try await get("/api/google-ads/campaigns")
        return response.campaigns
    }

    func getAppleAdsCampaigns(bundleId: String?) async throws -> [AppleAdsCampaign] {
        var path = "/api/apple-ads/campaigns"
        if let bundleId { path += "?bundleId=\(bundleId)" }
        let response: AppleAdsCampaignsResponse = try await get(path)
        return response.campaigns
    }

    // MARK: - Product Pages

    func getProductPages(bundleId: String?) async throws -> [ProductPage] {
        var path = "/api/product-pages/"
        if let bundleId { path += "?bundleId=\(bundleId)" }
        let response: ProductPagesResponse = try await get(path)
        return response.pages
    }

    // MARK: - HTTP Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await perform(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B, authenticated: Bool = true) async throws -> T {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func delete(_ path: String) async throws {
        let url = URL(string: baseURL + path)!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.requestFailed
        }
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.requestFailed }

        if http.statusCode == 401 {
            sessionActive = false
            throw APIError.unauthorized
        }

        guard (200...299).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(http.statusCode, message)
        }

        let decoder = JSONDecoder()
        do {
            return try decoder.decode(T.self, from: data)
        } catch let DecodingError.keyNotFound(key, context) {
            let path = (context.codingPath + [key]).map(\.stringValue).joined(separator: ".")
            throw APIError.decodingError("Missing key '\(path)' in \(T.self)")
        } catch let DecodingError.typeMismatch(type, context) {
            let path = context.codingPath.map(\.stringValue).joined(separator: ".")
            throw APIError.decodingError("Type mismatch at '\(path)': expected \(type) in \(T.self)")
        } catch let DecodingError.valueNotFound(type, context) {
            let path = context.codingPath.map(\.stringValue).joined(separator: ".")
            throw APIError.decodingError("Null/missing value at '\(path)': expected \(type) in \(T.self)")
        } catch let DecodingError.dataCorrupted(context) {
            throw APIError.decodingError("Corrupted data at '\(context.codingPath.map(\.stringValue).joined(separator: "."))' in \(T.self): \(context.debugDescription)")
        }
    }
}

// MARK: - Helpers

struct EmptyBody: Encodable {}
struct EmptyResponse: Decodable {}

enum APIError: LocalizedError {
    case requestFailed
    case unauthorized
    case serverError(Int, String)
    case decodingError(String)

    var errorDescription: String? {
        switch self {
        case .requestFailed: return "Request failed"
        case .unauthorized: return "Session expired. Please log in again."
        case .serverError(let code, let msg): return "Server error (\(code)): \(msg)"
        case .decodingError(let msg): return "Decoding error: \(msg)"
        }
    }
}

// MARK: - Keychain Helper

enum KeychainHelper {
    static func save(key: String, value: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}
