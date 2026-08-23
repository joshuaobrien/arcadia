import SwiftUI

struct AlbumCardView: View {
  let artworkURL: URL?
  let title: String
  let artist: String
  let year: String

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.s) {
      AlbumArtwork(artworkURL: artworkURL)
        .aspectRatio(1, contentMode: .fit)
        .clipShape(
          RoundedRectangle(cornerRadius: DesignTokens.Radius.m)
        )

      Text(title)
        .font(.headline)
        .lineLimit(1)

      Text(artist)
        .foregroundStyle(.secondary)
        .lineLimit(1)

      Text(String(year))
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .task {
      print(artworkURL)
    }
  }
}
