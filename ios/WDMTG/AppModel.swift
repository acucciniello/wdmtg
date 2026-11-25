import Foundation
import Observation
import UIKit

/// Everything the screens need, in one place.
@MainActor
@Observable
final class AppModel {
    enum Load: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    var pairing: Pairing?
    var day: Summary?
    var week: Summary?
    var date = Date()
    var load: Load = .idle
    var log = LogBook()
    var lastSync: Date?
    var drivesFound = 0
    var motionAllowed: Bool?

    private let motion = MotionReader()
    private let defaults = UserDefaults.standard
    private var logURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("log.json")
    }

    init() {
        pairing = Keychain.load()
        if let data = try? Data(contentsOf: logURL), let book = try? JSONDecoder().decode(LogBook.self, from: data) {
            log = book
        }
        if let data = defaults.data(forKey: "lastDay"), let cached = try? JSONDecoder().decode(Summary.self, from: data) {
            day = cached
        }
        lastSync = defaults.object(forKey: "lastSync") as? Date
        refreshMotionStatus()
        #if DEBUG
        // Lets automated checks start the app already paired and on a given day.
        let env = ProcessInfo.processInfo.environment
        if let link = env["WDMTG_PAIR"], let url = URL(string: link), let fromEnv = Pairing(url: url) {
            pairing = fromEnv
            day = nil
        }
        if let back = Int(env["WDMTG_DAYS_AGO"] ?? ""), let moved = Calendar.current.date(byAdding: .day, value: -back, to: date) {
            date = moved
        }
        #endif
    }

    var isToday: Bool { Calendar.current.isDateInToday(date) }

    // MARK: Pairing

    func pair(_ new: Pairing) {
        pairing = new
        Keychain.save(new)
        Task { await refresh() }
    }

    func unpair() {
        pairing = nil
        Keychain.save(nil)
        day = nil
        week = nil
        load = .idle
    }

    // MARK: Dashboard

    func refresh() async {
        guard let pairing else {
            load = .idle
            return
        }
        if day == nil { load = .loading }
        let client = Client(pairing: pairing)
        do {
            let fresh = try await client.day(localDateString(date))
            day = fresh
            load = .loaded
            if isToday, let data = try? JSONEncoder().encode(fresh) { defaults.set(data, forKey: "lastDay") }
            week = try? await client.week(ending: localDateString(date))
        } catch APIError.unauthorized {
            load = .failed("This phone is no longer paired. Scan the code on your computer again.")
        } catch {
            load = .failed("Can't reach your computer. Be on the same Wi-Fi with WDMTG running there.")
        }
        await sync()
    }

    func step(days: Int) {
        guard let moved = Calendar.current.date(byAdding: .day, value: days, to: date), moved <= Date() else { return }
        date = moved
        day = nil
        Task { await refresh() }
    }

    func sort(_ item: Summary.Item, into bucket: Bucket) async {
        guard let pairing else { return }
        try? await Client(pairing: pairing).sort(keys: item.allKeys, into: bucket)
        await refresh()
    }

    // MARK: Logging off-screen time

    func startLog(title: String, bucket: Bucket) {
        log.start(title: title, bucket: bucket)
        saveLog()
    }

    func stopLog() {
        log.stop()
        saveLog()
        Task { await sync() }
    }

    func removeLog(_ entry: LogEntry) {
        log.remove(id: entry.id)
        saveLog()
    }

    private func saveLog() {
        log.prune()
        if let data = try? JSONEncoder().encode(log) { try? data.write(to: logURL, options: .atomic) }
    }

    // MARK: Sync

    func refreshMotionStatus() {
        switch motion.status {
        case .authorized: motionAllowed = true
        case .denied, .restricted: motionAllowed = false
        default: motionAllowed = nil
        }
    }

    /// Send drives and logged activities to the computer. Safe to repeat: the computer ignores duplicates.
    func sync() async {
        guard let pairing else { return }
        let drives = await motion.drives()
        refreshMotionStatus()
        drivesFound = drives.count
        let payload = SyncPayload(device: UIDevice.current.name, drives: drives, log: log)
        do {
            try await Client(pairing: pairing).sync(payload)
            lastSync = Date()
            defaults.set(lastSync, forKey: "lastSync")
        } catch {
            // The next sync sends everything again.
        }
    }
}
