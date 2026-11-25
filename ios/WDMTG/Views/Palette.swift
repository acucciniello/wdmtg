import SwiftUI
import UIKit

/// The same four colours as the desktop dashboard. They always mean the same thing.
enum Palette {
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255,
                alpha: 1
            )
        })
    }

    static let page = dynamic(0xf3f5f7, 0x171b21)
    static let panel = dynamic(0xffffff, 0x1f242c)
    static let ink = dynamic(0x14213d, 0xeef1f5)
    static let ink2 = dynamic(0x51607a, 0xaab4c3)
    static let line = dynamic(0xdde3ea, 0x2e353f)

    static func color(_ bucket: Bucket) -> Color {
        switch bucket {
        case .money: return dynamic(0x1f8a5b, 0x35a873)
        case .life: return dynamic(0xe0a526, 0xc9941a)
        case .busy: return dynamic(0x4c78c8, 0x6c94e6)
        case .lost: return dynamic(0xe5484d, 0xf0666a)
        case .unsorted: return dynamic(0x9a86c9, 0x9d8bd0)
        case .away: return dynamic(0xcfd7df, 0x3a424e)
        case .sleep: return dynamic(0xe4e9ee, 0x262c35)
        case .untracked: return .clear
        }
    }
}

struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct SectionTitle: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.system(.title3, design: .rounded, weight: .bold))
            .foregroundStyle(Palette.ink)
            .padding(.top, 18)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Four buttons: where does this belong?
struct BucketPicker: View {
    var current: Bucket?
    var pick: (Bucket) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Bucket.choices) { bucket in
                Button {
                    pick(bucket)
                } label: {
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 3).fill(Palette.color(bucket)).frame(width: 9, height: 9)
                        Text(bucket.short).font(.footnote.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 7)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(current == bucket ? Palette.color(bucket).opacity(0.16) : Palette.panel)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(current == bucket ? Palette.color(bucket) : Palette.line, lineWidth: 1.5)
                    )
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.ink)
            }
        }
    }
}
