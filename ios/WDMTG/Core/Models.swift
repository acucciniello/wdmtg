import Foundation

/// The four places time can go, plus the neutral ones the timeline needs.
enum Bucket: String, Codable, CaseIterable, Identifiable {
    case money, life, busy, lost, unsorted, away, sleep, untracked

    var id: String { rawValue }

    /// The four a person can choose between.
    static let choices: [Bucket] = [.money, .life, .busy, .lost]

    var title: String {
        switch self {
        case .money: return "Making money"
        case .life: return "Life"
        case .busy: return "Busywork"
        case .lost: return "Lost"
        case .unsorted: return "Not sorted yet"
        case .away: return "Off screens"
        case .sleep: return "Asleep"
        case .untracked: return "Not tracked yet"
        }
    }

    var short: String {
        switch self {
        case .money: return "Money"
        case .busy: return "Busywork"
        default: return title
        }
    }
}

/// What the desktop app sends for a day or a week.
struct Summary: Codable, Equatable {
    var date: String?
    var from: Double
    var to: Double
    var now: Double
    var headline: String
    var awakeMs: Double
    var totals: [String: Double]
    var devices: Devices
    var leaks: [Leak]
    var top: [Item]
    var calls: [Item]
    var timeline: [Run]?
    var days: [Day]?

    struct Devices: Codable, Equatable {
        var mac: Mac
        var iphone: Phone
        var calls: Calls
        struct Mac: Codable, Equatable { var activeMs: Double; var openIdleMs: Double }
        struct Phone: Codable, Equatable { var activeMs: Double; var pickups: Int }
        struct Calls: Codable, Equatable { var ms: Double; var count: Int }
    }

    struct Leak: Codable, Equatable, Identifiable {
        var id: String
        var ms: Double
        var title: String
        var detail: String
        var fix: String?
    }

    struct Item: Codable, Equatable, Identifiable {
        var key: String
        var keys: [String]?
        var name: String
        var kind: String?
        var bucket: String
        var label: String?
        var ms: Double
        var id: String { key + "|" + bucket }
        var allKeys: [String] { keys ?? [key] }
        var bucketValue: Bucket { Bucket(rawValue: bucket) ?? .unsorted }
    }

    /// One coloured block on the day line.
    struct Run: Codable, Equatable {
        var s: Double
        var e: Double
        var b: String
        var n: [String]
        var bucket: Bucket { Bucket(rawValue: b) ?? .unsorted }
    }

    struct Day: Codable, Equatable, Identifiable {
        var date: String
        var totals: [String: Double]
        var id: String { date }
    }

    func total(_ bucket: Bucket) -> Double { totals[bucket.rawValue] ?? 0 }

    func share(_ bucket: Bucket) -> Double { awakeMs > 0 ? total(bucket) / awakeMs : 0 }
}

/// "2h 05m", "45m", "<1m". Same wording as the desktop app.
func formatDuration(_ ms: Double) -> String {
    let minutes = Int((ms / 60_000).rounded())
    if minutes < 1 { return ms > 0 ? "<1m" : "0m" }
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    let rest = minutes % 60
    return rest == 0 ? "\(hours)h" : "\(hours)h \(rest < 10 ? "0" : "")\(rest)m"
}

func localDateString(_ date: Date, calendar: Calendar = .current) -> String {
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}
