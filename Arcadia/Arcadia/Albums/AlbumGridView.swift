import SwiftUI

struct AlbumGridView: View {

  let albumService: AlbumService

  let countText: String
  let albums: [Album]
  let hasNextPage: Bool
  let isLoadingNextPage: Bool
  let onReachBottom: () async -> Void
  var isInitialLoading = false

  var body: some View {
    ScrollView {
      Text("\(countText) albums")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("albums.count")
      AlbumCardGrid {
        if isInitialLoading {
          ForEach(0..<8, id: \.self) { _ in
            AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
              .redacted(reason: .placeholder)
              .skeletonPulse()
              .accessibilityHidden(true)
          }
        }
        ForEach(albums) { album in
          albumLink(album) {
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
              AlbumCardView(artworkURL: nil, title: "A familiar record", artist: "An artist", year: "2026")
                .redacted(reason: .placeholder)
                .skeletonPulse()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading more albums")
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
    .accessibilityIdentifier(isInitialLoading ? "albums.loading" : "albums.scroll")
    .accessibilityLabel(isInitialLoading ? "Loading albums" : "Albums")
  }

  @ViewBuilder
  private func albumLink<Label: View>(_ album: Album, @ViewBuilder label: () -> Label) -> some View {
    #if os(macOS)
      NavigationLink(value: LibraryRoute.album(album), label: label)
    #else
      NavigationLink {
        AlbumDetail(albumService: albumService, album: album)
      } label: {
        label()
      }
    #endif
  }
}
