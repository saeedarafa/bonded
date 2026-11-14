import Foundation

// MOB-77. NOT YET COMPILED: needs a device build check.
// Fills the i18next placeholders of the generated BondedCopy table (BondedPremiumCopy.swift, from
// en.json `widgets.*`): `{{name}}`, `{{name, capitalize}}` and `_one` / `_other` plurals.

extension BondedCopy {
  static func t(_ key: String, _ vars: [String: String] = [:]) -> String {
    var text = strings[key] ?? ""
    for (name, value) in vars {
      let capitalized = value.prefix(1).uppercased() + value.dropFirst()
      text = text.replacingOccurrences(of: "{{\(name), capitalize}}", with: capitalized)
      text = text.replacingOccurrences(of: "{{\(name)}}", with: value)
    }
    return text
  }

  /// English plurals only (the app ships en.json only).
  static func plural(_ key: String, count: Int, _ vars: [String: String] = [:]) -> String {
    var all = vars
    all["count"] = String(count)
    let one = t("\(key)_one", all)
    let other = t("\(key)_other", all)
    return count == 1 ? one : other
  }
}
