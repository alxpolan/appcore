import SwiftUI

struct ScreenshotsView: View {
    let bundleId: String?
    let apps: [AppItem]

    @State private var jobs: [ScreenshotJob] = []
    @State private var isLoading = true
    @State private var error: String?

    private var appId: String? {
        if let bundleId, let match = apps.first(where: { $0.bundleId == bundleId }) {
            return match.id
        }

        return apps.first(where: { $0.isOwnApp })?.id ?? apps.first?.id
    }

    var body: some View {
        Group {
            if isLoading && jobs.isEmpty {
                LoadingView("Loading screenshots...")
            } else if let error, jobs.isEmpty {
                ErrorView(message: error) { Task { await load() } }
            } else if jobs.isEmpty {
                EmptyStateView(
                    icon: "photo.stack.fill",
                    title: "No Screenshots",
                    message: "Screenshot jobs from CI will appear here."
                )
            } else {
                List {
                    ForEach(jobs) { job in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                StatusBadge(status: job.status)
                                Spacer()
                                Text(relativeDate(job.createdAt))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            if let message = job.commitMessage {
                                Text(message)
                                    .font(.subheadline)
                                    .lineLimit(2)
                            }
                            HStack(spacing: 8) {
                                if let pusher = job.pusher {
                                    Label(pusher, systemImage: "person.fill")
                                }
                                if let branch = job.branch {
                                    Label(branch, systemImage: "point.3.connected.trianglepath.dotted")
                                }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            if let jobError = job.error {
                                Text(jobError)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                            }
                            if !job.screenshotUrls.isEmpty {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(job.screenshotUrls, id: \.self) { url in
                                            AsyncImage(url: URL(string: url)) { image in
                                                image
                                                    .resizable()
                                                    .aspectRatio(contentMode: .fill)
                                            } placeholder: {
                                                ProgressView()
                                            }
                                            .frame(width: 90, height: 180)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .navigationTitle("Screenshots")
        .refreshable { await load() }
        .task { await load() }
    }

    private func relativeDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return iso }

        return date.formatted(.relative(presentation: .named))
    }

    private func load() async {
        guard let appId else {
            error = "No app selected."
            isLoading = false

            return
        }
        isLoading = true
        error = nil
        do {
            jobs = try await APIService.shared.getScreenshotJobs(appId: appId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
