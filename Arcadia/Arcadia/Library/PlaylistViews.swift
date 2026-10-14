import SwiftUI

struct PlaylistsView: View {
  @Bindable var model: PagedLibrary<Playlist>
  var isActive = true

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        ForEach(model.items) { playlist in
          NavigationLink(value: LibraryRoute.playlist(playlist)) {
            HStack {
              AlbumArtwork(artworkURL: playlist.artworkURL).frame(width: 48, height: 48)
              Text(playlist.title).font(.headline)
              Spacer()
              Image(systemName: "chevron.right")
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("playlist.\(playlist.id)")
        }
        LibraryPageStatus(model: model, noun: "playlists")
      }
      .padding()
    }
    .accessibilityIdentifier("playlists.scroll")
    .libraryNavigationTitle("Playlists")
    .task(id: isActive) { if isActive { await model.open() } }
  }
}

struct PlaylistDetail: View {
  let playlist: Playlist
  var isActive = true
  @Environment(PlayerStore.self) private var playerStore
  @State private var model: PlaylistDetailModel

  init(playlist: Playlist, source: any MusicSource, isActive: Bool = true) {
    self.isActive = isActive
    self.playlist = playlist
    _model = State(initialValue: PlaylistDetailModel(playlist: playlist, source: source))
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
        Button("Play", systemImage: "play.fill") { model.play(using: playerStore) }
          .disabled(model.isPreparing || model.songs.items.isEmpty)
          .accessibilityIdentifier("playlist.play")
        if model.isPreparing { ProgressView("Preparing playlist").accessibilityIdentifier("playlist.preparing") }
        if let error = model.playError {
          Text(error).accessibilityIdentifier("playlist.play.error")
          Button("Retry Play") { model.play(using: playerStore) }.accessibilityIdentifier("playlist.play.retry")
        }
        Text("\(model.songs.items.count) songs\(model.songs.nextCursor == nil ? "" : " loaded")")
          .accessibilityIdentifier("playlist.count")
        ForEach(model.songs.items) { entry in
          TrackRow(track: entry.track, showsTrackNumber: false)
            .accessibilityIdentifier("playlist.entry.\(entry.id)")
        }
        LibraryPageStatus(model: model.songs, noun: "playlist-songs")
      }
      .padding()
    }
    .accessibilityIdentifier("playlist.scroll")
    .libraryNavigationTitle(playlist.title)
    .task { await model.songs.open() }
    .onDisappear { model.cancelPreparation() }
    .onChange(of: isActive) { _, active in if !active { model.cancelPreparation() } }
  }
}
