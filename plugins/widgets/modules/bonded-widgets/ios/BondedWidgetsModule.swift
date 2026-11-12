import ExpoModulesCore
import WidgetKit

/// MOB-30: the app's side of the widgets. Writes the snapshot (src/features/widgets/snapshot.ts)
/// to the App Group the widget extension reads, then asks WidgetKit to redraw.
/// The App Group id comes from Info.plist `BondedAppGroup` (plugins/widgets sets it).
public class BondedWidgetsModule: Module {
  static let key = "bonded.widget.snapshot"

  public func definition() -> ModuleDefinition {
    Name("BondedWidgets")

    Function("setSnapshot") { (json: String) in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "BondedAppGroup") as? String,
        let defaults = UserDefaults(suiteName: group)
      else { return }
      defaults.set(json, forKey: BondedWidgetsModule.key)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
