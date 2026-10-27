import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0
    @State private var apps: [AppItem] = []
    @State private var selectedBundleId: String?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Dashboard", systemImage: "square.grid.2x2.fill", value: 0) {
                DashboardView(bundleId: selectedBundleId)
            }

            Tab("Analytics", systemImage: "chart.bar.fill", value: 1) {
                AnalyticsView(bundleId: selectedBundleId)
            }

            Tab("Keywords", systemImage: "key.fill", value: 2) {
                KeywordsView(bundleId: selectedBundleId)
            }

            Tab("Versions", systemImage: "doc.text.fill", value: 3) {
                VersionsView(bundleId: selectedBundleId)
            }

            Tab("More", systemImage: "ellipsis.circle.fill", value: 4) {
                MoreView(
                    bundleId: $selectedBundleId,
                    apps: $apps,
                    selectedTab: $selectedTab
                )
            }
        }
        .task {
            await loadApps()
        }
    }

    private func loadApps() async {
        do {
            let all = try await APIService.shared.getApps()
            apps = all.filter { $0.isOwnApp }
            if selectedBundleId == nil, let first = apps.first {
                selectedBundleId = first.bundleId
            }
        } catch {
            print("Failed to load apps: \(error)")
        }
    }
}

// MARK: - More Tab (Settings, Suggestions, Actions, App Switcher)

struct MoreView: View {
    @Binding var bundleId: String?
    @Binding var apps: [AppItem]
    @Binding var selectedTab: Int

    var body: some View {
        NavigationStack {
            List {
                // App Switcher
                Section {
                    ForEach(apps) { app in
                        Button {
                            bundleId = app.bundleId
                        } label: {
                            HStack(spacing: 12) {
                                AppIconView(url: app.iconUrl, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(app.name)
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .foregroundStyle(.primary)
                                    Text(app.bundleId)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if app.bundleId == bundleId {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.tint)
                                }
                            }
                        }
                    }
                } header: {
                    SectionHeader("Apps", icon: "app.badge")
                }

                // Features
                Section {
                    NavigationLink {
                        SuggestionsView(bundleId: bundleId)
                    } label: {
                        Label("Suggestions", systemImage: "lightbulb.fill")
                    }

                    NavigationLink {
                        ActionsView(bundleId: bundleId)
                    } label: {
                        Label("Actions", systemImage: "bolt.fill")
                    }

                    NavigationLink {
                        ReviewsView(bundleId: bundleId)
                    } label: {
                        Label("Reviews", systemImage: "star.bubble.fill")
                    }

                    NavigationLink {
                        BuildsView(bundleId: bundleId, apps: apps)
                    } label: {
                        Label("Builds", systemImage: "hammer.fill")
                    }

                    NavigationLink {
                        ScreenshotsView(bundleId: bundleId, apps: apps)
                    } label: {
                        Label("Screenshots", systemImage: "photo.stack.fill")
                    }

                    NavigationLink {
                        AdsView(bundleId: bundleId)
                    } label: {
                        Label("Ads", systemImage: "megaphone.fill")
                    }

                    NavigationLink {
                        ProductPagesView(bundleId: bundleId)
                    } label: {
                        Label("Product Pages", systemImage: "rectangle.on.rectangle.fill")
                    }
                } header: {
                    SectionHeader("Features", icon: "square.stack.3d.up.fill")
                }

                // Settings
                Section {
                    NavigationLink {
                        AppSettingsView()
                    } label: {
                        Label("Settings", systemImage: "gearshape.fill")
                    }

                    NavigationLink {
                        NotificationSettingsView()
                    } label: {
                        Label("Notifications", systemImage: "bell.fill")
                    }

                    Button(role: .destructive) {
                        AuthManager.shared.logout()
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } header: {
                    SectionHeader("Account", icon: "person.fill")
                }
            }
            .navigationTitle("More")
        }
    }
}

// MARK: - App Settings

struct AppSettingsView: View {
    var body: some View {
        Form {
            Section("Server") {
                LabeledContent("URL", value: APIService.shared.baseURL)
            }

            Section("About") {
                LabeledContent("App Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
            }
        }
        .navigationTitle("Settings")
    }
}

// MARK: - Notification Settings

struct NotificationSettingsView: View {
    @Bindable var pushManager = PushNotificationManager.shared

    var body: some View {
        Form {
            Section {
                LabeledContent("Status") {
                    switch pushManager.permissionStatus {
                    case .authorized:
                        Label("Enabled", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    case .denied:
                        Label("Disabled", systemImage: "xmark.circle.fill")
                            .foregroundStyle(.red)
                    default:
                        Label("Not Set", systemImage: "questionmark.circle.fill")
                            .foregroundStyle(.orange)
                    }
                }

                if pushManager.permissionStatus == .notDetermined {
                    Button("Enable Push Notifications") {
                        Task { await pushManager.requestPermission() }
                    }
                } else if pushManager.permissionStatus == .denied {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                }
            } header: {
                Text("Push Notifications")
            } footer: {
                Text("Receive alerts when keyword rankings change, submissions are processed, or jobs complete.")
            }

            Section("Notification Types") {
                Label("Keyword Rank Changes", systemImage: "chart.line.uptrend.xyaxis")
                Label("App Store Submissions", systemImage: "paperplane.fill")
                Label("Job Completions", systemImage: "checkmark.seal.fill")
            }

            if let token = pushManager.deviceToken {
                Section("Device Token") {
                    Text(token)
                        .font(.caption2)
                        .monospaced()
                        .lineLimit(2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Notifications")
        .task {
            await pushManager.checkPermissionStatus()
        }
    }
}
