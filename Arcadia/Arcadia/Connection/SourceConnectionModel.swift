import Foundation
import Observation

@MainActor
@Observable
final class SourceConnectionModel {
  var server = ""
  var username = ""
  var password = ""
  var isConnecting = false
  var errorText: String?
  private(set) var listeningSession: ListeningSession?
  private(set) var source: (any MusicSource)?
  private var hasRestored = false
  private let connector: any MusicSourceConnector
  private let credentials: SourceCredentials

  init(connector: any MusicSourceConnector) {
    self.connector = connector
    credentials = SourceCredentials()
  }

  func restore() async {
    guard !hasRestored else { return }
    hasRestored = true
    isConnecting = true
    defer { isConnecting = false }
    do {
      if let session = try credentials.read() {
        let saved = try? JSONDecoder().decode(SecureSourceSession.self, from: session)
        let connection = try await connector.restore(saved?.adapterSession ?? session)
        let binding = saved?.binding ?? UUID()
        try credentials.save(
          JSONEncoder().encode(SecureSourceSession(binding: binding, adapterSession: connection.savedSession)))
        listeningSession = ListeningSession(source: connection.source, sourceBinding: binding)
        source = connection.source
      }
    } catch {
      errorText = "Your saved connection needs attention. Sign in again."
    }
  }

  func connect() async {
    guard !isConnecting else { return }
    errorText = nil
    isConnecting = true
    defer {
      isConnecting = false
      password = ""
    }
    do {
      guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
        ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
        let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
        url.query == nil, url.fragment == nil
      else { throw MusicSourceError.invalidServer }
      guard !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else {
        throw MusicSourceError.credentialsRequired
      }
      let connection = try await connector.connect(server: url, username: username, password: password)
      let binding = UUID()
      try credentials.save(
        JSONEncoder().encode(SecureSourceSession(binding: binding, adapterSession: connection.savedSession)))
      listeningSession = ListeningSession(source: connection.source, sourceBinding: binding)
      source = connection.source
      AppDiagnostics.event("source.connected")
    } catch {
      errorText =
        (error as? MusicSourceError)?.localizedDescription ?? MusicSourceError.unavailable.localizedDescription
      AppDiagnostics.event("source.connection.failed")
    }
  }

  func disconnect() {
    do {
      try credentials.delete()
      listeningSession?.discard()
      listeningSession = nil
      source = nil
      password = ""
      errorText = nil
    } catch {
      errorText = MusicSourceError.storageFailed.localizedDescription
    }
  }
}

// Stored only in Keychain: the opaque adapter credential and stable connection binding.
private struct SecureSourceSession: Codable {
  let binding: UUID
  let adapterSession: Data
}
