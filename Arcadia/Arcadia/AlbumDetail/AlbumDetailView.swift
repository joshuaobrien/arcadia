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

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        stackedHeader
      } else {
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .bottom, spacing: DesignTokens.Spacing.l) {
            artwork.frame(width: 220, height: 220)
            metadata.frame(minWidth: 280, maxWidth: .infinity, alignment: .leading)
          }
          stackedHeader
        }
      }
    }
  }

  private var stackedHeader: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.l) {
      artwork.frame(width: 140, height: 140)
      metadata.frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var artwork: some View {
    AlbumArtwork(artworkURL: artworkURL)
      .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.m))
  }

  private var metadata: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
      Text("ALBUM")
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
      Text(title)
        .font(.largeTitle.bold())
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("album.title")
      Text(artist)
        .font(.title2)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("album.artist")
      Text([year, trackCount.isEmpty ? "" : "\(trackCount) tracks"].filter { !$0.isEmpty }.joined(separator: " • "))
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
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
