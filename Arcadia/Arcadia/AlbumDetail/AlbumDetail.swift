import SwiftUI

struct AlbumDetail: View {
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

      Divider()

      if model.isLoading {
        ProgressView("Loading tracks")
      } else if let errorText = model.errorText {
        ContentUnavailableView(
          "Couldn't Load Tracks",
          systemImage: "exclamationmark.triangle",
          description: Text(errorText)
        )
      } else {
        List(model.tracks) { track in
          TrackRow(
            track: track,
          )
        }
      }
    }
    .padding()
    .navigationTitle(album.title)
    .task {
      await model.onOpen()
    }
  }
}
