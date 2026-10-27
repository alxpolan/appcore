import SwiftUI

struct ProductPagesView: View {
    let bundleId: String?

    @State private var pages: [ProductPage] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading && pages.isEmpty {
                LoadingView("Loading product pages...")
            } else if let error, pages.isEmpty {
                ErrorView(message: error) { Task { await load() } }
            } else if pages.isEmpty {
                EmptyStateView(
                    icon: "rectangle.on.rectangle.fill",
                    title: "No Product Pages",
                    message: "Custom product pages will appear here."
                )
            } else {
                List(pages) { page in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(page.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            if let visible = page.visible {
                                StatusBadge(status: visible ? "Visible" : "Hidden")
                            }
                        }
                        if let versions = page.versions, !versions.isEmpty {
                            ForEach(versions) { version in
                                HStack {
                                    Text("v\(version.version ?? "?")")
                                        .font(.caption)
                                        .fontWeight(.medium)
                                    Spacer()
                                    if let state = version.state {
                                        Text(state)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    if version.isEditable == true {
                                        Image(systemName: "pencil.circle.fill")
                                            .foregroundStyle(.tint)
                                            .font(.caption)
                                    }
                                }
                            }
                        } else {
                            Text("No versions")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("Product Pages")
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            pages = try await APIService.shared.getProductPages(bundleId: bundleId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
