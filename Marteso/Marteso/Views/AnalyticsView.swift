import SwiftUI
import Charts

struct AnalyticsView: View {
    let bundleId: String?
    let apps: [AppItem]
    @Binding var showAllApps: Bool

    @State private var summary: AnalyticsSummary?
    @State private var downloads: DownloadsData?
    @State private var selectedDays = 30
    @State private var isLoading = true
    @State private var error: String?

    private let dayOptions = [7, 14, 30, 90, 180, 365]

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && summary == nil {
                    LoadingView("Loading analytics...")
                } else if let error, summary == nil {
                    ErrorView(message: error) { Task { await loadData() } }
                } else if let summary {
                    analyticsContent(summary)
                }
            }
            .navigationTitle("Analytics")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(dayOptions, id: \.self) { days in
                            Button {
                                selectedDays = days
                                Task { await loadData() }
                            } label: {
                                HStack {
                                    Text("\(days) Days")
                                    if days == selectedDays {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Label("\(selectedDays)d", systemImage: "calendar")
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            try? await APIService.shared.syncAnalytics()
                            await loadData()
                        }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
            }
            .refreshable { await loadData() }
        }
        .task(id: [bundleId, showAllApps ? "all" : "single"]) { await loadData() }
    }

    @ViewBuilder
    private func analyticsContent(_ summary: AnalyticsSummary) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                summaryCards(summary)

                if let downloads, !downloads.byDay.isEmpty {
                    metricsChart(downloads.byDay)
                }

                if let downloads, !downloads.byCountry.isEmpty {
                    countryBreakdown(downloads.byCountry)
                }

                reviewsSummary(summary)
            }
            .padding()
        }
    }

    @ViewBuilder
    private func summaryCards(_ summary: AnalyticsSummary) -> some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 12) {
            StatCard(
                title: "Downloads",
                value: formatNumber(summary.totalDownloads),
                icon: "arrow.down.circle.fill",
                color: .blue
            )
            StatCard(
                title: "Impressions",
                value: formatNumber(summary.totalImpressions),
                icon: "eye.fill",
                color: .purple
            )
            StatCard(
                title: "Page Views",
                value: formatNumber(summary.totalPageViews),
                icon: "doc.text.fill",
                color: .orange
            )
            StatCard(
                title: "Conversion",
                value: summary.conversionRate.map { String(format: "%.1f%%", $0) } ?? "—",
                icon: "arrow.right.arrow.left.circle.fill",
                color: .pink
            )
        }
    }

    @ViewBuilder
    private func metricsChart(_ days: [DayData]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Downloads Trend", icon: "chart.xyaxis.line")

            Chart(days) { day in
                AreaMark(
                    x: .value("Date", parseDate(day.date)),
                    y: .value("Downloads", day.downloads)
                )
                .foregroundStyle(
                    .linearGradient(
                        colors: [.blue.opacity(0.3), .blue.opacity(0.02)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("Date", parseDate(day.date)),
                    y: .value("Downloads", day.downloads)
                )
                .foregroundStyle(.blue)
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2))
            }
            .frame(height: 220)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                }
            }

            if days.contains(where: { $0.proceeds > 0 }) {
                Text("Revenue")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .padding(.top, 8)

                Chart(days) { day in
                    BarMark(
                        x: .value("Date", parseDate(day.date)),
                        y: .value("Revenue", day.proceeds)
                    )
                    .foregroundStyle(.green.gradient)
                }
                .frame(height: 140)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    }
                }
            }

            Text("Impressions & Page Views")
                .font(.subheadline)
                .fontWeight(.medium)
                .padding(.top, 8)

            Chart(days) { day in
                LineMark(
                    x: .value("Date", parseDate(day.date)),
                    y: .value("Value", day.impressions),
                    series: .value("Metric", "Impressions")
                )
                .foregroundStyle(.purple)
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("Date", parseDate(day.date)),
                    y: .value("Value", day.pageViews),
                    series: .value("Metric", "Page Views")
                )
                .foregroundStyle(.orange)
                .interpolationMethod(.catmullRom)
            }
            .frame(height: 160)
            .chartForegroundStyleScale([
                "Impressions": .purple,
                "Page Views": .orange
            ])
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    @ViewBuilder
    private func countryBreakdown(_ countries: [CountryData]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Top Countries", icon: "globe")

            let sortedCountries = countries.sorted { $0.downloads > $1.downloads }
            let topCountries = Array(sortedCountries.prefix(10))
            let maxDownloads = topCountries.first?.downloads ?? 1

            ForEach(topCountries) { country in
                HStack(spacing: 12) {
                    Text(countryFlag(country.country))
                        .font(.title3)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(country.country)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            Text(formatNumber(country.downloads))
                                .font(.subheadline)
                                .fontWeight(.semibold)
                        }

                        GeometryReader { geo in
                            RoundedRectangle(cornerRadius: 3)
                                .fill(.blue.gradient)
                                .frame(
                                    width: geo.size.width * CGFloat(country.downloads) / CGFloat(maxDownloads)
                                )
                        }
                        .frame(height: 6)
                    }
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    @ViewBuilder
    private func reviewsSummary(_ summary: AnalyticsSummary) -> some View {
        HStack(spacing: 16) {
            VStack(spacing: 4) {
                if let rating = summary.avgRating {
                    Text(String(format: "%.1f", rating))
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                    RatingStars(rating: rating)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("\(summary.reviewCount) Reviews")
                    .font(.headline)
                if let syncAt = summary.lastSyncAt {
                    Text("Last sync: \(formatRelativeDate(syncAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private func parseDate(_ string: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(string.prefix(10))) ?? Date()
    }

    private func formatNumber(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
        return "\(n)"
    }

    private func formatCurrency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: value)) ?? "$\(value)"
    }

    private func formatRelativeDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return dateString }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }

    private func countryFlag(_ code: String) -> String {
        let base: UInt32 = 127397
        return String(code.uppercased().unicodeScalars.compactMap { UnicodeScalar(base + $0.value) }.map { Character($0) })
    }

    private func loadData() async {
        guard bundleId != nil || (showAllApps && !apps.isEmpty) else { isLoading = false; return }
        isLoading = true
        error = nil
        do {
            if showAllApps && !apps.isEmpty {
                let (s, d) = try await APIService.shared.getAllAnalytics(days: selectedDays)
                summary = s
                downloads = d
            } else {
                async let summaryResult = APIService.shared.getAnalyticsSummary(bundleId: bundleId, days: selectedDays)
                async let downloadsResult = APIService.shared.getDownloads(bundleId: bundleId, days: selectedDays)
                let (s, d) = try await (summaryResult, downloadsResult)
                summary = s
                downloads = d
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
