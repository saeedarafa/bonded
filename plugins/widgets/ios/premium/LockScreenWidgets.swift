import SwiftUI
import WidgetKit

// MOB-77 Lock Screen widgets (D59, SEC-21 Info 5). NOT YET COMPILED: needs a device build check.
//
// Read only: they show today's question or the last little thing from the partner and open the app.
// They never send (no intents here: Lock Screen / Control Center send waits on the PO's SEC-21
// decision). The question text and the partner's name are `.privacySensitive()`: while the phone is
// locked with "Allow access when locked" off (redactionReasons contains .privacy) they show the
// neutral lines instead (question → widget name, little thing → `thinking.gotLocked.*`).

enum LockView {
  case ready(WidgetState)
  case locked
  case expired
}

struct LockEntry: TimelineEntry {
  let date: Date
  let view: LockView
}

@available(iOS 17.0, *)
struct LockProvider: TimelineProvider {
  func placeholder(in context: Context) -> LockEntry { LockEntry(date: Date(), view: .expired) }

  func getSnapshot(in context: Context, completion: @escaping (LockEntry) -> Void) {
    completion(LockEntry(date: Date(), view: .locked))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LockEntry>) -> Void) {
    Task {
      let now = Date()
      let view: LockView
      switch await WidgetClient.state() {
      case .ok(let state): view = .ready(state)
      case .locked: view = .locked
      // A failed read shows "Open Bonded" too: nothing older is kept.
      case .expired, .limit, .undoExpired, .failed: view = .expired
      }
      completion(Timeline(entries: [LockEntry(date: now, view: view)],
                          policy: .after(now.addingTimeInterval(30 * 60))))
    }
  }
}

private func lockLink(_ kind: String, locked: Bool) -> URL {
  locked
    ? URL(string: "bonded://paywall?from=widget&widget_kind=\(kind)")!
    : URL(string: "bonded://today")!
}

@available(iOS 17.0, *)
struct LockNeutralView: View {
  @Environment(\.widgetFamily) var family
  let title: String
  let line: String

