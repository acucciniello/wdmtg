import XCTest
@testable import WDMTGCore

final class CoreTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    // The fixtures are real responses from the desktop app, so this proves the two apps agree.
    func testDecodesWhatTheDesktopSendsForADay() throws {
        let day = try JSONDecoder().decode(Summary.self, from: fixture("day"))
        XCTAssertEqual(day.date, "2026-03-11")
        XCTAssertGreaterThan(day.awakeMs, 0)
        XCTAssertGreaterThan(day.total(.money), 0)
        XCTAssertGreaterThan(day.total(.lost), 0)
        XCTAssertFalse(day.leaks.isEmpty)
        XCTAssertFalse(day.top.isEmpty)
        XCTAssertFalse((day.timeline ?? []).isEmpty)
        let covered = (day.timeline ?? []).reduce(0) { $0 + $1.e - $1.s }
        XCTAssertEqual(covered, day.now - day.from, accuracy: 1, "the day line has no holes")
        let known = Set(Bucket.allCases.map(\.rawValue))
        XCTAssertTrue((day.timeline ?? []).allSatisfy { known.contains($0.b) })
        XCTAssertTrue(day.top.allSatisfy { !$0.allKeys.isEmpty })
        XCTAssertEqual(Bucket.choices.reduce(0) { $0 + day.share($1) } <= 1.0001, true)
    }

    func testDecodesAWeek() throws {
        let week = try JSONDecoder().decode(Summary.self, from: fixture("week"))
        XCTAssertEqual(week.days?.count, 7)
        XCTAssertNil(week.date)
    }

    func testFormatDuration() {
        XCTAssertEqual(formatDuration(0), "0m")
        XCTAssertEqual(formatDuration(20_000), "<1m")
        XCTAssertEqual(formatDuration(59 * 60_000), "59m")
        XCTAssertEqual(formatDuration(120 * 60_000), "2h")
        XCTAssertEqual(formatDuration(125 * 60_000), "2h 05m")
    }

    // MARK: Drives

    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func sample(_ minutes: Double, car: Bool, sure: Bool = true) -> MotionSample {
        MotionSample(start: t0.addingTimeInterval(minutes * 60), automotive: car, confident: sure)
    }

    func testADriveWithARedLightIsOneDrive() {
        let drives = DriveDetector.drives(from: [
            sample(0, car: false), sample(10, car: true), sample(18, car: false),
            sample(19, car: true), sample(30, car: false),
        ], until: t0.addingTimeInterval(3600))
        XCTAssertEqual(drives.count, 1)
        XCTAssertEqual(drives[0].seconds, 20 * 60, accuracy: 0.5)
    }

    func testTwoSeparateDrivesAndNoiseIsDropped() {
        let drives = DriveDetector.drives(from: [
            sample(0, car: true), sample(15, car: false),
            sample(40, car: true), sample(41, car: false), // one minute: noise
            sample(90, car: true), sample(120, car: false),
        ], until: t0.addingTimeInterval(4 * 3600))
        XCTAssertEqual(drives.map { Int($0.seconds / 60) }, [15, 30])
    }

    func testUnsureReadingsDoNotEndOrStartADrive() {
        let drives = DriveDetector.drives(from: [
            sample(0, car: true), sample(5, car: false, sure: false), sample(20, car: false),
            sample(50, car: true, sure: false),
        ], until: t0.addingTimeInterval(3600))
        XCTAssertEqual(drives.map { Int($0.seconds / 60) }, [20])
    }

    func testADriveStillGoingEndsNow() {
        let drives = DriveDetector.drives(from: [sample(0, car: true)], until: t0.addingTimeInterval(600))
        XCTAssertEqual(drives.first?.seconds ?? 0, 600, accuracy: 0.5)
    }

    // MARK: Logging

    func testLogBookRunsOneThingAtATime() {
        var book = LogBook()
        book.start(title: "  Showing ", bucket: .money, at: t0, id: "a")
        XCTAssertEqual(book.running?.title, "Showing")
        book.start(title: "", bucket: .life, at: t0.addingTimeInterval(1800), id: "b")
        XCTAssertEqual(book.running?.id, "b")
        XCTAssertEqual(book.running?.title, "Life", "an empty name falls back to the bucket")
        XCTAssertEqual(book.finished.map(\.id), ["a"])
        book.stop(at: t0.addingTimeInterval(1820))
        XCTAssertEqual(book.entries.map(\.id), ["a"], "a 20 second entry is a mis-tap")
        XCTAssertNil(book.running)
        book.prune(olderThan: 30, now: t0.addingTimeInterval(40 * 86_400))
        XCTAssertTrue(book.entries.isEmpty)
    }

    // MARK: Talking to the desktop

    func testPairingLink() throws {
        let pairing = try XCTUnwrap(Pairing(url: XCTUnwrap(URL(string: "wdmtg://pair?host=192.168.1.20&port=48321&token=abc-DEF_1"))))
        XCTAssertEqual(pairing, Pairing(host: "192.168.1.20", port: 48321, token: "abc-DEF_1"))
        XCTAssertEqual(pairing.baseURL?.absoluteString, "http://192.168.1.20:48321")
        for bad in ["https://pair?host=a&port=1&token=t", "wdmtg://pair?host=a&port=99999&token=t", "wdmtg://pair?host=a&port=1",
                    "wdmtg://pair?host=evil.com/x&port=1&token=t", "wdmtg://pair?host=u@evil.com&port=1&token=t", "wdmtg://other?host=a&port=1&token=t"] {
            XCTAssertNil(Pairing(url: try XCTUnwrap(URL(string: bad))), bad)
        }
    }

    func testRequestsCarryTheTokenAndStayOnThePairedHost() throws {
        let builder = RequestBuilder(pairing: Pairing(host: "192.168.1.20", port: 48321, token: "tok"))
        let get = try builder.request(path: "/api/day", query: ["date": "2026-03-11"])
        XCTAssertEqual(get.url?.absoluteString, "http://192.168.1.20:48321/api/day?date=2026-03-11")
        XCTAssertEqual(get.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(get.httpMethod, "GET")
        let post = try builder.request(path: "/api/phone/sync", body: Data("{}".utf8))
        XCTAssertEqual(post.httpMethod, "POST")
        XCTAssertEqual(post.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testSyncPayloadMatchesWhatTheDesktopExpects() throws {
        var book = LogBook()
        book.start(title: "Showing", bucket: .money, at: t0, id: "a")
        book.stop(at: t0.addingTimeInterval(3600))
        book.start(title: "Gym", bucket: .life, at: t0.addingTimeInterval(7200), id: "b") // still running: not sent
        let payload = SyncPayload(device: "iPhone", drives: [Interval(start: 1000, end: 601_000)], log: book)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(json["device"] as? String, "iPhone")
        let motion = try XCTUnwrap(json["motion"] as? [[String: Any]])
        XCTAssertEqual(motion.first?["type"] as? String, "driving")
        XCTAssertEqual(motion.first?["end"] as? Double, 601_000)
        let manual = try XCTUnwrap(json["manual"] as? [[String: Any]])
        XCTAssertEqual(manual.count, 1)
        XCTAssertEqual(manual.first?["id"] as? String, "a")
        XCTAssertEqual(manual.first?["bucket"] as? String, "money")
        XCTAssertEqual(manual.first?["title"] as? String, "Showing")
    }
}
