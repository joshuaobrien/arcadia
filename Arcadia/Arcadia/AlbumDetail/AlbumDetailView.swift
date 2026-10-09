import SwiftUI

struct AlbumDetailView: View {
  let album: Album

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.m) {
      AlbumMetadataView(
        artworkURL: album.artworkURL,
        title: album.title,
        artist: album.albumArtist,
        year: album.year.map(String.init) ?? "",
        trackCount: album.trackCount.map(String.init) ?? "",
      )

      Divider()

    }
  }
}

struct AlbumMetadataView: View {
  let artworkURL: URL?
  let title: String
  let artist: String
  let year: String
  let trackCount: String

  var body: some View {
    HStack(alignment: .bottom, spacing: DesignTokens.Spacing.l) {
      AlbumArtwork(
        artworkURL: artworkURL
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
        Text(title)
          .font(.largeTitle)
          .fontWeight(.bold)

        Text(artist)
          .font(.title2)
          .foregroundStyle(.secondary)

        HStack(spacing: DesignTokens.Spacing.xs) {
          Text(year)

          Text("•")
          Text("\(trackCount) tracks")
        }
        .font(.callout)
        .foregroundStyle(.secondary)
      }

    }
  }
}

struct LoadingAlbumTracksView: View {
  let isLoading: Bool
  let errorText: String?

  var body: some View {
    if isLoading {
      ProgressView("Loading tracks")
    } else if let errorText = errorText {
      ContentUnavailableView(
        "Couldn't Load Tracks",
        systemImage: "exclamationmark.triangle",
        description: Text(errorText)
      )
    }
  }
}

struct AlbumTracksView: View {
  let tracks: [Track]

  var body: some View {
    List(tracks) { track in
      TrackRow(track: track)
    }
  }
}
