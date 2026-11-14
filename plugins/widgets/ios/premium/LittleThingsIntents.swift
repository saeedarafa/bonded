import AppIntents
import Foundation
import WidgetKit

// MOB-77 Little things (D59, SEC-21). NOT YET COMPILED: needs a device build check.
//
// Interactive widget buttons (iOS 17). They run in the widget extension, never open the app, are
// hidden from Shortcuts/Spotlight and need an unlocked phone (`.requiresAuthentication`), so nothing
// sends from the Lock Screen, StandBy or Control Center (that waits on the PO's SEC-21 decision).
// Every tap is a new client_id; a transport failure retries the same tap once with the same id.

/// What the Little things widget shows after a tap (the extension's own defaults, not the App Group;
/// no partner data, no token).
struct LittleThingsStatus: Codable {
  enum Kind: String, Codable { case sent, limit, failed }

  let status: Kind
  let kind: String
  /// The little thing's id, for Undo (only for `sent`).
  let id: String?
  let at: Date

  static let undoWindow: TimeInterval = 5
  /// How long `limit` / `failed` stay before the widget goes back to its buttons.
  static let showFor: TimeInterval = 30
  private static let key = "bonded.widget.littleThings.status"

  var undoable: Bool { status == .sent && id != nil }

  func undoEnds() -> Date { at.addingTimeInterval(LittleThingsStatus.undoWindow) }
  func endsAt() -> Date {
    status == .sent ? undoEnds() : at.addingTimeInterval(LittleThingsStatus.showFor)
  }

  static func load(now: Date = Date()) -> LittleThingsStatus? {
    guard let data = UserDefaults.standard.data(forKey: key),
      let value = try? JSONDecoder().decode(LittleThingsStatus.self, from: data),
      value.endsAt() > now
    else { return nil }
    return value
  }

  static func save(_ value: LittleThingsStatus?) {
    if let value, let data = try? JSONEncoder().encode(value) {
      UserDefaults.standard.set(data, forKey: key)
    } else {
      UserDefaults.standard.removeObject(forKey: key)
    }
  }
}

@available(iOS 17.0, *)
struct SendLittleThingIntent: AppIntent {
  static var title: LocalizedStringResource = "Send a little thing"
  static var openAppWhenRun: Bool = false
  static var isDiscoverable: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Kind")
  var kind: String

  init() {}

  init(kind: String) {
    self.kind = kind
  }

  func perform() async throws -> some IntentResult {
    guard WidgetClient.sendableKinds.contains(kind) else { return .result() }
    let clientId = UUID()
    var response = await WidgetClient.send(kind: kind, clientId: clientId)
    if case .failed(retryable: true) = response {
      response = await WidgetClient.send(kind: kind, clientId: clientId)
    }
    let now = Date()
    switch response {
    case .ok(let sent):
      LittleThingsStatus.save(LittleThingsStatus(status: .sent, kind: kind, id: sent.id, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send")
    case .limit(let limitKind):
      LittleThingsStatus.save(
        LittleThingsStatus(status: .limit, kind: limitKind ?? kind, id: nil, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send_failed")
    case .locked, .expired:
      // The timeline shows the locked preview / "Open Bonded" from a fresh `state`.
      LittleThingsStatus.save(nil)
    case .undoExpired, .failed:
      LittleThingsStatus.save(LittleThingsStatus(status: .failed, kind: kind, id: nil, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send_failed")
    }
    WidgetCenter.shared.reloadTimelines(ofKind: BondedLittleThingsWidget.kind)
    return .result()
  }
}

@available(iOS 17.0, *)
struct UndoLittleThingIntent: AppIntent {
  static var title: LocalizedStringResource = "Undo a little thing"
  static var openAppWhenRun: Bool = false
  static var isDiscoverable: Bool = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Id")
  var id: String

  init() {}

  init(id: String) {
    self.id = id
  }

  func perform() async throws -> some IntentResult {
    // Only the little thing this widget just sent, and only inside its 5 s window.
    guard let current = LittleThingsStatus.load(), current.undoable, current.id == id,
      Date() < current.undoEnds()
    else { return .result() }
    let response = await WidgetClient.undo(id: id)
    if case .ok = response {
      WidgetActionQueue.record(kind: "little_things", action: "undo")
    }
    // Undone, expired, or failed: the buttons come back either way (the send stands unless undone).
    LittleThingsStatus.save(nil)
    WidgetCenter.shared.reloadTimelines(ofKind: BondedLittleThingsWidget.kind)
    return .result()
  }
}
