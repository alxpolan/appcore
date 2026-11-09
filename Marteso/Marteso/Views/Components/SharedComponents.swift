import SwiftUI
import Charts

// MARK: - Metric Spark Card

struct MetricSparkCard: View {
    let title: String
    let icon: String
    let color: Color
    let value: String
    let subtitle: String
    let trend: [Double]

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .semibold))
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(color)

                Spacer()

                Text(subtitle)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 2)

                Text(value)
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            .padding(16)

            Spacer(minLength: 8)

            if trend.count >= 2 {
                Chart(Array(trend.enumerated()), id: \.offset) { index, point in
                    AreaMark(
                        x: .value("Day", index),
                        y: .value("Value", point)
                    )
                    .foregroundStyle(
                        .linearGradient(
                            colors: [color.opacity(0.45), color.opacity(0.02)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .interpolationMethod(.catmullRom)

                    LineMark(
                        x: .value("Day", index),
                        y: .value("Value", point)
                    )
                    .foregroundStyle(color)
                    .interpolationMethod(.catmullRom)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(width: 150, height: 115)
                .padding(.trailing, 4)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 170, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 28))
    }
}

// MARK: - Glass Card

struct GlassCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.title)
                    .foregroundStyle(color)
                VStack(alignment: .leading) {
                    Text(value)
                        .font(.title2)
                        .fontWeight(.bold)
                        .fontDesign(.rounded)
                        .multilineTextAlignment(.leading)
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }
}

// MARK: - App Icon View

struct AppIconView: View {
    let url: String?
    let size: CGFloat

    var body: some View {
        if let url, let imageURL = URL(string: url) {
            AsyncImage(url: imageURL) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                RoundedRectangle(cornerRadius: size * 0.22)
                    .fill(.quaternary)
                    .overlay {
                        Image(systemName: "app.fill")
                            .font(.system(size: size * 0.4))
                            .foregroundStyle(.secondary)
                    }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
        } else {
            RoundedRectangle(cornerRadius: size * 0.22)
                .fill(.quaternary)
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "app.fill")
                        .font(.system(size: size * 0.4))
                        .foregroundStyle(.secondary)
                }
        }
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let status: String

    var color: Color {
        switch status.lowercased() {
        case "completed", "applied", "approved", "ready_for_distribution":
            return .green
        case "running", "in_review", "pending":
            return .orange
        case "failed", "rejected", "expired":
            return .red
        default:
            return .secondary
        }
    }

    var body: some View {
        Text(status.replacing("_", with: " ").capitalized)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

// MARK: - Loading View

struct LoadingView: View {
    let message: String

    init(_ message: String = "Loading...") {
        self.message = message
    }

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error View

struct ErrorView: View {
    let message: String
    let retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let retry {
                Button("Try Again", action: retry)
                    .buttonStyle(.bordered)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Empty State View

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Rating Stars

struct RatingStars: View {
    let rating: Double

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: starImageName(for: star))
                    .font(.caption2)
                    .foregroundStyle(.yellow)
            }
        }
    }

    private func starImageName(for star: Int) -> String {
        let value = Double(star)
        if rating >= value { return "star.fill" }
        if rating >= value - 0.5 { return "star.leadinghalf.filled" }
        return "star"
    }
}

// MARK: - Section Header

struct SectionHeader: View {
    let title: String
    let icon: String?

    init(_ title: String, icon: String? = nil) {
        self.title = title
        self.icon = icon
    }

    var body: some View {
        HStack(spacing: 8) {
            if let icon {
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
            }
            Text(title)
                .font(.headline)
        }
    }
}
