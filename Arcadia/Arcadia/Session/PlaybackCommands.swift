import SwiftUI

struct PlaybackCommands: Commands {
  let player: PlayerStore?

  var body: some Commands {
    CommandMenu("Playback") {
      Button("Play or Pause") { player?.togglePlayback() }
        .keyboardShortcut("p", modifiers: [.command, .option])
        .disabled(player?.currentEntryID == nil)
      Button("Next Song") { player?.playNext() }
        .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
        .disabled(player?.canAdvance != true)
    }
  }
}
