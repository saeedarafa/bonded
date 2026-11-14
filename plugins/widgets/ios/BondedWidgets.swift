import SwiftUI
import WidgetKit

// Home and lock-screen widgets (MOB-30, screen 38, D26) and the "your turn" pair (38b, D47).
// Tapping opens Today: bonded://today?widget=<layout> (the layout is for analytics only).
// Colours come from BondedColors.swift, generated from src/ui/tokens.json at prebuild.

struct BondedEntry: TimelineEntry {
  let date: Date
  let snapshot: BondedSnapshot

  var newDay: Bool { snapshot.isNewDay(at: date) }
}

struct BondedProvider: TimelineProvider {
  func placeholder(in context: Context) -> BondedEntry {
    BondedEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (BondedEntry) -> Void) {
    completion(BondedEntry(date: Date(), snapshot: BondedSnapshotStore.load() ?? .placeholder))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<BondedEntry>) -> Void) {
    let now = Date()
    let snapshot = BondedSnapshotStore.load() ?? .placeholder
    var entries = [BondedEntry(date: now, snapshot: snapshot)]
    // At the couple's midnight the day this snapshot describes ends: switch to "New question".
    if let ends = snapshot.dayEnds, ends > now {
      entries.append(BondedEntry(date: ends, snapshot: snapshot))
    }
    // The app reloads the widgets whenever Today changes; this is only a safety net.
    let next = (snapshot.dayEnds.map { max($0, now) } ?? now).addingTimeInterval(6 * 3600)
    completion(Timeline(entries: entries, policy: .after(next)))
  }
}

// MARK: - Pieces

func bondedLink(_ layout: String) -> URL {
  URL(string: "bonded://today?widget=\(layout)")!
}

struct BondedMascot: View {
  let mood: String
  let size: CGFloat

  var body: some View {
    Image("mascot-\(mood)")
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

struct BondedCta: View {
  let label: String

  var body: some View {
    Text(label)
      .font(.system(size: 13, weight: .bold, design: .rounded))
      .foregroundColor(.bondedOnYou)
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 6)
      .background(Capsule().fill(Color.bondedYou))
  }
}

extension View {
  @ViewBuilder
  func bondedBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) { color }
    } else {
      padding().background(color)
    }
  }
}

// MARK: - 38 Today (small, medium, lock screen)

struct TodaySmallView: View {
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    VStack(spacing: 2) {
      BondedMascot(mood: entry.newDay ? "waiting" : s.mood, size: 60)
      Text(entry.newDay ? s.text.newDayTitle : (s.text.day.isEmpty ? s.text.title : s.text.day))
        .font(.system(size: 22, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundColor(.bondedText)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Text(entry.newDay ? s.text.newDayLine : s.text.line)
        .font(.system(size: 13, weight: .medium))
        .foregroundColor(.bondedText2)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct TodayMediumView: View {
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    HStack(spacing: 14) {
      BondedMascot(mood: entry.newDay ? "waiting" : s.mood, size: 96)
      VStack(alignment: .leading, spacing: 4) {
        Text(entry.newDay ? s.text.newDayTitle : s.text.title)
          .font(.system(size: 19, weight: .bold, design: .rounded))
          .foregroundColor(.bondedText)
          .lineLimit(2)
          .minimumScaleFactor(0.8)
        Text(entry.newDay ? s.text.newDayLine : s.text.sub)
          .font(.system(size: 13, weight: .medium))
          .foregroundColor(.bondedText2)
          .lineLimit(2)
        if !entry.newDay, s.state != "none", let ends = s.dayEnds {
          (Text(s.text.timer + " ") + Text(ends, style: .relative))
            .font(.system(size: 15, weight: .semibold))
            .monospacedDigit()
            .foregroundColor(.bondedYouText)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
      Spacer(minLength: 0)
    }
  }
}

struct TodayRectangularView: View {
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    HStack(spacing: 8) {
      BondedMascot(mood: entry.newDay ? "waiting" : s.mood, size: 36)
      VStack(alignment: .leading, spacing: 0) {
        Text(entry.newDay ? s.text.newDayTitle : (s.text.streak.isEmpty ? s.text.title : s.text.streak))
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
        Text(entry.newDay ? s.text.newDayLine : s.text.line)
          .font(.system(size: 13))
          .lineLimit(2)
      }
      Spacer(minLength: 0)
    }
  }
}

struct TodayWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    switch family {
    case .systemMedium:
      TodayMediumView(entry: entry).bondedBackground(.bondedSurface).widgetURL(bondedLink("today"))
    case .accessoryRectangular:
      TodayRectangularView(entry: entry).bondedBackground(.clear).widgetURL(bondedLink("today"))
    case .accessoryInline:
      Text(entry.newDay ? s.text.newDayLine : s.text.line)
        .bondedBackground(.clear)
        .widgetURL(bondedLink("today"))
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Text("\(s.streak)")
            .font(.system(size: 20, weight: .bold, design: .rounded))
            .monospacedDigit()
          BondedMascot(mood: s.mood, size: 18)
        }
      }
      .accessibilityLabel(s.text.streak.isEmpty ? s.text.line : s.text.streak)
      .bondedBackground(.clear)
      .widgetURL(bondedLink("today"))
    default:
      TodaySmallView(entry: entry).bondedBackground(.bondedSurface).widgetURL(bondedLink("today"))
    }
  }
}

