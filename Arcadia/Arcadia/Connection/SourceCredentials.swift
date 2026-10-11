import Foundation
import Security

// Opaque adapter session, never the listener's password or a URL containing a token.
struct SourceCredentials {
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "tokyo.drift.Arcadia.music-source",
      kSecAttrAccount as String: ProcessInfo.processInfo.environment["ARCADIA_SESSION_NAMESPACE"] ?? "default",
    ]
  }

  func read() throws -> Data? {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw MusicSourceError.storageFailed }
    return data
  }

  func save(_ data: Data) throws {
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw MusicSourceError.storageFailed }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw MusicSourceError.storageFailed }
  }

  func delete() throws {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw MusicSourceError.storageFailed }
  }
}