  var body: some View {
    if family == .accessoryInline {
      Text(line)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        Text(title)
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .lineLimit(1)
        Text(line)
          .font(.system(size: 13))
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Today's question (Lock Screen)

@available(iOS 17.0, *)
struct LockQuestionView: View {
  @Environment(\.widgetFamily) var family
  @Environment(\.redactionReasons) var redactionReasons
  let entry: LockEntry

  var body: some View {
    content.bondedBackground(.clear)
  }

  @ViewBuilder
  var content: some View {
    switch entry.view {
    case .locked:
      LockNeutralView(title: BondedCopy.t("question.name"), line: BondedCopy.t("locked.cta"))
        .widgetURL(lockLink("todays_question", locked: true))
    case .expired:
      LockNeutralView(title: BondedCopy.t("question.name"), line: BondedCopy.t("open"))
        .widgetURL(lockLink("todays_question", locked: false))
    case .ready(let state):
      ready(state).widgetURL(lockLink("todays_question", locked: false))
    }
  }

  func status(_ today: WidgetToday, partner: String) -> String {
    if !today.me_answered { return BondedCopy.t("question.answerNow") }
    if !today.partner_answered { return BondedCopy.t("question.waiting", ["partner": partner]) }
    return BondedCopy.t("question.reveal")
  }

  @ViewBuilder
  func ready(_ state: WidgetState) -> some View {
    if let today = state.today {
      if redactionReasons.contains(.privacy) {
        LockNeutralView(title: BondedCopy.t("question.name"), line: BondedCopy.t("open"))
      } else if family == .accessoryInline {
        Text(today.question_text).privacySensitive()
      } else {
        VStack(alignment: .leading, spacing: 0) {
          Text(today.question_text)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .lineLimit(2)
            .privacySensitive()
          Text(status(today, partner: state.partner_first_name ?? ""))
            .font(.system(size: 12))
            .lineLimit(1)
            .privacySensitive()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    } else {
      LockNeutralView(title: BondedCopy.t("question.name"), line: BondedCopy.t("open"))
    }
  }
}

// MARK: - Thinking of you (Lock Screen)

@available(iOS 17.0, *)
struct LockThinkingView: View {
  @Environment(\.redactionReasons) var redactionReasons
  let entry: LockEntry

  var body: some View {
    content.bondedBackground(.clear)
  }

  static func time(_ iso: String) -> String {
    guard let date = WidgetTokenStore.parseDate(iso) else { return "" }
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter.string(from: date)
  }

  /// With the partner's name (`thinking.got.*`).
  static func got(_ last: WidgetLastFromPartner, partner: String) -> String {
    let vars = ["partner": partner, "time": time(last.sent_at)]
    switch last.kind {
    case "hug": return BondedCopy.t("thinking.got.hug", vars)
    case "kiss": return BondedCopy.plural("thinking.got.kiss", count: last.count, vars)
    case "goodnight": return BondedCopy.t("thinking.got.goodnight", vars)
    case "good_morning": return BondedCopy.t("thinking.got.good_morning", vars)
    default: return BondedCopy.t("thinking.got.miss_you", vars)
    }
  }

  /// Without the name (`thinking.gotLocked.*`), shown while redacted.
  static func gotLocked(_ last: WidgetLastFromPartner) -> String {
    let vars = ["time": time(last.sent_at)]
    switch last.kind {
    case "hug": return BondedCopy.t("thinking.gotLocked.hug", vars)
    case "kiss": return BondedCopy.plural("thinking.gotLocked.kiss", count: last.count, vars)
    case "goodnight": return BondedCopy.t("thinking.gotLocked.goodnight", vars)
    case "good_morning": return BondedCopy.t("thinking.gotLocked.good_morning", vars)
    default: return BondedCopy.t("thinking.gotLocked.miss_you", vars)
    }
  }

  @ViewBuilder
  var content: some View {
    switch entry.view {
    case .locked:
      LockNeutralView(title: BondedCopy.t("thinking.name"), line: BondedCopy.t("locked.cta"))
        .widgetURL(lockLink("thinking_of_you", locked: true))
    case .expired:
      LockNeutralView(title: BondedCopy.t("thinking.name"), line: BondedCopy.t("open"))
        .widgetURL(lockLink("thinking_of_you", locked: false))
    case .ready(let state):
      Group {
        if let last = state.last_from_partner {
          if redactionReasons.contains(.privacy) {
            LockNeutralView(title: BondedCopy.t("thinking.name"), line: Self.gotLocked(last))
          } else {
            LockNeutralView(
              title: BondedCopy.t("thinking.name"),
              line: Self.got(last, partner: state.partner_first_name ?? "")
            )
            .privacySensitive()
          }
        } else {
          LockNeutralView(
            title: BondedCopy.t("thinking.name"),
            line: BondedCopy.t("thinking.never", ["partner": state.partner_first_name ?? ""])
          )
          .privacySensitive()
        }
      }
      .widgetURL(lockLink("thinking_of_you", locked: false))
    }
  }
}

@available(iOS 17.0, *)
struct BondedLockQuestionWidget: Widget {
  nonisolated static let kind = "BondedLockQuestion"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: LockProvider()) { entry in
      LockQuestionView(entry: entry)
    }
    .configurationDisplayName(BondedCopy.t("question.name"))
    .description(BondedCopy.t("question.name"))
    .supportedFamilies([.accessoryRectangular, .accessoryInline])
  }
}

@available(iOS 17.0, *)
struct BondedLockThinkingWidget: Widget {
  nonisolated static let kind = "BondedLockThinking"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: LockProvider()) { entry in
      LockThinkingView(entry: entry)
    }
    .configurationDisplayName(BondedCopy.t("thinking.name"))
    .description(BondedCopy.t("thinking.name"))
    .supportedFamilies([.accessoryRectangular, .accessoryInline])
  }
}
