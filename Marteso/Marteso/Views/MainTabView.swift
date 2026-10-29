import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0
    @State private var apps: [AppItem] = []
    @State private var selectedBundleId: String?
    @State private var showAllApps = false

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Dashboard", systemImage: "square.grid.2x2.fill", value: 0) {
                DashboardView(bundleId: $selectedBundleId, showAllApps: $showAllApps, apps: apps)
            }

            Tab("Analytics", systemImage: "chart.bar.fill", value: 1) {
                AnalyticsView(bundleId: selectedBundleId, apps: apps, showAllApps: $showAllApps)
            }

            Tab("Keywords", systemImage: "key.fill", value: 2) {
                KeywordsView(bundleId: selectedBundleId, apps: apps, showAllApps: $showAllApps)
            }

            Tab("Versions", systemImage: "doc.text.fill", value: 3) {
                VersionsView(bundleId: selectedBundleId)
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

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            List {
                // Settings
                Section {
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

                Section {
                    Text("Marteso \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            }
            .navigationTitle("Settings")
        }
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
