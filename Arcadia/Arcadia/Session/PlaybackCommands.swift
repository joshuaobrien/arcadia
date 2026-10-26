import SwiftUI

struct PlaybackCommands: Commands {
  let player: PlayerStore?

  var body: some Commands {
    CommandMenu("Playback") {
      Button("Play or Pause") { player?.togglePlayback() }
        .keyboardShortcut("p", modifiers: [.command, .option])
        .disabled(player?.currentEntryID == nil)
      Button("Previous Song or Restart") { player?.playPrevious() }
        .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
        .disabled(player?.currentEntryID == nil)
      Button("Next Song") { player?.playNext() }
        .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
        .disabled(player?.canAdvance != true)
    }
  }
}

// Shared transport access used by native controls and commands.
extension PlayerStore {
  enum State: String { case idle, loading, playing, paused, failed, ended }

  var needsReplacementConfirmation: Bool { pendingReplacement != nil }
  var canAdvance: Bool { currentIndex.map { queue.indices.contains($0 + 1) } ?? false }
  var upcoming: [QueueEntry] {
    guard let currentIndex else { return queue }
    return Array(queue.dropFirst(currentIndex + 1))
  }
  var currentIndex: Int? { queue.firstIndex { $0.id == currentEntryID } }

  var currentEntry: QueueEntry? { queue.first { $0.id == currentEntryID } }
  var currentTrack: Track? { currentEntry?.track }
  var isPlaying: Bool { state == .playing }

  func togglePlayback() {
    if isPlaying || isPlaybackRequested { pause() } else { resume() }
  }
}
