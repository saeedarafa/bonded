import Foundation

// The snapshot the app writes (src/features/widgets/snapshot.ts, MOB-30). Reveal rule (FUN-04):
// booleans, the deadline, counts, the partner's first name and fixed copy. Never answer text.

struct BondedWidgetText: Codable {
  let day: String
  let line: String
  let title: String
  let sub: String
  let streak: String
  let timer: String
  let turn: String
  let keep: String
  let cta: String
  let newDayTitle: String
  let newDayLine: String
}

struct BondedSnapshot: Codable {
  static let version = 1

  let v: Int
  let state: String
  let mood: String
  let answeredByMe: Bool
  let partnerAnswered: Bool
  let partnerJoined: Bool
  let streak: Int
  let day: Int?
  let partnerName: String?
  /// Epoch ms: the couple-local midnight that ends the day this snapshot describes.
  let dayEndsAt: Double?
  let updatedAt: Double
  let text: BondedWidgetText

  var dayEnds: Date? { dayEndsAt.map { Date(timeIntervalSince1970: $0 / 1000) } }

  /// The day this snapshot describes has ended: a new question is waiting.
  func isNewDay(at date: Date) -> Bool {
    guard let ends = dayEnds else { return false }
    return date >= ends
  }

  /// Shown before the app has written anything (and in the widget gallery).
  static let placeholder = BondedSnapshot(
    v: version, state: "none", mood: "snuggled", answeredByMe: false, partnerAnswered: false,
    partnerJoined: false, streak: 0, day: nil, partnerName: nil, dayEndsAt: nil, updatedAt: 0,
    text: BondedWidgetText(
      day: "Bonded", line: "Open Bonded to start", title: "Bonded",
      sub: "Answer a question together every day.", streak: "", timer: "Left today",
      turn: "Your turn", keep: "to start a streak", cta: "Answer now",
      newDayTitle: "New question", newDayLine: "Today's question is ready"))
}

enum BondedSnapshotStore {
  /// Same key as plugins/widgets/modules/bonded-widgets (the app side).
  static let key = "bonded.widget.snapshot"

  static var appGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "BondedAppGroup") as? String
  }

  static func load() -> BondedSnapshot? {
    guard let group = appGroup,
      let json = UserDefaults(suiteName: group)?.string(forKey: key),
      let data = json.data(using: .utf8),
      let snapshot = try? JSONDecoder().decode(BondedSnapshot.self, from: data),
      snapshot.v == BondedSnapshot.version
    else { return nil }
    return snapshot
  }
}
