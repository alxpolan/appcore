import SwiftUI
import Charts

struct DashboardView: View {
    @Binding var bundleId: String?
    @Binding var showAllApps: Bool
    let apps: [AppItem]

    @State private var dashboard: DashboardData?
    @State private var downloads: DownloadsData?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showMore = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    LoadingView("Loading dashboard...")
                } else if let error {
                    ErrorView(message: error) { Task { await loadData() } }
                } else if let dashboard {
                    dashboardContent(dashboard)
                }
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showMore = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    appPicker
                }
            }
            .sheet(isPresented: $showMore) {
                SettingsView()
            }
            .refreshable { await loadData() }
        }
        .task(id: [bundleId, showAllApps ? "all" : "single"]) { await loadData() }
    }

    private var selectedApp: AppItem? {
        if let bundleId {
            return apps.first { $0.bundleId == bundleId }
        }

        return nil
    }

    @ViewBuilder
    private func dashboardContent(_ data: DashboardData) -> some View {
        ScrollView {
            VStack(spacing: 20) {

                if let downloads, !downloads.byDay.isEmpty {
                    downloadsChart(downloads.byDay)
                }

                quickLinks

                if !data.recentSuggestions.isEmpty {
                    recentSuggestionsSection(data.recentSuggestions)
                }
            }
            .padding()
        }
    }

    private var appPicker: some View {
        Menu {
            Button {
                showAllApps = true
            } label: {
                HStack {
                    Text("All Apps")
                    if showAllApps {
                        Image(systemName: "checkmark")
                    }
                }
            }

            ForEach(apps) { app in
                Button {
                    showAllApps = false
                    bundleId = app.bundleId
                } label: {
                    HStack {
                        Text(app.displayNameOrName)
                        if !showAllApps && app.bundleId == bundleId {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                if !showAllApps {
                    AppIconView(url: selectedApp?.iconUrl, size: 28)
                }
                Text(showAllApps ? "All Apps" : (selectedApp?.displayNameOrName ?? "Select app"))
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
        }
    }

    private struct DownloadChartDay: Identifiable {
        let date: Date
        let downloads: Int

        var id: Date { date }
    }

    private struct SevenDayDownloadSnapshot {
        let days: [DownloadChartDay]
        let total: Int
        let previousTotal: Int
        let dailyAverage: Int
        let yUpperBound: Int
    }

    @ViewBuilder
    private func downloadsChart(_ days: [DayData]) -> some View {
        let snapshot = buildSevenDaySnapshot(from: days)
        let trend = trendPercent(current: snapshot.total, previous: snapshot.previousTotal)
        let firstDate = snapshot.days.first?.date
        let lastDate = snapshot.days.last?.date
        let xAxisDates = [firstDate, lastDate].compactMap { $0 }

        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Downloads")
                        .font(.title2)
                        .fontWeight(.bold)
                    Text("Daily Average: \(snapshot.dailyAverage)")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    Text(snapshot.total.formatted())
                        .font(.system(size: 44, weight: .semibold, design: .rounded))

                    HStack(spacing: 6) {
                        Image(systemName: trendSymbol(for: trend))
                        Text("\(abs(trend))%")
                    }
                    .font(.title2)
                    .foregroundStyle(trendColor(for: trend))
                }
            }

            Chart(snapshot.days) { day in
                BarMark(
                    x: .value("Date", day.date, unit: .day),
                    y: .value("Downloads", day.downloads)
                )
                .foregroundStyle(.blue.gradient)
                .cornerRadius(6)
            }
            .frame(height: 190)
            .chartYScale(domain: 0...Double(snapshot.yUpperBound))
            .chartYAxis {
                AxisMarks(position: .trailing, values: [0, Double(snapshot.yUpperBound) / 2, Double(snapshot.yUpperBound)]) { value in
                    if let yValue = value.as(Double.self), yValue == Double(snapshot.yUpperBound) / 2 {
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                            .foregroundStyle(.quaternary)
                    } else {
                        AxisGridLine()
                            .foregroundStyle(.quaternary)
                    }

                    AxisTick(stroke: StrokeStyle(lineWidth: 0))

                    AxisValueLabel {
                        if let yValue = value.as(Double.self), Int(yValue) == snapshot.yUpperBound {
                            Text(snapshot.yUpperBound.formatted())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: xAxisDates) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0))
                    AxisTick(stroke: StrokeStyle(lineWidth: 0))
                    AxisValueLabel {
                        if let date = value.as(Date.self) {
                            Text(xAxisLabel(for: date, firstDate: firstDate, lastDate: lastDate))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private var quickLinks: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                NavigationLink(destination: SuggestionsView(bundleId: bundleId)) {
                    quickLinkCard(title: "Suggestions", icon: "lightbulb.fill", color: .yellow)
                }
                NavigationLink(destination: ReviewsView(bundleId: bundleId)) {
                    quickLinkCard(title: "Reviews", icon: "star.bubble.fill", color: .green)
                }
                NavigationLink(destination: BuildsView(bundleId: bundleId, apps: apps)) {
                    quickLinkCard(title: "Builds", icon: "hammer.fill", color: .blue)
                }
            }
            HStack(spacing: 12) {
                NavigationLink(destination: ScreenshotsView(bundleId: bundleId, apps: apps)) {
                    quickLinkCard(title: "Screenshots", icon: "photo.stack.fill", color: .purple)
                }
                NavigationLink(destination: AdsView(bundleId: bundleId)) {
                    quickLinkCard(title: "Ads", icon: "megaphone.fill", color: .orange)
                }
                NavigationLink(destination: ProductPagesView(bundleId: bundleId)) {
                    quickLinkCard(title: "Pages", icon: "rectangle.on.rectangle.fill", color: .pink)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func quickLinkCard(title: String, icon: String, color: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
            Text(title)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }

    @ViewBuilder
    private func recentSuggestionsSection(_ suggestions: [RecentSuggestion]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Recent Suggestions", icon: "lightbulb.fill")

            ForEach(suggestions.prefix(5)) { suggestion in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(suggestion.type)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(.tint)
                            Text(suggestion.locale)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(suggestion.value)
                            .font(.caption)
                            .lineLimit(1)
                    }
                    Spacer()
                    StatusBadge(status: suggestion.status)
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private func parseDate(_ string: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(string.prefix(10))) ?? Date()
    }

    private func buildSevenDaySnapshot(from days: [DayData]) -> SevenDayDownloadSnapshot {
        let calendar = Calendar.current
        var downloadsByDate: [Date: Int] = [:]

        for day in days {
            let normalizedDate = calendar.startOfDay(for: parseDate(day.date))
            downloadsByDate[normalizedDate, default: 0] += day.downloads
        }

        let anchorDate = downloadsByDate.keys.max() ?? calendar.startOfDay(for: Date())
        let fourteenDays: [DownloadChartDay] = (0..<14).compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: offset - 13, to: anchorDate) else {
                return nil
            }
            let normalizedDate = calendar.startOfDay(for: date)
            return DownloadChartDay(date: normalizedDate, downloads: downloadsByDate[normalizedDate] ?? 0)
        }

        let previousWeek = Array(fourteenDays.prefix(7))
        let currentWeek = Array(fourteenDays.suffix(7))
        let currentTotal = currentWeek.reduce(0) { $0 + $1.downloads }
        let previousTotal = previousWeek.reduce(0) { $0 + $1.downloads }
        let dailyAverage = currentTotal / max(currentWeek.count, 1)
        let maxValue = currentWeek.map(\.downloads).max() ?? 0

        return SevenDayDownloadSnapshot(
            days: currentWeek,
            total: currentTotal,
            previousTotal: previousTotal,
            dailyAverage: dailyAverage,
            yUpperBound: chartUpperBound(for: maxValue)
        )
    }

    private func chartUpperBound(for maxValue: Int) -> Int {
        guard maxValue > 5 else { return 5 }

        let magnitude = pow(10.0, floor(log10(Double(maxValue))))
        let normalized = Double(maxValue) / magnitude
        let rounded: Double

        if normalized <= 1 {
            rounded = 1
        } else if normalized <= 2 {
            rounded = 2
        } else if normalized <= 5 {
            rounded = 5
        } else {
            rounded = 10
        }

        return Int(rounded * magnitude)
    }

    private func trendPercent(current: Int, previous: Int) -> Int {
        guard previous > 0 else {
            return current == 0 ? 0 : 100
        }
        return Int((Double(current - previous) / Double(previous) * 100).rounded())
    }

    private func trendSymbol(for trend: Int) -> String {
        if trend > 0 { return "arrow.up.right" }
        if trend < 0 { return "arrow.down.right" }
        return "arrow.right"
    }

    private func trendColor(for trend: Int) -> Color {
        if trend > 0 { return .green }
        if trend < 0 { return .red }
        return .secondary
    }

    private func xAxisLabel(for date: Date, firstDate: Date?, lastDate: Date?) -> String {
        let calendar = Calendar.current

        if let firstDate, calendar.isDate(date, inSameDayAs: firstDate) {
            return formatMonthDay(date)
        }

        if let firstDate, let lastDate, calendar.isDate(date, inSameDayAs: lastDate) {
            let sameMonth = calendar.isDate(firstDate, equalTo: lastDate, toGranularity: .month)
            let sameYear = calendar.isDate(firstDate, equalTo: lastDate, toGranularity: .year)
            return (sameMonth && sameYear) ? formatDay(date) : formatMonthDay(date)
        }

        return formatMonthDay(date)
    }

    private func formatMonthDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: date)
    }

    private func formatDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: date)
    }

    private func loadData() async {
        guard bundleId != nil || (showAllApps && !apps.isEmpty) else { isLoading = false; return }
        isLoading = true
        error = nil
        do {
            if showAllApps && !apps.isEmpty {
                let (dash, dl) = try await loadAggregate()
                dashboard = dash
                downloads = dl
            } else {
                async let dashResult = APIService.shared.getDashboard(bundleId: bundleId)
                async let downloadResult = APIService.shared.getDownloads(bundleId: bundleId, days: 14)
                let (dash, dl) = try await (dashResult, downloadResult)
                dashboard = dash
                downloads = dl
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func loadAggregate() async throws -> (DashboardData, DownloadsData) {
        try await APIService.shared.getAllDashboard(days: 14)
    }
}
