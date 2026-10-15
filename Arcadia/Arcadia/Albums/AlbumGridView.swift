import SwiftUI

private let minimumAlbumWidth: CGFloat = 220

struct AlbumGridView: View {

  let albumService: AlbumService

  let albums: [Album]
  let hasNextPage: Bool
  let isLoadingNextPage: Bool
  let onReachBottom: () async -> Void

  var body: some View {
    ScrollView {
      Text("\(albums.count) albums")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("albums.count")
      LazyVGrid(
        columns: [
          GridItem(.adaptive(minimum: minimumAlbumWidth))
        ],
        spacing: DesignTokens.Spacing.xl
      ) {
        ForEach(albums) { album in
          NavigationLink {
            AlbumDetail(
              albumService: albumService,
              album: album,
            )
          } label: {
            AlbumCardView(
              artworkURL: album.artworkURL,
              title: album.title,
              artist: album.albumArtist,
              year: album.year.map(String.init) ?? "",
            )
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("album.\(album.id)")
          .padding()
        }

        if hasNextPage {
          VStack(spacing: DesignTokens.Spacing.s) {
            if isLoadingNextPage {
              ProgressView()
            }
          }
          .task {
            await onReachBottom()
          }
        }
      }
      .libraryNavigationTitle("Albums")
    }
    .accessibilityIdentifier("albums.scroll")
  }
}
