import SwiftUI

struct SongActions: View {
  let track: Track
  var albumTracks: [Track] = []
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    Button("Play", systemImage: "play.fill") { playerStore.play(track, in: albumTracks) }
    Button("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") { playerStore.insertNext([track]) }
    Button("Add to Queue", systemImage: "text.badge.plus") { playerStore.append([track]) }
  }
}

struct SongActionsMenu: View {
  let track: Track
  var albumTracks: [Track] = []

  var body: some View {
    Menu {
      SongActions(track: track, albumTracks: albumTracks)
    } label: {
      Image(systemName: "ellipsis")
    }
    .songMenuStyle()
    .frame(width: 28)
    .accessibilityLabel("Actions for \(track.title ?? "Untitled track")")
    .accessibilityIdentifier("track.\(track.id).actions")
  }
}

extension View {
  @ViewBuilder
  func songMenuStyle() -> some View {
    #if os(macOS)
      menuStyle(.borderlessButton)
    #else
      self
    #endif
  }
}
