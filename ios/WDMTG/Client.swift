import Foundation

/// Talks to the desktop app over your local network.
struct Client {
    var pairing: Pairing
    var session: URLSession = .shared

    private var builder: RequestBuilder { RequestBuilder(pairing: pairing) }

    func day(_ date: String) async throws -> Summary {
        try await send(builder.request(path: "/api/day", query: ["date": date]))
    }

    func week(ending date: String) async throws -> Summary {
        try await send(builder.request(path: "/api/week", query: ["end": date]))
    }

    func sync(_ payload: SyncPayload) async throws {
        let body = try JSONEncoder().encode(payload)
        let _: Ack = try await send(builder.request(path: "/api/phone/sync", body: body))
    }

    func sort(keys: [String], into bucket: Bucket) async throws {
        for key in keys {
            let body = try JSONEncoder().encode(["key": key, "bucket": bucket.rawValue])
            let _: Ack = try await send(builder.request(path: "/api/rule", body: body))
        }
    }

    private struct Ack: Decodable { var ok: Bool? }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.unreachable
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError.unauthorized }
        guard code == 200 else { throw APIError.server(code) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
