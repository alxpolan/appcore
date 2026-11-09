import SwiftUI

enum AdsCampaignStatus: Equatable {
    case enabled
    case paused
    case other(String)

    init(rawStatus: String) {
        switch rawStatus {
        case "ENABLED":
            self = .enabled
        case "PAUSED":
            self = .paused
        default:
            self = .other(rawStatus)
        }
    }
}

struct AdsStatusBadge: View {
    let status: String

    private var mapped: AdsCampaignStatus {
        AdsCampaignStatus(rawStatus: status)
    }

    private var color: Color {
        switch mapped {
        case .enabled:
            return .green
        case .paused:
            return .gray
        case .other:
            return .red
        }
    }

    private var displayText: String {
        switch mapped {
        case .enabled:
            return "Enabled"
        case .paused:
            return "Paused"
        case .other(let raw):
            return raw.replacing("_", with: " ").capitalized
        }
    }

    var body: some View {
        Text(displayText)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

enum AdsFormat {
    static func money(_ amount: Double, currency: String?) -> String {
        let formatter = NumberFormatter()

        formatter.numberStyle = .currency
        formatter.currencyCode = currency ?? "USD"
        formatter.maximumFractionDigits = 2

        return formatter.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    static func compact(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }

        if value >= 1_000 {
            return String(format: "%.1fK", Double(value) / 1_000)
        }

        return "\(value)"
    }

    static func rate(numerator: Double, denominator: Double) -> String {
        guard denominator > 0 else {
            return "—"
        }

        return String(format: "%.1f%%", numerator / denominator * 100)
    }

    static func dayRate(numerator: Double, denominator: Double) -> Double {
        guard denominator > 0 else {
            return 0
        }

        return numerator / denominator * 100
    }

    static func date(_ string: String) -> Date {
        let formatter = DateFormatter()

        formatter.dateFormat = "yyyy-MM-dd"

        return formatter.date(from: String(string.prefix(10))) ?? Date()
    }
}

struct AdsView: View {
    @State private var source = 0
    @State private var googleCampaigns: [GoogleAdsCampaign] = []
    @State private var appleCampaigns: [AppleAdsCampaign] = []
    @State private var googleDaily: [GoogleAdsDailyDay] = []
    @State private var appleDaily: [AppleAdsDailyDay] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Source", selection: $source) {
                Text("Google Ads").tag(0)
                Text("Apple Ads").tag(1)
            }
            .pickerStyle(.segmented)
            .padding()

            Group {
                if isLoading {
                    LoadingView("Loading campaigns...")
                } else if let error {
                    ErrorView(message: error) { Task { await load() } }
                } else if source == 0 {
                    googleContent
                } else {
                    appleContent
                }
            }
        }
        .navigationTitle("Ads")
        .refreshable { await load() }
        .task(id: source) { await load() }
    }

    private var googleContent: some View {
        Group {
            if googleCampaigns.isEmpty {
                EmptyStateView(
                    icon: "megaphone.fill",
                    title: "No Google Campaigns",
                    message: "Connect Google Ads to see campaigns."
                )
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        MetricSparkCard(
                            title: "Spend",
                            icon: "dollarsign.circle",
                            color: .orange,
                            value: cardMoney(googleTotals.spend, currency: googleCurrency),
                            subtitle: "Last 30 days",
                            trend: googleDaily.map(\.spend)
                        )
                        MetricSparkCard(
                            title: "Impressions",
                            icon: "eye",
                            color: .cyan,
                            value: cardCount(googleTotals.impressions),
                            subtitle: "Last 30 days",
                            trend: googleDaily.map { Double($0.impressions) }
                        )
                        MetricSparkCard(
                            title: "Clicks",
                            icon: "cursorarrow.click",
                            color: .indigo,
                            value: cardCount(googleTotals.clicks),
                            subtitle: "Last 30 days",
                            trend: googleDaily.map { Double($0.clicks) }
                        )
                        MetricSparkCard(
                            title: "Conversions",
                            icon: "arrow.down.circle",
                            color: .green,
                            value: cardCount(Int(googleTotals.conversions)),
                            subtitle: "Last 30 days",
                            trend: googleDaily.map(\.conversions)
                        )
                        MetricSparkCard(
                            title: "CTR",
                            icon: "chart.line.uptrend.xyaxis",
                            color: .purple,
                            value: rate(numerator: Double(googleTotals.clicks), denominator: Double(googleTotals.impressions)),
                            subtitle: "Clicks / Impr.",
                            trend: googleDaily.map { dayRate(numerator: Double($0.clicks), denominator: Double($0.impressions)) }
                        )
                        MetricSparkCard(
                            title: "Conv. Rate",
                            icon: "percent",
                            color: .pink,
                            value: rate(numerator: googleTotals.conversions, denominator: Double(googleTotals.clicks)),
                            subtitle: "Conv. / Clicks",
                            trend: googleDaily.map { dayRate(numerator: $0.conversions, denominator: Double($0.clicks)) }
                        )

                        SectionHeader("Campaigns", icon: "megaphone.fill")

                        ForEach(googleCampaigns) { campaign in
                            campaignCard {
                                campaignHeader(name: campaign.name, status: campaign.status)
                                metricGrid(values: [
                                    ("Spend", money(campaign.spend, currency: campaign.currency ?? googleCurrency)),
                                    ("Clicks", "\(campaign.clicks)"),
                                    ("Impr.", compact(campaign.impressions)),
                                    ("Conv.", formatConversions(campaign.conversions)),
                                ])
                                campaignFooter(items: [
                                    budgetText(budget: campaign.dailyBudget, currency: campaign.currency),
                                    "CTR \(rate(numerator: Double(campaign.clicks), denominator: Double(campaign.impressions)))",
                                ])
                            }
                        }
                    }
                    .padding()
                }
            }
        }
    }

    private var appleContent: some View {
        Group {
            if appleCampaigns.isEmpty {
                EmptyStateView(
                    icon: "megaphone.fill",
                    title: "No Apple Campaigns",
                    message: "Connect Apple Ads to see campaigns."
                )
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        MetricSparkCard(
                            title: "Spend",
                            icon: "dollarsign.circle",
                            color: .orange,
                            value: cardMoney(appleTotals.spend, currency: appleCurrency),
                            subtitle: "Last 30 days",
                            trend: appleDaily.map(\.spend)
                        )
                        MetricSparkCard(
                            title: "Impressions",
                            icon: "eye",
                            color: .cyan,
                            value: cardCount(appleTotals.impressions),
                            subtitle: "Last 30 days",
                            trend: appleDaily.map { Double($0.impressions) }
                        )
                        MetricSparkCard(
                            title: "Taps",
                            icon: "cursorarrow.click",
                            color: .indigo,
                            value: cardCount(appleTotals.taps),
                            subtitle: "Last 30 days",
                            trend: appleDaily.map { Double($0.taps) }
                        )
                        MetricSparkCard(
                            title: "Installs",
                            icon: "arrow.down.circle",
                            color: .green,
                            value: cardCount(appleTotals.installs),
                            subtitle: "Last 30 days",
                            trend: appleDaily.map { Double($0.installs) }
                        )
                        MetricSparkCard(
                            title: "TTR",
                            icon: "chart.line.uptrend.xyaxis",
                            color: .purple,
                            value: rate(numerator: Double(appleTotals.taps), denominator: Double(appleTotals.impressions)),
                            subtitle: "Taps / Impr.",
                            trend: appleDaily.map { dayRate(numerator: Double($0.taps), denominator: Double($0.impressions)) }
                        )
                        MetricSparkCard(
                            title: "Conv. Rate",
                            icon: "percent",
                            color: .pink,
                            value: rate(numerator: Double(appleTotals.installs), denominator: Double(appleTotals.taps)),
                            subtitle: "Installs / Taps",
                            trend: appleDaily.map { dayRate(numerator: Double($0.installs), denominator: Double($0.taps)) }
                        )

                        SectionHeader("Campaigns", icon: "megaphone.fill")

                        ForEach(appleCampaigns) { campaign in
                            campaignCard {
                                campaignHeader(name: campaign.name, status: campaign.status)
                                metricGrid(values: [
                                    ("Spend", money(campaign.spend, currency: campaign.currency ?? appleCurrency)),
                                    ("Taps", "\(campaign.taps)"),
                                    ("Installs", "\(campaign.installs)"),
                                    ("Impr.", compact(campaign.impressions)),
                                ])
                                campaignFooter(items: [
                                    budgetText(budget: campaign.dailyBudget, currency: campaign.currency),
                                    "TTR \(rate(numerator: Double(campaign.taps), denominator: Double(campaign.impressions)))",
                                ])
                            }
                        }
                    }
                    .padding()
                }
            }
        }
    }

    private func campaignCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            content()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func campaignHeader(name: String, status: String) -> some View {
        HStack {
            Text(name)
                .font(.subheadline)
                .fontWeight(.semibold)
            Spacer()
            AdsStatusBadge(status: status)
        }
    }

    private func metricGrid(values: [(String, String)]) -> some View {
        HStack {
            ForEach(values, id: \.0) { label, value in
                VStack(alignment: .leading, spacing: 2) {
                    Text(value)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func campaignFooter(items: [String]) -> some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var googleTotals: (spend: Double, impressions: Int, clicks: Int, conversions: Double) {
        googleCampaigns.reduce((0, 0, 0, 0)) { acc, c in
            (acc.0 + c.spend, acc.1 + c.impressions, acc.2 + c.clicks, acc.3 + c.conversions)
        }
    }

    private var appleTotals: (spend: Double, impressions: Int, taps: Int, installs: Int) {
        appleCampaigns.reduce((0, 0, 0, 0)) { acc, c in
            (acc.0 + c.spend, acc.1 + c.impressions, acc.2 + c.taps, acc.3 + c.installs)
        }
    }

    private var googleCurrency: String {
        googleCampaigns.first?.currency ?? "USD"
    }

    private var appleCurrency: String {
        appleCampaigns.first?.currency ?? "USD"
    }

    private func money(_ amount: Double, currency: String?) -> String {
        let formatter = NumberFormatter()

        formatter.numberStyle = .currency
        formatter.currencyCode = currency ?? "USD"
        formatter.maximumFractionDigits = 2

        return formatter.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    private func cardMoney(_ amount: Double, currency: String?) -> String {
        let formatter = NumberFormatter()

        formatter.numberStyle = .currency
        formatter.currencyCode = currency ?? "USD"
        formatter.maximumFractionDigits = 0

        return formatter.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    private func cardCount(_ value: Int) -> String {
        let formatter = NumberFormatter()

        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0

        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private func compact(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }

        if value >= 1_000 {
            return String(format: "%.1fK", Double(value) / 1_000)
        }

        return "\(value)"
    }

    private func formatConversions(_ value: Double) -> String {
        String(format: "%.0f", value)
    }

    private func rate(numerator: Double, denominator: Double) -> String {
        guard denominator > 0 else {
            return "—"
        }

        return String(format: "%.1f%%", numerator / denominator * 100)
    }

    private func dayRate(numerator: Double, denominator: Double) -> Double {
        guard denominator > 0 else {
            return 0
        }

        return numerator / denominator * 100
    }

    private func budgetText(budget: Double?, currency: String?) -> String {
        guard let budget else {
            return "No daily budget"
        }

        return "Budget \(money(budget, currency: currency))/day"
    }

    private func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            if source == 0 {
                googleCampaigns = try await APIService.shared.getGoogleAdsCampaigns()
                googleDaily = (try? await APIService.shared.getGoogleAdsDaily()) ?? []
            } else {
                appleCampaigns = try await APIService.shared.getAppleAdsCampaigns()
                appleDaily = (try? await APIService.shared.getAppleAdsDaily()) ?? []
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
