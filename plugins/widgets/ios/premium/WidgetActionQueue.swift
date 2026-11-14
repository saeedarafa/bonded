import Foundation

// MOB-77 (ANALYTICS §3.7 `widget_action`). NOT YET COMPILED: needs a device build check.
//
// The extension never talks to PostHog. It queues {widget_kind, action} in the App Group (nothing
// else: no ids, names, counts, text or token) and the app sends the queue the next time it opens
// (BondedWidgetsModule.takeActionQueue → src/features/widgets/analytics.ts flushWidgetActions).

enum WidgetActionQueue {
  /// Same key as plugins/widgets/modules/bonded-widgets (the app side).
  static let key = "bonded.widget.actions"
  /// Oldest entries are dropped beyond this (the app also caps a flush at 50).
  static let max = 50

  /// src/lib/analytics/catalogue.ts WIDGET_KINDS / WIDGET_ACTIONS.
  static let kinds: Set<String> = [
    "little_things", "thinking_of_you", "days_together", "streak", "todays_question", "mood",
    "on_this_day", "ritual_time",
  ]
  static let actions: Set<String> = ["view_locked", "tap_open", "send", "undo", "send_failed"]

  private static let lock = NSLock()

  static func record(kind: String, action: String) {
    guard kinds.contains(kind), actions.contains(action),
      let group = Bundle.main.object(forInfoDictionaryKey: "BondedAppGroup") as? String,
      let defaults = UserDefaults(suiteName: group)
    else { return }
    lock.lock()
    defer { lock.unlock() }
    var entries: [[String: String]] = []
    if let json = defaults.string(forKey: key),
      let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: String]]
    {
      entries = parsed
    }
    entries.append(["widget_kind": kind, "action": action])
    if entries.count > max { entries.removeFirst(entries.count - max) }
    guard let data = try? JSONSerialization.data(withJSONObject: entries),
      let json = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(json, forKey: key)
  }
}
