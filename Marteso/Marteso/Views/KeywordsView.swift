import SwiftUI
import Charts

struct KeywordsView: View {
    let bundleId: String?

    @State private var keywords: [Keyword] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showAddSheet = false
    @State private var searchText = ""
    @State private var sortBy: SortOption = .popularity

    enum SortOption: String, CaseIterable {
        case popularity = "Popularity"
        case term = "A-Z"
        case rank = "Rank"
    }

    var filteredKeywords: [Keyword] {
        var result = keywords
        if !searchText.isEmpty {
            result = result.filter { $0.term.localizedCaseInsensitiveContains(searchText) }
        }
        switch sortBy {
        case .popularity:
            result.sort { ($0.popularity ?? 0) > ($1.popularity ?? 0) }
        case .term:
            result.sort { $0.term < $1.term }
        case .rank:
            result.sort { ($0.ourRank ?? 999) < ($1.ourRank ?? 999) }
        }
        return result
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && keywords.isEmpty {
                    LoadingView("Loading keywords...")
                } else if let error, keywords.isEmpty {
                    ErrorView(message: error) { Task { await loadKeywords() } }
                } else if keywords.isEmpty {
                    EmptyStateView(
                        icon: "key.fill",
                        title: "No Keywords",
                        message: "Add keywords to track their rankings."
                    )
                } else {
                    keywordsList
                }
            }
            .navigationTitle("Keywords")
            .searchable(text: $searchText, prompt: "Search keywords")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(SortOption.allCases, id: \.self) { option in
                            Button {
                                sortBy = option
                            } label: {
                                HStack {
                                    Text(option.rawValue)
                                    if option == sortBy {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddKeywordSheet(bundleId: bundleId) { await loadKeywords() }
            }
            .refreshable { await loadKeywords() }
        }
        .task(id: bundleId) { await loadKeywords() }
    }

    @ViewBuilder
    private var keywordsList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                HStack(spacing: 12) {
                    StatCard(
                        title: "Total",
                        value: "\(keywords.count)",
                        icon: "key.fill",
                        color: .blue
                    )
                    StatCard(
                        title: "Ranked",
                        value: "\(keywords.filter { $0.ourRank != nil }.count)",
                        icon: "chart.bar.fill",
                        color: .green
                    )
                }
                .padding(.horizontal)

                ForEach(filteredKeywords) { keyword in
                    keywordRow(keyword)
                        .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
    }

    @ViewBuilder
    private func keywordRow(_ keyword: Keyword) -> some View {
        NavigationLink(destination: KeywordDetailView(keyword: keyword, ownBundleId: bundleId)) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(keyword.term)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)

                    HStack(spacing: 6) {
                        Label(keyword.country, systemImage: "globe")
                        if let lang = keyword.language {
                            Text("·")
                            Text(lang)
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                if let rank = keyword.ourRank {
                    VStack(spacing: 2) {
                        Text("#\(rank)")
                            .font(.title3)
                            .fontWeight(.bold)
                            .fontDesign(.rounded)
                            .foregroundStyle(rankColor(rank))
                        Text("Rank")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("—")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding()
            .glassEffect(.regular, in: .rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task {
                    try? await APIService.shared.deleteKeyword(id: keyword.id)
                    await loadKeywords()
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func rankColor(_ rank: Int) -> Color {
        if rank <= 5 { return .green }
        if rank <= 20 { return .blue }
        if rank <= 50 { return .orange }
        return .red
    }

    private func loadKeywords() async {
        guard bundleId != nil else { isLoading = false; return }
        isLoading = true
        error = nil
        do {
            keywords = try await APIService.shared.getKeywords(bundleId: bundleId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct AddKeywordSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var term = ""
    @State private var country = "US"
    @State private var language = ""
    @State private var isLoading = false

    let bundleId: String?
    let onAdded: () async -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Keyword") {
                    TextField("Keyword term", text: $term)
                        .textInputAutocapitalization(.never)
                }

                Section("Region") {
                    TextField("Country code (e.g. US)", text: $country)
                        .textInputAutocapitalization(.characters)
                    TextField("Language (optional)", text: $language)
                        .textInputAutocapitalization(.never)
                }
            }
            .navigationTitle("Add Keyword")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            guard let bundleId else { return }
                            isLoading = true
                            try? await APIService.shared.addKeyword(
                                term: term,
                                country: country,
                                language: language.isEmpty ? nil : language,
                                bundleId: bundleId
                            )
                            await onAdded()
                            isLoading = false
                            dismiss()
                        }
                    }
                    .disabled(term.isEmpty || country.isEmpty || bundleId == nil || isLoading)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct KeywordDetailView: View {
    let keyword: Keyword
    let ownBundleId: String?

    @State private var history: KeywordHistoryData?
    @State private var isLoading = true
    @State private var historyError: String?

    private let ownSeriesLabel = "Your App"

    private struct RankingChartPoint: Identifiable {
        let id: String
        let date: Date
        let rank: Int
        let appLabel: String
        let appBundleId: String
        let appName: String
        let trackedAt: String
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    HStack(spacing: 16) {
                        if let pop = keyword.popularity {
                            Label("\(pop) pop", systemImage: "flame.fill")
                                .foregroundStyle(.orange)
                        }
                        if let diff = keyword.difficulty {
                            Label(String(format: "%.0f diff", diff), systemImage: "gauge.medium")
                                .foregroundStyle(difficultyColor(diff))
                        }
                        if let vol = keyword.searchVolume {
                            Label(formatCompact(vol), systemImage: "magnifyingglass")
                                .foregroundStyle(.purple)
                        }
                        Label(keyword.country, systemImage: "globe")
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)

                    if let rank = keyword.ourRank {
                        Text("Rank #\(rank)")
                            .font(.headline)
                            .foregroundStyle(rankColor(rank))
                            .padding(.top, 4)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .glassEffect(.regular, in: .rect(cornerRadius: 20))

                if let history {
                    rankingChart(history.rankings)
                } else if isLoading {
                    ProgressView("Loading history...")
                        .padding(40)
                } else if let historyError {
                    ErrorView(message: historyError) { Task { await loadHistory() } }
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 4)
                }
            }
            .padding()
        }
        .navigationTitle(keyword.term)
        .navigationBarTitleDisplayMode(.large)
        .task {
            await loadHistory()
        }
    }

    @ViewBuilder
    private func rankingChart(_ rankings: [RankingEntry]) -> some View {
        let chartPoints = buildChartPoints(from: rankings)
        let seriesOrder = orderedSeriesLabels(from: chartPoints)
        let colorScale = chartColorScale(for: seriesOrder)
        let yDomainMax = max(chartPoints.map(\.rank).max() ?? 1, 2)
        let recentPoints = Array(chartPoints.suffix(10).reversed())

        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Ranking History (You + Competitors)", icon: "chart.line.uptrend.xyaxis")

            if chartPoints.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.title2)
                        .foregroundStyle(.tertiary)
                    Text("No ranked data yet")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Run keyword tracking first, then the competitor chart appears here.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            } else {
                Chart(chartPoints) { point in
                    let seriesColor = colorScale[point.appLabel] ?? .secondary

                    LineMark(
                        x: .value("Date", point.date),
                        y: .value("Rank", -point.rank),
                        series: .value("App", point.appLabel)
                    )
                    .foregroundStyle(seriesColor)
                    .interpolationMethod(.catmullRom)
                    .lineStyle(StrokeStyle(lineWidth: point.appLabel == ownSeriesLabel ? 3 : 1.8))

                    PointMark(
                        x: .value("Date", point.date),
                        y: .value("Rank", -point.rank)
                    )
                    .foregroundStyle(seriesColor)
                    .symbolSize(point.appLabel == ownSeriesLabel ? 26 : 14)
                }
                .frame(height: 250)
                .chartLegend(position: .top, alignment: .leading, spacing: 8)
                .chartYScale(domain: -yDomainMax ... -1)
                .chartYAxis {
                    AxisMarks(values: rankAxisValues(maxRank: yDomainMax)) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let intValue = value.as(Int.self) {
                                Text("\(abs(intValue))")
                            }
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    }
                }
            }

            if recentPoints.count > 1 {
                Text("Recent Rankings")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .padding(.top, 8)

                ForEach(recentPoints) { point in
                    HStack {
                        Text(point.appLabel)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer()
                        Text("#\(point.rank)")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundStyle(point.rank <= 10 ? .green : .secondary)
                        Text(formatShortDate(point.trackedAt))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private func rankColor(_ rank: Int) -> Color {
        if rank <= 5 { return .green }
        if rank <= 20 { return .blue }
        if rank <= 50 { return .orange }
        return .red
    }

    private func difficultyColor(_ diff: Double) -> Color {
        if diff < 30 { return .green }
        if diff < 60 { return .orange }
        return .red
    }

    private func formatCompact(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.0fK", Double(n) / 1_000) }
        return "\(n)"
    }

    private func buildChartPoints(from rankings: [RankingEntry]) -> [RankingChartPoint] {
        rankings
            .sorted { $0.trackedAt < $1.trackedAt }
            .enumerated()
            .compactMap { index, entry in
                guard let rank = entry.rank else { return nil }

                return RankingChartPoint(
                    id: "\(entry.appBundleId)-\(entry.trackedAt)-\(index)",
                    date: parseDate(entry.trackedAt),
                    rank: rank,
                    appLabel: chartLabel(for: entry),
                    appBundleId: entry.appBundleId,
                    appName: entry.appName,
                    trackedAt: entry.trackedAt
                )
            }
    }

    private func loadHistory() async {
        isLoading = true
        historyError = nil
        do {
            history = try await APIService.shared.getKeywordHistory(id: keyword.id)
        } catch {
            history = nil
            historyError = error.localizedDescription
            print("Failed to load history: \(error)")
        }
        isLoading = false
    }

    private func chartLabel(for entry: RankingEntry) -> String {
        if let ownBundleId, entry.appBundleId == ownBundleId {
            return ownSeriesLabel
        }
        if entry.appName.count > 20 {
            return String(entry.appName.prefix(20)) + "…"
        }
        return entry.appName
    }

    private func orderedSeriesLabels(from points: [RankingChartPoint]) -> [String] {
        var labels: [String] = []
        var seen = Set<String>()

        for point in points {
            if seen.insert(point.appLabel).inserted {
                labels.append(point.appLabel)
            }
        }

        if let ownIndex = labels.firstIndex(of: ownSeriesLabel), ownIndex > 0 {
            labels.remove(at: ownIndex)
            labels.insert(ownSeriesLabel, at: 0)
        }

        return labels
    }

    private func chartColorScale(for labels: [String]) -> [String: Color] {
        let competitorPalette: [Color] = [.blue, .green, .orange, .purple, .pink, .cyan, .mint]
        var mapping: [String: Color] = [:]
        var competitorIndex = 0

        for label in labels {
            if label == ownSeriesLabel {
                mapping[label] = .red
            } else {
                mapping[label] = competitorPalette[competitorIndex % competitorPalette.count]
                competitorIndex += 1
            }
        }

        return mapping
    }

    private func rankAxisValues(maxRank: Int) -> [Int] {
        let targetTicks = 5
        let step = max(1, Int(ceil(Double(maxRank - 1) / Double(targetTicks - 1))))
        var values = Array(stride(from: 1, through: maxRank, by: step))
        if values.last != maxRank {
            values.append(maxRank)
        }
        return values.map(-)
    }

    private func parseDate(_ string: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: string) ?? Date()
    }

    private func formatShortDate(_ string: String) -> String {
        let date = parseDate(string)
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: date)
    }
}
