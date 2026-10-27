import SwiftUI

struct AdsView: View {
    let bundleId: String?

    @State private var source = 0
    @State private var googleCampaigns: [GoogleAdsCampaign] = []
    @State private var appleCampaigns: [AppleAdsCampaign] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        VStack {
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
                List(googleCampaigns) { campaign in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(campaign.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            StatusBadge(status: campaign.status)
                        }
                        HStack(spacing: 12) {
                            metric("Spend", value: String(format: "%.2f", campaign.spend))
                            metric("Clicks", value: "\(campaign.clicks)")
                            metric("Impr.", value: "\(campaign.impressions)")
                            metric("Conv.", value: String(format: "%.0f", campaign.conversions))
                        }
                        .font(.caption)
                        if let budget = campaign.dailyBudget {
                            Text("Budget \(String(format: "%.2f", budget)) \(campaign.currency ?? "")/day")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
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
                List(appleCampaigns) { campaign in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(campaign.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Spacer()
                            StatusBadge(status: campaign.status)
                        }
                        HStack(spacing: 12) {
                            metric("Spend", value: String(format: "%.2f", campaign.spend))
                            metric("Taps", value: "\(campaign.taps)")
                            metric("Installs", value: "\(campaign.installs)")
                        }
                        .font(.caption)
                        if let budget = campaign.dailyBudget {
                            Text("Budget \(String(format: "%.2f", budget)) \(campaign.currency ?? "")/day")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func metric(_ label: String, value: String) -> some View {
        VStack(alignment: .leading) {
            Text(value)
                .fontWeight(.semibold)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            if source == 0 {
                googleCampaigns = try await APIService.shared.getGoogleAdsCampaigns()
            } else {
                appleCampaigns = try await APIService.shared.getAppleAdsCampaigns(bundleId: bundleId)
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
