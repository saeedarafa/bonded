import Foundation
import Security

// MOB-77 (D59, SEC-21 option A). Typechecked (swiftc), not yet built or run on a device.
//
// Reads the widget token the app keeps in the shared keychain access group
// (src/features/widgets/tokens.ts through expo-secure-store). Read only: the widget never mints,
// refreshes or deletes it, and never copies it anywhere (no App Group, no timeline entry, no log).
// expo-secure-store layout: kSecAttrService = "<keychainService>:no-auth", kSecAttrAccount = the key
// as Data, value = JSON {"token":"bwt_…","expires_at":"<ISO>"}, AfterFirstUnlockThisDeviceOnly.

struct WidgetToken {
  let token: String
  let expiresAt: Date
}

enum WidgetTokenStore {
  static let service = "bonded.widget:no-auth"
  static let account = Data("token".utf8)

  /// Info.plist `BondedWidgetKeychainGroup` (plugins/widgets, premium only). nil when missing or
  /// when Xcode left `$(AppIdentifierPrefix)` unexpanded.
  static var accessGroup: String? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BondedWidgetKeychainGroup") as? String,
      !group.isEmpty, !group.contains("$(")
    else { return nil }
    return group
  }

  private struct Stored: Decodable {
    let token: String
    let expires_at: String
  }

  /// The live token, or nil (none, unreadable, malformed or expired: the widget shows "Open Bonded").
  static func read(now: Date = Date()) -> WidgetToken? {
    guard let group = accessGroup else { return nil }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let stored = try? JSONDecoder().decode(Stored.self, from: data),
      isWellFormed(stored.token),
      let expires = parseDate(stored.expires_at),
      expires > now
    else { return nil }
    return WidgetToken(token: stored.token, expiresAt: expires)
  }

  /// `bwt_` + 43 base64url characters (CONTRACTS §2 `mint_widget_token`).
  static func isWellFormed(_ token: String) -> Bool {
    guard token.hasPrefix("bwt_"), token.count == 47 else { return false }
    let allowed = CharacterSet(charactersIn:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    return token.dropFirst(4).unicodeScalars.allSatisfy { allowed.contains($0) }
  }

  /// Postgres timestamptz as ISO 8601, with or without (up to 6) fractional digits.
  static func parseDate(_ value: String) -> Date? {
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: value) { return date }
    // Drop the fraction (ISO8601DateFormatter's fractional option wants exactly 3 digits).
    let trimmed = value.replacingOccurrences(
      of: #"\.\d+"#, with: "", options: .regularExpression)
    return plain.date(from: trimmed)
  }
}
