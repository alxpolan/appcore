import SwiftUI

struct ActionsView: View {
    let bundleId: String?

    @State private var isLoading = false
    @State private var runningAction: String?

    private let actions: [(name: String, action: String, icon: String, color: Color, description: String)] = [
        ("Scrape", "scrape", "globe", .blue, "Scrape App Store metadata"),
        ("Analyze", "analyze", "brain", .purple, "Run AI analysis"),
        ("Sync ASC", "sync", "arrow.triangle.2.circlepath", .green, "Sync from App Store Connect"),
        ("Track Keywords", "track-keywords", "chart.bar.fill", .orange, "Track keyword rankings"),
        ("Discover Keywords", "discover-keywords", "magnifyingglass", .cyan, "AI keyword discovery"),
        ("Discover Competitors", "discover-competitors", "person.2.fill", .pink, "Find competitors"),
    ]

    var body: some View {
        ScrollView {
            actionCards
                .padding()
        }
        .navigationTitle("Actions")
    }

    // MARK: - Action Cards

    @ViewBuilder
    private var actionCards: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(actions, id: \.action) { item in
                Button {
                    Task {
                        guard let bundleId else { return }
                        runningAction = item.action
                        try? await APIService.shared.triggerAction(item.action, bundleId: bundleId)
                        runningAction = nil
                    }
                } label: {
                    VStack(spacing: 8) {
                        if runningAction == item.action {
                            ProgressView()
                                .frame(height: 30)
                        } else {
                            Image(systemName: item.icon)
                                .font(.title3)
                                .foregroundStyle(item.color)
                                .frame(height: 30)
                        }
                        Text(item.name)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(.primary)
                        Text(item.description)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: .rect(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .disabled(runningAction != nil)
            }
        }
    }

}