// MARK: - 38b Your turn (small): Countdown, Partner answered

struct CountdownView: View {
  let entry: BondedEntry
  let ends: Date

  var body: some View {
    let s = entry.snapshot
    ZStack(alignment: .topTrailing) {
      VStack(alignment: .leading, spacing: 4) {
        Text(s.text.turn)
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(.bondedYouText)
        Text(ends, style: .relative)
          .font(.system(size: 26, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundColor(.bondedText)
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .padding(.top, 6)
        Text(s.text.keep)
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(.bondedText2)
          .lineLimit(2)
        Spacer(minLength: 0)
        BondedCta(label: s.text.cta)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      BondedMascot(mood: s.mood, size: 44).offset(x: 4, y: -10)
    }
  }
}

struct PartnerAnsweredView: View {
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        BondedMascot(mood: s.mood, size: 42)
        Spacer()
        Image(systemName: "lock")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(.bondedText2)
          .accessibilityHidden(true)
      }
      Text(s.text.title)
        .font(.system(size: 17, weight: .bold, design: .rounded))
        .foregroundColor(.bondedText)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Text(s.text.sub)
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(.bondedText2)
        .lineLimit(2)
      Spacer(minLength: 0)
      BondedCta(label: s.text.cta)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct YourTurnWidgetView: View {
  let entry: BondedEntry

  var body: some View {
    let s = entry.snapshot
    if !entry.newDay, s.state == "partnerAnswered" {
      PartnerAnsweredView(entry: entry)
        .bondedBackground(.bondedSurface)
        .widgetURL(bondedLink("partner_answered"))
    } else if !entry.newDay, s.state == "yourTurn" || s.state == "napping", let ends = s.dayEnds {
      CountdownView(entry: entry, ends: ends)
        .bondedBackground(.bondedSurface)
        .widgetURL(bondedLink("countdown"))
    } else {
      // I've answered (or there's nothing to count down): the 38 small layout.
      TodaySmallView(entry: entry)
        .bondedBackground(.bondedSurface)
        .widgetURL(bondedLink("today"))
    }
  }
}

// MARK: - Widgets

struct BondedTodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "BondedToday", provider: BondedProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Bonded")
    .description("Whose turn it is and your streak. Answers stay in the app.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline, .accessoryCircular,
    ])
  }
}

struct BondedYourTurnWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "BondedYourTurn", provider: BondedProvider()) { entry in
      YourTurnWidgetView(entry: entry)
    }
    .configurationDisplayName("Your turn")
    .description("Time left to answer, and when your partner has answered. Never their answer.")
    .supportedFamilies([.systemSmall])
  }
}

@main
struct BondedWidgetBundle: WidgetBundle {
  var body: some Widget {
    BondedTodayWidget()
    BondedYourTurnWidget()
    // BONDED_PREMIUM_WIDGETS
  }
}
