import SwiftUI

struct SongActions: View {
  let track: Track
  @Environment(PlayerStore.self) private var playerStore

  var body: some View {
    Button("Play", systemImage: "play.fill") { playerStore.play([track]) }
    Button("Play Next", systemImage: "text.line.first.and.arrowtriangle.forward") { playerStore.insertNext([track]) }
    Button("Add to Queue", systemImage: "text.badge.plus") { playerStore.append([track]) }
  }
}

struct SongActionsMenu: View {
  let track: Track

  var body: some View {
    Menu { SongActions(track: track) } label: { Image(systemName: "ellipsis") }
      .menuStyle(.borderlessButton)
      .frame(width: 28)
      .accessibilityLabel("Actions for \(track.title ?? "Untitled track")")
      .accessibilityIdentifier("track.\(track.id).actions")
  }
}
