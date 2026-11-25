import Foundation

/// A stretch of time in unix milliseconds.
struct Interval: Codable, Equatable {
    var start: Double
    var end: Double
    var seconds: Double { (end - start) / 1000 }
}

/// One reading from the phone's motion chip. A reading lasts until the next one.
struct MotionSample: Equatable {
    var start: Date
    var automotive: Bool
    var confident: Bool
}

/// Finds drives in the phone's motion history.
enum DriveDetector {
    /// - Parameters:
    ///   - bridge: stops shorter than this (red lights, gas) stay part of one drive.
    ///   - minimum: anything shorter is ignored as noise.
    static func drives(
        from samples: [MotionSample],
        until end: Date,
        bridge: TimeInterval = 180,
        minimum: TimeInterval = 180
    ) -> [Interval] {
        let sorted = samples.sorted { $0.start < $1.start }
        var raw: [(start: Date, end: Date)] = []
        var driving = false
        var openedAt: Date?

        for sample in sorted {
            // A low-confidence reading does not change what we believe is happening.
            guard sample.confident else { continue }
            if sample.automotive && !driving {
                driving = true
                openedAt = sample.start
            } else if !sample.automotive && driving {
                driving = false
                if let from = openedAt { raw.append((from, sample.start)) }
                openedAt = nil
            }
        }
        if driving, let from = openedAt, end > from { raw.append((from, end)) }

        var merged: [(start: Date, end: Date)] = []
        for piece in raw {
            if let last = merged.last, piece.start.timeIntervalSince(last.end) <= bridge {
                merged[merged.count - 1].end = max(last.end, piece.end)
            } else {
                merged.append(piece)
            }
        }

        return merged
            .filter { $0.end.timeIntervalSince($0.start) >= minimum }
            .map { Interval(start: ($0.start.timeIntervalSince1970 * 1000).rounded(), end: ($0.end.timeIntervalSince1970 * 1000).rounded()) }
    }
}
