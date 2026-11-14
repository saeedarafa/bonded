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
/// - `hasTokenReader`: true exactly when `keychainAccessGroup` is set (SEC L1).
/// - `takeActionQueue()`: the `{widget_kind, action}` entries the extension queued in the App Group
///   (key `bonded.widget.actions`, a JSON array; WidgetActionQueue.swift), returned as JSON and the
///   key removed. The token is never in the App Group.
///
/// MOB-89 (#479): no HTTP response may stay in `Library/Caches/<bundle id>/Cache.db`. React
/// Native's networking uses a session from `URLSessionConfiguration.default`, whose `urlCache` is
/// `URLCache.shared` when the session is made (lazily, on the first JS request). `OnCreate` runs
/// when the module registry starts, before the JS bundle, so it empties the old cache and swaps in
/// a zero-capacity one. `clearHttpCache()` empties it again on sign-out / account deletion. The JS
/// side also sends `Cache-Control: no-store` (src/lib/httpCache.ts). Nothing here logs.
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

  static func disableHttpCache() {
    URLCache.shared.removeAllCachedResponses()
    URLCache.shared = URLCache(memoryCapacity: 0, diskCapacity: 0, directory: nil)
    URLCache.shared.removeAllCachedResponses()
  }

  public func definition() -> ModuleDefinition {
    Name("BondedWidgets")

    OnCreate {
      BondedWidgetsModule.disableHttpCache()
    }

    Constant("keychainAccessGroup") { () -> String? in
      BondedWidgetsModule.keychainGroup
    }

    // SEC L1: the token reader (plugins/widgets/ios/premium) ships exactly when the plugin sets the
    // keychain group (`premium: true`), so the two always agree. The app mints only when true.
    Constant("hasTokenReader") { () -> Bool in
      BondedWidgetsModule.keychainGroup != nil
    }

    Function("setSnapshot") { (json: String) in
      guard let defaults = BondedWidgetsModule.defaults else { return }
      defaults.set(json, forKey: BondedWidgetsModule.key)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("clearHttpCache") {
      URLCache.shared.removeAllCachedResponses()
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
