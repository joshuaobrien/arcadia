import Foundation
import MediaPlayer
import Observation

#if canImport(AppKit)
  import AppKit
#else
  import UIKit
#endif

@MainActor
final class MediaPlaybackBridge {
  private let player: PlayerStore
  private let source: any MusicSource
  private let availability = RemotePlaybackAvailability()
  private var targets: [(MPRemoteCommand, Any)] = []
  private var isClosed = false
  private var artworkTask: Task<Void, Never>?
  private var artworkEntry: UUID?
  private var artworkURL: URL?
  private var artwork: MPMediaItemArtwork?
  private var publishedState: PlayerStore.State?

  init(player: PlayerStore, source: any MusicSource) {
    self.player = player
    self.source = source
    let center = MPRemoteCommandCenter.shared()
    register(center.playCommand) {
      AppDiagnostics.event("system.play")
      $0.resume()
    }
    register(center.pauseCommand) {
      AppDiagnostics.event("system.pause")
      $0.pause()
    }
    register(center.togglePlayPauseCommand) { $0.togglePlayback() }
    register(center.previousTrackCommand) { $0.playPrevious() }
    register(center.nextTrackCommand, advancing: true) { $0.playNext() }
    let availability = availability
    let seek = center.changePlaybackPositionCommand.addTarget { [weak player, availability] event in
      guard availability.permits(seeking: true) else { return .noActionableNowPlayingItem }
      guard let event = event as? MPChangePlaybackPositionCommandEvent,
        event.positionTime.isFinite, event.positionTime >= 0
      else { return .commandFailed }
      Task { @MainActor in
        guard availability.permits(seeking: true), let player, player.currentEntryID != nil else { return }
        player.seek(to: event.positionTime, resumeAfterSeeking: player.isPlaybackRequested)
      }
      return .success
    }
    targets.append((center.changePlaybackPositionCommand, seek))
    observe()
  }

  func close() {
    isClosed = true
    availability.update(hasSession: false, canAdvance: false, canSeek: false)
    artworkTask?.cancel()
    for (command, target) in targets {
      command.removeTarget(target)
      command.isEnabled = false
    }
    targets = []
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    #if os(macOS)
      MPNowPlayingInfoCenter.default().playbackState = .stopped
    #endif
  }

  private func register(
    _ command: MPRemoteCommand, advancing: Bool = false, action: @escaping @MainActor (PlayerStore) -> Void
  ) {
    let availability = availability
    let target = command.addTarget { [weak player, availability] _ in
      guard availability.permits(advancing: advancing) else { return .noActionableNowPlayingItem }
      Task { @MainActor in
        guard availability.permits(advancing: advancing), let player, player.currentEntryID != nil else { return }
        action(player)
      }
      return .success
    }
    targets.append((command, target))
  }

  private func observe() {
    guard !isClosed else { return }
    withObservationTracking {
      publish()
    } onChange: { [weak self] in
      Task { @MainActor in self?.observe() }
    }
  }

  private func publish() {
    let center = MPRemoteCommandCenter.shared()
    let available = player.currentTrack != nil
    availability.update(hasSession: available, canAdvance: player.canAdvance, canSeek: available && player.duration > 0)
    center.playCommand.isEnabled = available && !player.isPlaying
    center.pauseCommand.isEnabled = available && player.isPlaybackRequested
    center.togglePlayPauseCommand.isEnabled = available
    center.previousTrackCommand.isEnabled = available
    center.nextTrackCommand.isEnabled = player.canAdvance
    center.changePlaybackPositionCommand.isEnabled = available && player.duration > 0
    guard let track = player.currentTrack else {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      #if os(macOS)
        MPNowPlayingInfoCenter.default().playbackState = .stopped
      #endif
      return
    }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: track.title ?? "Untitled track",
      MPMediaItemPropertyArtist: track.artists?.joined(separator: ", ") ?? "Unknown Artist",
      MPNowPlayingInfoPropertyPlaybackRate: player.isPlaying ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime,
      MPNowPlayingInfoPropertyPlaybackQueueCount: player.queue.count,
    ]
    if let album = track.albumReference { info[MPMediaItemPropertyAlbumTitle] = album.title }
    if player.duration.isFinite && player.duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = player.duration }
    if let index = player.queue.firstIndex(where: { $0.id == player.currentEntryID }) {
      info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = index
    }
    loadArtwork(track)
    if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    if publishedState != player.state {
      publishedState = player.state
      AppDiagnostics.event("system.metadata.\(player.state.rawValue)")
    }
    #if os(macOS)
      MPNowPlayingInfoCenter.default().playbackState = player.isPlaying ? .playing : .paused
    #endif
  }

  private func loadArtwork(_ track: Track) {
    let url = track.artworkURL ?? track.albumReference?.artworkURL
    guard artworkEntry != player.currentEntryID || artworkURL != url else { return }
    artworkTask?.cancel()
    artworkEntry = player.currentEntryID
    artworkURL = url
    artwork = nil
    guard let url else { return }
    let expected = player.currentEntryID
    artworkTask = Task { [weak self] in
      guard let self else { return }
      do {
        let data = try await source.artworkData(for: url)
        try Task.checkCancellation()
        guard !isClosed, player.currentEntryID == expected,
          (player.currentTrack?.artworkURL ?? player.currentTrack?.albumReference?.artworkURL) == url
        else { return }
        #if canImport(AppKit)
          guard let image = NSImage(data: data) else { return }
        #else
          guard let image = UIImage(data: data) else { return }
        #endif
        artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        publish()
      } catch {
        // Artwork does not block transport or expose source errors.
      }
    }
  }
}

// Remote events may arrive outside MainActor; validate availability without reading observable UI state there.
private nonisolated final class RemotePlaybackAvailability: @unchecked Sendable {
  private let lock = NSLock()
  private var hasSession = false
  private var canAdvance = false
  private var canSeek = false

  func update(hasSession: Bool, canAdvance: Bool, canSeek: Bool) {
    lock.withLock {
      self.hasSession = hasSession
      self.canAdvance = canAdvance
      self.canSeek = canSeek
    }
  }

  func permits(advancing: Bool = false, seeking: Bool = false) -> Bool {
    lock.withLock { hasSession && (!advancing || canAdvance) && (!seeking || canSeek) }
  }
}
