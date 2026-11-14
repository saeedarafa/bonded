import AppIntents
import Foundation
import WidgetKit

// MOB-77 Little things (D59, SEC-21). Typechecked with swiftc against the iOS SDK; not yet built
// or run on a device.
//
// Interactive widget buttons (iOS 17) and the iOS 18 control. They run in the widget extension,
// never open the app to send, are hidden from Shortcuts/Spotlight and need an unlocked phone
// (`.requiresAuthentication`): from the Lock Screen, StandBy or Control Center a tap asks to unlock
// first (SEC-21 recommended default, lead decision 2026-11-14). Every tap is a new client_id; a
// transport failure retries the same tap once with the same id.

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

/// What a send ended as, for the intent that ran it.
enum LittleThingSendOutcome {
  case sent
  case limit
  case locked
  case expired
  case failed
}

/// The one send path for every surface (Home Screen buttons, Lock Screen circular, Control Center):
/// a new client_id per tap, one retry of the same tap on a transport failure, the status line, the
/// analytics entry, then every surface that shows the status reloads.
@available(iOS 17.0, *)
enum LittleThingsSender {
  static func send(kind: String) async -> LittleThingSendOutcome {
    guard WidgetClient.sendableKinds.contains(kind) else { return .failed }
    let clientId = UUID()
    var response = await WidgetClient.send(kind: kind, clientId: clientId)
    if case .failed(retryable: true) = response {
      response = await WidgetClient.send(kind: kind, clientId: clientId)
    }
    let now = Date()
    let outcome: LittleThingSendOutcome
    switch response {
    case .ok(let sent):
      LittleThingsStatus.save(LittleThingsStatus(status: .sent, kind: kind, id: sent.id, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send")
      outcome = .sent
    case .limit(let limitKind):
      LittleThingsStatus.save(
        LittleThingsStatus(status: .limit, kind: limitKind ?? kind, id: nil, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send_failed")
      outcome = .limit
    case .locked:
      // The timeline shows the locked preview from a fresh `state`.
      LittleThingsStatus.save(nil)
      outcome = .locked
    case .expired:
      // The timeline shows "Open Bonded" from a fresh `state`.
      LittleThingsStatus.save(nil)
      outcome = .expired
    case .undoExpired, .failed:
      LittleThingsStatus.save(LittleThingsStatus(status: .failed, kind: kind, id: nil, at: now))
      WidgetActionQueue.record(kind: "little_things", action: "send_failed")
      outcome = .failed
    }
    reloadSurfaces()
    return outcome
  }

  static func reloadSurfaces() {
    WidgetCenter.shared.reloadTimelines(ofKind: BondedLittleThingsWidget.kind)
    WidgetCenter.shared.reloadTimelines(ofKind: BondedLockSendWidget.kind)
    if #available(iOSApplicationExtension 18.0, *) {
      ControlCenter.shared.reloadControls(ofKind: BondedSendHugControl.kind)
    }
  }
}

@available(iOS 17.0, *)
struct SendLittleThingIntent: AppIntent {
  static let title: LocalizedStringResource = "Send a little thing"
  static let openAppWhenRun: Bool = false
  static let isDiscoverable: Bool = false
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Kind")
  var kind: String

  init() {}

  init(kind: String) {
    self.kind = kind
  }

  func perform() async throws -> some IntentResult {
    _ = await LittleThingsSender.send(kind: kind)
    return .result()
  }
}

/// iOS 18 Control Center / Lock Screen bottom row / Action button "Send a hug" (spec 38c-10). Same
/// rules and send path as SendLittleThingIntent (unlock first, never opens the app to send). When
/// the send cannot happen it opens Bonded instead (iOS 18.2+, where an intent result can open a
/// URL without its own return type): the paywall for a free couple, Today when signed out or when
/// the hugs are done for today. On 18.0 / 18.1 the control's label already says so.
@available(iOS 18.0, *)
struct SendHugControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Send a hug"
  static let openAppWhenRun: Bool = false
  static let isDiscoverable: Bool = false
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  init() {}

  func perform() async throws -> IntentResultContainer<Never, Never, Never, Never> {
    let outcome = await LittleThingsSender.send(kind: "hug")
    if #available(iOSApplicationExtension 18.2, *) {
      switch outcome {
      case .locked: return .result(opensIntent: OpenURLIntent(littleThingsPaywallURL()))
      case .expired, .limit: return .result(opensIntent: OpenURLIntent(littleThingsOpenURL()))
      case .sent, .failed: break
      }
    }
    return .result()
  }
}

@available(iOS 17.0, *)
struct UndoLittleThingIntent: AppIntent {
  static let title: LocalizedStringResource = "Undo a little thing"
  static let openAppWhenRun: Bool = false
  static let isDiscoverable: Bool = false
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

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
    LittleThingsSender.reloadSurfaces()
    return .result()
  }
}
