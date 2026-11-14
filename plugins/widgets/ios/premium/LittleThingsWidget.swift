import AppIntents
import SwiftUI
import WidgetKit

// MOB-77 Little things widget (screen 38c, D59). NOT YET COMPILED: needs a device build check.
//
// Home Screen only (small, medium): buttons that send through SendLittleThingIntent. No Lock Screen
// families: one-tap send from the Lock Screen waits on the PO's SEC-21 decision. Data comes from
// the `widget` function's `state` on every timeline reload; after a 401 nothing is kept.

enum LittleThingsView {
  case ready(WidgetState, LittleThingsStatus?)
  case locked
  case expired
  case failed
}

struct LittleThingsEntry: TimelineEntry {
  let date: Date
  let view: LittleThingsView
}

/// Records `view_locked` once per locked spell, not on every reload.
enum LockedSeen {
  private static let key = "bonded.widget.littleThings.lockedSeen"

  static func update(locked: Bool) {
    let seen = UserDefaults.standard.bool(forKey: key)
    if locked && !seen { WidgetActionQueue.record(kind: "little_things", action: "view_locked") }
    UserDefaults.standard.set(locked, forKey: key)
  }
}

@available(iOS 17.0, *)
struct LittleThingsProvider: TimelineProvider {
  func placeholder(in context: Context) -> LittleThingsEntry {
    LittleThingsEntry(date: Date(), view: .expired)
  }

  func getSnapshot(in context: Context, completion: @escaping (LittleThingsEntry) -> Void) {
    // The gallery preview: never fetch partner data for it.
    completion(LittleThingsEntry(date: Date(), view: .locked))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LittleThingsEntry>) -> Void) {
    Task {
      let now = Date()
      let status = LittleThingsStatus.load(now: now)
      let view: LittleThingsView
      switch await WidgetClient.state() {
      case .ok(let state): view = .ready(state, status)
      case .locked: view = .locked
      case .expired: view = .expired
      case .limit, .undoExpired, .failed: view = .failed
      }
      if case .locked = view { LockedSeen.update(locked: true) } else { LockedSeen.update(locked: false) }
      var entries = [LittleThingsEntry(date: now, view: view)]
      // Back to the buttons when the Undo window (or the limit / failed line) ends.
      if case .ready(let state, let status?) = view {
        entries.append(LittleThingsEntry(date: status.endsAt(), view: .ready(state, nil)))
      }
      let next = now.addingTimeInterval(30 * 60)
      completion(Timeline(entries: entries, policy: .after(next)))
    }
  }
}

func littleThingsPaywallURL() -> URL {
  URL(string: "bonded://paywall?from=widget&widget_kind=little_things")!
}

func littleThingsOpenURL() -> URL {
  URL(string: "bonded://today")!
}

@available(iOS 17.0, *)
struct LittleThingButton: View {
  let kind: String
  let label: String
  let disabled: Bool

  var body: some View {
    Button(intent: SendLittleThingIntent(kind: kind)) {
      Text(label)
        .font(.system(size: 13, weight: .bold, design: .rounded))
        .foregroundStyle(disabled ? Color.bondedText3 : Color.bondedOnYou)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(Capsule().fill(disabled ? Color.bondedLine : Color.bondedYou))
    }
    .buttonStyle(.plain)
    .disabled(disabled)
  }
}

@available(iOS 17.0, *)
struct LittleThingsWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: LittleThingsEntry

  static func sendLabel(_ kind: String, partner: String) -> String {
    switch kind {
    case "hug": return BondedCopy.t("littleThings.send.hug", ["partner": partner])
    case "good_morning": return BondedCopy.t("littleThings.send.good_morning")
    default: return BondedCopy.t("littleThings.send.goodnight")
    }
  }

  static func doneLabel(_ kind: String) -> String {
    switch kind {
    case "hug": return BondedCopy.t("littleThings.limit.hug")
    case "kiss": return BondedCopy.t("littleThings.limit.kiss")
    case "miss_you": return BondedCopy.t("littleThings.limit.miss_you")
    case "good_morning": return BondedCopy.t("littleThings.onceADay.good_morning")
    default: return BondedCopy.t("littleThings.onceADay.goodnight")
    }
  }

  var body: some View {
    content.bondedBackground(Color.bondedSurface)
  }

  @ViewBuilder
  var content: some View {
    switch entry.view {
    case .ready(let state, let status):
      ready(state, status)
    case .locked:
      VStack(alignment: .leading, spacing: 6) {
        Text(BondedCopy.t("littleThings.name"))
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .foregroundStyle(Color.bondedText)
        Text(BondedCopy.t("locked.premium"))
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Color.bondedText2)
        Spacer(minLength: 0)
        BondedCta(label: BondedCopy.t("locked.cta"))
      }
      .widgetURL(littleThingsPaywallURL())
    case .expired:
      message(BondedCopy.t("expired"), BondedCopy.t("open"))
    case .failed:
      message(BondedCopy.t("littleThings.name"), BondedCopy.t("open"))
    }
  }

  func message(_ title: String, _ cta: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(Color.bondedText)
      Spacer(minLength: 0)
      BondedCta(label: cta)
    }
    .widgetURL(littleThingsOpenURL())
  }

  @ViewBuilder
  func ready(_ state: WidgetState, _ status: LittleThingsStatus?) -> some View {
    let partner = state.partner_first_name ?? ""
    let kinds = family == .systemSmall ? ["hug"] : ["hug", "good_morning", "goodnight"]
    VStack(alignment: .leading, spacing: 8) {
      Text(BondedCopy.t("littleThings.name"))
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(Color.bondedText)
        .accessibilityAddTraits(.isHeader)
      if let status {
        statusLine(status, partner: partner)
      } else {
        Text(BondedCopy.t("littleThings.tapToSend"))
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Color.bondedText2)
      }
      Spacer(minLength: 0)
      HStack(spacing: 8) {
        ForEach(kinds, id: \.self) { kind in
          let done = state.atLimit(kind)
          LittleThingButton(
            kind: kind,
            label: done ? Self.doneLabel(kind) : Self.sendLabel(kind, partner: partner),
            disabled: done)
        }
      }
    }
    .widgetURL(littleThingsOpenURL())
  }

  @ViewBuilder
  func statusLine(_ status: LittleThingsStatus, partner: String) -> some View {
    switch status.status {
    case .sent:
      HStack(spacing: 8) {
        Text(BondedCopy.t("littleThings.sent", ["partner": partner]))
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Color.bondedYouText)
        if let id = status.id {
          Button(intent: UndoLittleThingIntent(id: id)) {
            Text(BondedCopy.t("littleThings.undo"))
              .font(.system(size: 13, weight: .bold))
              .foregroundStyle(Color.bondedText)
              .frame(minWidth: 44, minHeight: 44)
          }
          .buttonStyle(.plain)
        }
      }
    case .limit:
      Text(Self.doneLabel(status.kind))
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Color.bondedText2)
    case .failed:
      Text(BondedCopy.t("littleThings.failed"))
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Color.bondedText2)
    }
  }
}

@available(iOS 17.0, *)
struct BondedLittleThingsWidget: Widget {
  nonisolated static let kind = "BondedLittleThings"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: LittleThingsProvider()) { entry in
      LittleThingsWidgetView(entry: entry)
    }
    .configurationDisplayName(BondedCopy.t("littleThings.name"))
    .description(BondedCopy.t("littleThings.tapToSend"))
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
