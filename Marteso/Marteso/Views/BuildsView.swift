import SwiftUI

struct BuildsView: View {
    let bundleId: String?
    let apps: [AppItem]

    @State private var jobs: [BuildJob] = []
    @State private var latest: LatestBuildInfo?
    @State private var isLoading = true
    @State private var error: String?
    @State private var isTriggering = false

    private var appId: String? {
        if let bundleId, let match = apps.first(where: { $0.bundleId == bundleId }) {
            return match.id
        }

        return apps.first(where: { $0.isOwnApp })?.id ?? apps.first?.id
    }

    var body: some View {
        Group {
            if isLoading && jobs.isEmpty {
                LoadingView("Loading builds...")
            } else if let error, jobs.isEmpty {
                ErrorView(message: error) { Task { await load() } }
            } else if jobs.isEmpty {
                EmptyStateView(
                    icon: "hammer.fill",
                    title: "No Builds",
                    message: "Trigger your first build to get started."
                )
            } else {
                buildsContent
            }
        }
        .navigationTitle("Builds")
        .toolbar {
            if appId != nil {
                Button {
                    Task { await trigger() }
                } label: {
                    if isTriggering {
                        ProgressView()
                    } else {
                        Label("Build", systemImage: "play.fill")
                    }
                }
                .disabled(isTriggering)
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private var buildsContent: some View {
        List {
            if let latest {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(latest.originalFilename)
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Text("v\(latest.version ?? "?") (\(latest.buildNumber ?? "?")) · \(latest.exportMethod)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(formatBytes(latest.sizeBytes))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    SectionHeader("Latest Build", icon: "archivebox.fill")
                }
            }

            Section {
                ForEach(jobs) { job in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            StatusBadge(status: job.status)
                            Spacer()
                            Text(relativeDate(job.createdAt))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if let version = job.version {
                            Text("v\(version) (\(job.buildNumber ?? "?"))")
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        HStack(spacing: 8) {
                            if let branch = job.branch {
                                Label(branch, systemImage: "point.3.connected.trianglepath.dotted")
                            }
                            if let sha = job.commitSha {
                                Text(String(sha.prefix(7)))
                                    .monospaced()
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        if let summary = job.errorSummary {
                            Text(summary)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: {
                SectionHeader("Build Jobs", icon: "hammer.fill")
            }
        }
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
            if let bundleId {
                latest = try? await APIService.shared.getLatestBuild(bundleId: bundleId)
            }
            jobs = try await APIService.shared.getBuildJobs(appId: appId)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func trigger() async {
        guard let appId else { return }
        isTriggering = true
        do {
            try await APIService.shared.triggerBuild(appId: appId)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        isTriggering = false
    }

    private func relativeDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return iso }

        return date.formatted(.relative(presentation: .named))
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()

        return formatter.string(fromByteCount: Int64(bytes))
    }
}
