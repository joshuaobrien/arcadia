import CryptoKit
import Foundation
import Observation
#if canImport(AppKit)
import AppKit
#endif

@MainActor
@Observable
final class ListeningSession {
  let player: PlayerStore
  let source: any MusicSource
  private(set) var recoveryMessage: String?
  @ObservationIgnored private let binding: UUID?
  @ObservationIgnored private let file: PlaybackSessionFile?
  @ObservationIgnored private var saveTask: Task<Void, Never>?
  @ObservationIgnored private var terminationObserver: NSObjectProtocol?
  @ObservationIgnored private var isClosed = false

  init(source: any MusicSource, sourceBinding: UUID? = nil) {
    self.source = source
    player = PlayerStore(source: source)
    binding = sourceBinding
    file = sourceBinding == nil ? nil : PlaybackSessionFile()
    if let binding, let file {
      do {
        if let data = try file.read() { try player.restoreSession(data, sourceBinding: binding) }
      } catch {
        recoveryMessage = (error as? PlaybackSessionError)?.localizedDescription
          ?? PlaybackSessionError.invalidSnapshot.localizedDescription
      }
      observeChanges()
    }
    #if canImport(AppKit)
    terminationObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.willTerminateNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.shutdown() }
    }
    #endif
  }

  func flush() {
    saveTask?.cancel()
    saveTask = nil
    guard !isClosed, let binding, let file else { return }
    do {
      if let data = try player.exportSession(sourceBinding: binding) { try file.write(data) }
    } catch {
      recoveryMessage = "Your listening session couldn't be saved. Check available storage."
      AppDiagnostics.event("session.save.failed")
    }
  }

  func discard() {
    isClosed = true
    closeObservers()
    player.stop()
    do { try file?.clear() } catch { AppDiagnostics.event("session.discard.failed") }
  }

  func shutdown() {
    flush()
    isClosed = true
    closeObservers()
    player.releaseTransport()
  }

  private func closeObservers() {
    saveTask?.cancel()
    saveTask = nil
    if let terminationObserver { NotificationCenter.default.removeObserver(terminationObserver) }
    terminationObserver = nil
  }

  private func observeChanges() {
    guard !isClosed else { return }
    withObservationTracking {
      _ = player.queue
      _ = player.currentEntryID
      _ = player.currentTime
      _ = player.state
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self, !self.isClosed else { return }
        self.observeChanges()
        // Throttle progress writes; continually resetting a debounce would never save while playing.
        guard self.saveTask == nil else { return }
        self.saveTask = Task { [weak self] in
          try? await Task.sleep(for: .seconds(1))
          guard !Task.isCancelled, let self else { return }
          self.saveTask = nil
          self.flush()
        }
      }
    }
  }
}

private struct PlaybackSessionFile {
  private let url: URL

  init() {
    let namespace = ProcessInfo.processInfo.environment["ARCADIA_SESSION_NAMESPACE"] ?? "default"
    let name = SHA256.hash(data: Data(namespace.utf8)).map { String(format: "%02x", $0) }.joined()
    url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Arcadia/ListeningSessions", isDirectory: true)
      .appendingPathComponent(name + ".json")
  }

  func read() throws -> Data? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try Data(contentsOf: url)
  }

  func write(_ data: Data) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try data.write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }

  func clear() throws {
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }
}
