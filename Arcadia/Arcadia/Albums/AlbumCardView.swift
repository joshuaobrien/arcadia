import SwiftUI

struct AlbumCardView: View {
  let artworkURL: URL?
  let title: String
  let artist: String
  let year: String

  var body: some View {
    VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
      AlbumArtwork(artworkURL: artworkURL)
        .aspectRatio(1, contentMode: .fit)
        .clipShape(
          RoundedRectangle(cornerRadius: DesignTokens.Radius.m)
        )

      Text(title)
        .font(.headline)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)

      Text(artist)
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)

      if !year.isEmpty {
        Text(String(year))
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

#if DEBUG
  #Preview("Album card") {
    AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
      .padding()
      .frame(width: 240)
  }

  #Preview("Long metadata") {
    AlbumCardView(
      artworkURL: nil, title: "An album title that wraps across multiple lines",
      artist: "An artist with a longer name", year: "2026"
    )
    .padding()
    .frame(width: 180)
  }
#endif
