import SwiftUI

struct AlbumGridView: View {

  let albumService: AlbumService

  let countText: String
  let albums: [Album]
  let hasNextPage: Bool
  let isLoadingNextPage: Bool
  let onReachBottom: () async -> Void

  var body: some View {
    ScrollView {
      Text("\(countText) albums")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("albums.count")
      AlbumCardGrid {
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
      .padding(.horizontal, DesignTokens.Spacing.l)
      .libraryNavigationTitle("Albums")
    }
    .accessibilityIdentifier("albums.scroll")
  }
}
