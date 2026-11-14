import ExpoModulesCore
import WidgetKit

/// MOB-30: the app's side of the widgets. Writes the snapshot (src/features/widgets/snapshot.ts)
/// to the App Group the widget extension reads, then asks WidgetKit to redraw.
/// The App Group id comes from Info.plist `BondedAppGroup` (plugins/widgets sets it).
///
/// MOB-77 (premium widgets, SEC-21 option A):
/// - `keychainAccessGroup`: Info.plist `BondedWidgetKeychainGroup` (`<team>.com.hellobonded.app.widget`,
///   set by the plugin only with `premium: true`). nil without it, or when Xcode left the
///   `$(AppIdentifierPrefix)` unexpanded: the app then never mints a widget token.
/// - `takeActionQueue()`: the `{widget_kind, action}` entries the extension queued in the App Group
///   (key `bonded.widget.actions`, a JSON array; WidgetActionQueue.swift), returned as JSON and the
///   key removed. The token is never in the App Group.
public class BondedWidgetsModule: Module {
  static let key = "bonded.widget.snapshot"
  /// Same key as plugins/widgets/ios/premium/WidgetActionQueue.swift (the extension side).
  static let actionsKey = "bonded.widget.actions"

  static var defaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BondedAppGroup") as? String
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  static var keychainGroup: String? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BondedWidgetKeychainGroup") as? String,
      !group.isEmpty, !group.contains("$(")
    else { return nil }
    return group
  }

  public func definition() -> ModuleDefinition {
    Name("BondedWidgets")

    Constant("keychainAccessGroup") { () -> String? in
      BondedWidgetsModule.keychainGroup
    }

    Function("setSnapshot") { (json: String) in
      guard let defaults = BondedWidgetsModule.defaults else { return }
      defaults.set(json, forKey: BondedWidgetsModule.key)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("takeActionQueue") { () -> String? in
      guard let defaults = BondedWidgetsModule.defaults,
        let json = defaults.string(forKey: BondedWidgetsModule.actionsKey)
      else { return nil }
      defaults.removeObject(forKey: BondedWidgetsModule.actionsKey)
      return json
    }
  }
}
