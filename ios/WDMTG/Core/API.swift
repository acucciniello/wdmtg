import Foundation

/// How to reach the desktop app on your Wi-Fi.
struct Pairing: Codable, Equatable {
    var host: String
    var port: Int
    var token: String

    init(host: String, port: Int, token: String) {
        self.host = host
        self.port = port
        self.token = token
    }

    /// Reads a pairing link: wdmtg://pair?host=192.168.1.20&port=48321&token=abc
    init?(url: URL) {
        guard url.scheme?.lowercased() == "wdmtg", url.host?.lowercased() == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let host = value("host"), !host.isEmpty,
              let token = value("token"), !token.isEmpty,
              let port = Int(value("port") ?? ""), (1...65535).contains(port) else { return nil }
        // Only plain host names and addresses, so a crafted link cannot smuggle in a path or user info.
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-:"))
        guard host.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        self.init(host: host, port: port, token: token)
    }

    var baseURL: URL? {
        var c = URLComponents()
        c.scheme = "http"
        c.host = host
        c.port = port
        return c.url
    }
}

/// What the phone sends to the desktop app.
struct SyncPayload: Codable, Equatable {
    var device: String
    var motion: [Motion]
    var manual: [Manual]

    struct Motion: Codable, Equatable {
        var type: String
        var start: Double
        var end: Double
    }

    struct Manual: Codable, Equatable {
        var id: String
        var title: String
        var bucket: String
        var start: Double
        var end: Double
    }

    init(device: String, drives: [Interval], log: LogBook) {
        self.device = device
        self.motion = drives.map { Motion(type: "driving", start: $0.start, end: $0.end) }
        self.manual = log.finished.compactMap { entry in
            guard let end = entry.end else { return nil }
            return Manual(id: entry.id, title: entry.title, bucket: entry.bucket, start: entry.start, end: end)
        }
    }
}

enum APIError: Error, Equatable {
    case notPaired
    case unauthorized
    case unreachable
    case server(Int)
}

/// Builds the requests. Kept separate from the network so it can be tested.
struct RequestBuilder {
    var pairing: Pairing

    func request(path: String, query: [String: String] = [:], body: Data? = nil) throws -> URLRequest {
        guard let base = pairing.baseURL, var c = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw APIError.notPaired }
        c.path = path
        if !query.isEmpty { c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw APIError.notPaired }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpMethod = "POST"
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }
}
