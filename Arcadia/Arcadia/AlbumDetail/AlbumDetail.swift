import SwiftUI

struct AlbumDetail: View {
  @Environment(PlayerStore.self) private var playerStore
  @State private var model: AlbumDetailModel
  private var album: Album

  init(
    albumService: AlbumService,
    album: Album,
  ) {
    _model = State(
      initialValue: .init(albumService: albumService, album: album)
    )
    self.album = album
  }

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      HStack(alignment: .bottom, spacing: DesignTokens.Spacing.l) {
        AlbumArtwork(
          artworkURL: self.album.artworkURL
        )
        .frame(width: 220, height: 220)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Spacing.m))
        .shadow(
          color: .black.opacity(0.2),
          radius: DesignTokens.Radius.l,
          y: 5
        )

        VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
          Text("ALBUM")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
          Text(album.title)
            .font(.largeTitle)
            .fontWeight(.bold)

          Text(album.albumArtist)
            .font(.title2)
            .foregroundStyle(.secondary)

          HStack(spacing: DesignTokens.Spacing.xs) {
            if let year = album.year {
              Text(String(year))
            }

            if let trackCount = album.trackCount {
              Text("•")
              Text("\(trackCount) tracks")
            }
          }
          .font(.callout)
          .foregroundStyle(.secondary)
        }
      }

      HStack {
        Button("Play album", systemImage: "play.fill") { playerStore.play(model.tracks) }
          .accessibilityIdentifier("album.play")
        Menu {
          Button("Play Album Next") { playerStore.insertNext(model.tracks) }
          Button("Add Album to Queue") { playerStore.append(model.tracks) }
        } label: { Image(systemName: "ellipsis") }
          .menuStyle(.borderlessButton)
          .frame(width: 28)
          .accessibilityLabel("Album actions")
          .accessibilityIdentifier("album.actions")
      }
      .disabled(model.isLoading || model.tracks.isEmpty)

      Divider()

      if model.isLoading {
        ProgressView("Loading tracks")
          .accessibilityIdentifier("tracks.loading")
      } else if let errorText = model.errorText {
        ContentUnavailableView(
          "Couldn't Load Tracks",
          systemImage: "exclamationmark.triangle",
          description: Text(errorText)
        )
        .accessibilityIdentifier("tracks.error")
      } else {
        List(model.tracks) { track in
          HStack {
            TrackRow(track: track)
            SongActionsMenu(track: track)
          }
        }
        .accessibilityIdentifier("tracks.loaded")
      }
    }
    .padding()
    .navigationTitle(album.title)
    .navigationBarBackButtonHidden(true)
    .toolbar {
      ToolbarItem(placement: .navigation) { AlbumBackButton() }
    }
    .task {
      await model.onOpen()
    }
  }
}

private struct AlbumBackButton: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    Button {
      dismiss()
    } label: {
      Label("Back to albums", systemImage: "chevron.left")
    }
    .accessibilityIdentifier("albums.back")
  }
}
