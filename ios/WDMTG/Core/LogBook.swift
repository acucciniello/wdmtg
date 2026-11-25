import Foundation

/// Something you told the app you were doing away from your screens.
struct LogEntry: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var bucket: String
    var start: Double
    var end: Double?

    var isRunning: Bool { end == nil }
    var bucketValue: Bucket { Bucket(rawValue: bucket) ?? .unsorted }
}

/// The list of logged activities. At most one is running at a time.
struct LogBook: Codable, Equatable {
    var entries: [LogEntry] = []

    var running: LogEntry? { entries.first { $0.isRunning } }

    /// Starting something new stops whatever was running.
    mutating func start(title: String, bucket: Bucket, at date: Date = Date(), id: String = UUID().uuidString) {
        stop(at: date)
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        entries.append(LogEntry(id: id, title: name.isEmpty ? bucket.title : name, bucket: bucket.rawValue, start: ms(date), end: nil))
    }

    mutating func stop(at date: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.isRunning }) else { return }
        let end = ms(date)
        // Under a minute is a mis-tap, not an activity.
        if end - entries[index].start < 60_000 {
            entries.remove(at: index)
        } else {
            entries[index].end = end
        }
    }

    mutating func remove(id: String) {
        entries.removeAll { $0.id == id }
    }

    /// Finished entries, newest first.
    var finished: [LogEntry] {
        entries.filter { !$0.isRunning }.sorted { $0.start > $1.start }
    }

    /// Keep the book small: drop finished entries older than `days`.
    mutating func prune(olderThan days: Double = 30, now: Date = Date()) {
        let cutoff = ms(now) - days * 86_400_000
        entries.removeAll { ($0.end ?? .infinity) < cutoff }
    }

    private func ms(_ date: Date) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }
}
