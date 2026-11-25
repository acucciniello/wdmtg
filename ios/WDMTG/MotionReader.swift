import CoreMotion
import Foundation

/// Reads the last week of motion history from the phone's motion chip.
/// The phone records this on its own all the time, so the app does not need to
/// run in the background and it costs no battery.
final class MotionReader {
    private let manager = CMMotionActivityManager()

    var isAvailable: Bool { CMMotionActivityManager.isActivityAvailable() }

    var status: CMAuthorizationStatus { CMMotionActivityManager.authorizationStatus() }

    /// Asking for history is also what makes iOS show the permission prompt.
    func drives(days: Double = 7, now: Date = Date()) async -> [Interval] {
        guard isAvailable, status != .denied, status != .restricted else { return [] }
        let from = now.addingTimeInterval(-days * 86_400)
        let activities: [CMMotionActivity] = await withCheckedContinuation { continuation in
            manager.queryActivityStarting(from: from, to: now, to: .main) { list, _ in
                continuation.resume(returning: list ?? [])
            }
        }
        let samples = activities.map {
            MotionSample(start: $0.startDate, automotive: $0.automotive, confident: $0.confidence != .low)
        }
        return DriveDetector.drives(from: samples, until: now)
    }
}
