import Foundation
import Testing
@testable import Marteso

private func decode<T: Decodable>(_ type: T.Type, json: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(json.utf8))
}

struct MartesoTests {

    @Test func buildJobDecodes() async throws {
        let job = try decode(BuildJob.self, json: """
        {"id":"abc","appId":"1","branch":"main","commitSha":"deadbeef",
        "status":"completed","logs":[],"errors":[],"errorSummary":null,
        "ipaPath":null,"version":"2.1","buildNumber":"45",
        "startedAt":null,"completedAt":null,"createdAt":"2026-10-26T10:00:00Z"}
        """)
        #expect(job.id == "abc")
        #expect(job.version == "2.1")
    }

    @Test func screenshotJobDecodes() async throws {
        let job = try decode(ScreenshotJob.self, json: """
        {"id":"s1","appId":"1","commitSha":"abc1234","commitMessage":"msg",
        "branch":"main","pusher":"alex","status":"completed","logs":[],
        "error":null,"screenshotUrls":["https://example.com/1.png"],
        "startedAt":null,"completedAt":null,"createdAt":"2026-10-26T10:00:00Z"}
        """)
        #expect(job.screenshotUrls.count == 1)
        #expect(job.pusher == "alex")
    }

    @Test func googleAdsCampaignDecodes() async throws {
        let response = try decode(GoogleAdsCampaignsResponse.self, json: """
        {"campaigns":[{"id":"123","name":"JP","status":"PAUSED",
        "dailyBudget":5.0,"currency":"EUR","spend":12.5,"impressions":100,
        "clicks":10,"conversions":2.0,"ctr":10.0,"avgCpc":1.25}]}
        """)
        #expect(response.campaigns.count == 1)
        #expect(response.campaigns[0].spend == 12.5)
    }

    @Test func appleAdsCampaignDecodes() async throws {
        let response = try decode(AppleAdsCampaignsResponse.self, json: """
        {"campaigns":[{"id":"9","name":"Brand","status":"ENABLED",
        "servingStatus":"RUNNING","dailyBudget":10.0,"totalBudget":null,
        "currency":"USD","countriesOrRegions":["US"],"startTime":null,
        "endTime":null,"spend":3.0,"impressions":50,"taps":5,
        "installs":2,"avgCpa":1.5}]}
        """)
        #expect(response.campaigns[0].installs == 2)
    }

    @Test func productPageDecodes() async throws {
        let response = try decode(ProductPagesResponse.self, json: """
        {"pages":[{"id":"p1","name":"Launch","url":null,"visible":true,
        "versions":[{"id":"v1","version":"1","state":"READY_FOR_SALE",
        "deepLink":null,"isEditable":false}]}]}
        """)
        #expect(response.pages[0].versions?.count == 1)
    }

    @Test func latestBuildDecodes() async throws {
        let response = try decode(LatestBuildResponse.self, json: """
        {"build":{"builtAt":"2026-10-26","originalFilename":"app.ipa",
        "bundleId":"com.example.app","exportMethod":"app-store",
        "sizeBytes":12345,"iconUrl":null,"version":"2.1","buildNumber":"45"}}
        """)
        #expect(response.build?.bundleId == "com.example.app")
    }
}
