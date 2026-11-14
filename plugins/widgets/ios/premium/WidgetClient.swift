import Foundation

// MOB-77 (D59, SEC-21 option A; CONTRACTS §3 `widget`). NOT YET COMPILED: needs a device build check.
//
// The only network code in the extension: POST ${BondedSupabaseURL}/functions/v1/widget with
// `Authorization: Bearer bwt_…` (never a user JWT, never in the URL or body). Reads only the
// allow-listed `state` fields it shows; unknown keys are ignored. Nothing is cached on disk
// (ephemeral session, no URL cache) and nothing is logged. A 401 means "Open Bonded": callers drop
// whatever they showed before.

struct WidgetLittleThing: Decodable {
  let kind: String
  let at_limit: Bool
}

struct WidgetLastFromPartner: Decodable {
  let kind: String
  let count: Int
  let sent_at: String
}

struct WidgetToday: Decodable {
  let question_text: String
  let me_answered: Bool
  let partner_answered: Bool
}

/// `state` for a Premium couple (only the fields these widgets show).
struct WidgetState: Decodable {
  let partner_first_name: String?
  let today: WidgetToday?
  let last_from_partner: WidgetLastFromPartner?
  let little_things: [WidgetLittleThing]

  func atLimit(_ kind: String) -> Bool {
    little_things.first { $0.kind == kind }?.at_limit ?? false
  }
}

struct WidgetSendResult: Decodable {
  let id: String
  let same_time: Bool
  let at_limit: Bool
}

enum WidgetResponse<Value> {
  case ok(Value)
  /// 200 `state` with `premium: false`, or 403 PREMIUM_REQUIRED: the locked preview → paywall.
  case locked
  /// No token, or 401 WIDGET_AUTH: "Open Bonded", no data.
  case expired
  /// 409 LITTLE_THING_LIMIT.
  case limit(kind: String?)
  /// 409 UNDO_EXPIRED.
  case undoExpired
  /// Offline, timeout, 429, 5xx or anything unexpected. `retryable`: the request may not have
  /// reached the server (a retry of the same tap reuses its client_id).
  case failed(retryable: Bool)
}

enum WidgetClient {
  /// The little things a widget can send (CONTRACTS §3: amount is always 1).
  static let sendableKinds: Set<String> = ["hug", "kiss", "goodnight", "good_morning", "miss_you"]

  static var endpoint: URL? {
    guard let base = Bundle.main.object(forInfoDictionaryKey: "BondedSupabaseURL") as? String,
      base.hasPrefix("http")
    else { return nil }
    return URL(string: "\(base)/functions/v1/widget")
  }

  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    config.httpCookieStorage = nil
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 15
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  private struct Locked: Decodable { let premium: Bool }
  private struct ErrorBody: Decodable {
    let error: String
    let kind: String?
  }

  static func state() async -> WidgetResponse<WidgetState> {
    let response = await post(["action": "state"])
    switch response {
    case .ok(let data):
      guard let flag = try? JSONDecoder().decode(Locked.self, from: data) else {
        return .failed(retryable: false)
      }
      if !flag.premium { return .locked }
      guard let state = try? JSONDecoder().decode(WidgetState.self, from: data) else {
        return .failed(retryable: false)
      }
      return .ok(state)
    case .locked: return .locked
    case .expired: return .expired
    case .limit(let kind): return .limit(kind: kind)
    case .undoExpired: return .undoExpired
    case .failed(let retryable): return .failed(retryable: retryable)
    }
  }

  /// One tap = one `clientId` (a new UUIDv4); pass the same one only to retry that tap.
  static func send(kind: String, clientId: UUID) async -> WidgetResponse<WidgetSendResult> {
    guard sendableKinds.contains(kind) else { return .failed(retryable: false) }
    let response = await post([
      "action": "send", "kind": kind, "client_id": clientId.uuidString.lowercased(),
    ])
    return decode(response)
  }

  /// Undo within 5 s of the send (the server decides; UNDO_EXPIRED after).
  static func undo(id: String) async -> WidgetResponse<[WidgetLittleThing]> {
    guard UUID(uuidString: id) != nil else { return .failed(retryable: false) }
    struct Undo: Decodable { let little_things: [WidgetLittleThing] }
    let response: WidgetResponse<Undo> = decode(await post(["action": "undo", "id": id]))
    switch response {
    case .ok(let value): return .ok(value.little_things)
    case .locked: return .locked
    case .expired: return .expired
    case .limit(let kind): return .limit(kind: kind)
    case .undoExpired: return .undoExpired
    case .failed(let retryable): return .failed(retryable: retryable)
    }
  }

  private static func decode<T: Decodable>(_ response: WidgetResponse<Data>) -> WidgetResponse<T> {
    switch response {
    case .ok(let data):
      guard let value = try? JSONDecoder().decode(T.self, from: data) else {
        return .failed(retryable: false)
      }
      return .ok(value)
    case .locked: return .locked
    case .expired: return .expired
    case .limit(let kind): return .limit(kind: kind)
    case .undoExpired: return .undoExpired
    case .failed(let retryable): return .failed(retryable: retryable)
    }
  }

  private static func post(_ body: [String: String]) async -> WidgetResponse<Data> {
    guard let token = WidgetTokenStore.read() else { return .expired }
    guard let url = endpoint, let payload = try? JSONSerialization.data(withJSONObject: body) else {
      return .failed(retryable: false)
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = payload
    let data: Data
    let http: HTTPURLResponse
    do {
      let (d, r) = try await session.data(for: request)
      guard let h = r as? HTTPURLResponse else { return .failed(retryable: false) }
      data = d
      http = h
    } catch {
      // Transport error: the server may not have the request (a retry reuses the client_id).
      return .failed(retryable: true)
    }
    switch http.statusCode {
    case 200: return .ok(data)
    case 401: return .expired
    case 403: return .locked
    case 409:
      let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
      if body?.error == "UNDO_EXPIRED" { return .undoExpired }
      if body?.error == "LITTLE_THING_LIMIT" { return .limit(kind: body?.kind) }
      return .failed(retryable: false)
    default:
      return .failed(retryable: false)
    }
  }
}
