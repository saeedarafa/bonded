import AppIntents
import SwiftUI
import WidgetKit

// MOB-77 Lock Screen "Send a hug" (circular) and the iOS 18 Control Center control (screen 38c-10,
// D59). Typechecked with swiftc against the iOS SDK; not yet built or run on a device.
//
// SEC-21 recommended default (lead decision 2026-11-14): one-tap sends from the Lock Screen and
// Control Center are allowed with `authenticationPolicy = .requiresAuthentication`, so a locked
// phone asks to unlock before anything is sent. Both use the same send path as the Home Screen
// buttons (LittleThingsSender). No partner name and no question here: the Lock Screen and Control
// Center are visible while the phone is locked.

enum LockSendView {
  case ready
  case sent
  case done
  case locked
  case expired
}

struct LockSendEntry: TimelineEntry {
  let date: Date
  let view: LockSendView
}

/// The hug state for the Lock Screen and the control, from `state` plus this extension's status line.
func lockSendView(_ response: WidgetResponse<WidgetState>, status: LittleThingsStatus?) -> LockSendView {
  switch response {
  case .ok(let state):
    if let status, status.status == .sent, status.kind == "hug" { return .sent }
    return state.atLimit("hug") ? .done : .ready
  case .locked: return .locked
  case .expired, .limit, .undoExpired, .failed: return .expired
  }
}

@available(iOS 17.0, *)
struct LockSendProvider: TimelineProvider {
  func placeholder(in context: Context) -> LockSendEntry { LockSendEntry(date: Date(), view: .ready) }

  func getSnapshot(in context: Context, completion: @escaping (LockSendEntry) -> Void) {
    // The gallery preview: never fetch for it.
    completion(LockSendEntry(date: Date(), view: .ready))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LockSendEntry>) -> Void) {
    Task {
      let now = Date()
      let status = LittleThingsStatus.load(now: now)
      let view = lockSendView(await WidgetClient.state(), status: status)
      var entries = [LockSendEntry(date: now, view: view)]
      // "Sent" for the 5 s Undo window (Undo itself only in the app), then the heart again.
      if case .sent = view, let status {
        entries.append(LockSendEntry(date: status.endsAt(), view: .ready))
      }
      completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
  }
}

@available(iOS 17.0, *)
struct LockSendWidgetView: View {
  let entry: LockSendEntry

  var body: some View {
    content
      .bondedBackground(Color.clear)
  }

  @ViewBuilder
  var content: some View {
    switch entry.view {
    case .ready:
      Button(intent: SendLittleThingIntent(kind: "hug")) {
        circle("heart.fill", BondedCopy.t("lockSend.hug"))
      }
      .buttonStyle(.plain)
      .accessibilityLabel(BondedCopy.t("lockSend.a11y"))
    case .sent:
      circle("checkmark", BondedCopy.t("lockSend.sent"))
    case .done:
      circle("heart", BondedCopy.t("lockSend.hug"))
        .opacity(0.5)
        .accessibilityLabel(BondedCopy.t("littleThings.limit.hug"))
        .widgetURL(littleThingsOpenURL())
    case .locked:
      circle("lock.fill", BondedCopy.t("locked.premium"))
        .widgetURL(littleThingsPaywallURL())
    case .expired:
      circle("heart", BondedCopy.t("lockSend.hug"))
        .accessibilityLabel(BondedCopy.t("open"))
        .widgetURL(littleThingsOpenURL())
    }
  }

  func circle(_ symbol: String, _ label: String) -> some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 1) {
        Image(systemName: symbol)
          .font(.system(size: 18, weight: .semibold))
          .widgetAccentable()
        Text(label)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
      .padding(4)
    }
  }
}

@available(iOS 17.0, *)
struct BondedLockSendWidget: Widget {
  nonisolated static let kind = "BondedLockSend"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: LockSendProvider()) { entry in
      LockSendWidgetView(entry: entry)
    }
    .configurationDisplayName(BondedCopy.t("lockSend.name"))
    .description(BondedCopy.t("lockSend.description"))
    .supportedFamilies([.accessoryCircular])
  }
}

// MARK: - Control Center (iOS 18)

@available(iOS 18.0, *)
struct HugControlProvider: ControlValueProvider {
  var previewValue: LockSendView { .ready }

  func currentValue() async throws -> LockSendView {
    lockSendView(await WidgetClient.state(), status: LittleThingsStatus.load())
  }
}

@available(iOS 18.0, *)
struct BondedSendHugControl: ControlWidget {
  nonisolated static let kind = "BondedSendHug"

  static func label(_ view: LockSendView) -> (String, String) {
    switch view {
    case .ready: return (BondedCopy.t("lockSend.name"), "heart.fill")
    case .sent: return (BondedCopy.t("lockSend.sent"), "checkmark")
    case .done: return (BondedCopy.t("littleThings.limit.hug"), "heart")
    case .locked: return (BondedCopy.t("locked.premium"), "lock.fill")
    case .expired: return (BondedCopy.t("open"), "heart")
    }
  }

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind, provider: HugControlProvider()) { view in
      let (title, symbol) = Self.label(view)
      ControlWidgetButton(action: SendHugControlIntent()) {
        Label(title, systemImage: symbol)
      }
      .tint(Color.bondedYou)
    }
    .displayName(LocalizedStringResource(stringLiteral: BondedCopy.t("lockSend.name")))
    .description(LocalizedStringResource(stringLiteral: BondedCopy.t("lockSend.description")))
  }
}
