import Foundation
import Security

struct IssueToken {
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "tokyo.drift.Arcadia.issue-reporter",
      kSecAttrAccount as String: ProcessInfo.processInfo.environment["ARCADIA_SESSION_NAMESPACE"] ?? "default",
    ]
  }

  func read() -> String {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return "" }
    return String(data: data, encoding: .utf8) ?? ""
  }

  func save(_ token: String) throws {
    let data = Data(token.utf8)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw MusicSourceError.storageFailed }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw MusicSourceError.storageFailed }
  }
}
