import SwiftUI

private let minimumAlbumWidth: CGFloat = 220

struct AlbumGridView: View {

  let albums: [Album]
  let hasNextPage: Bool
  let isLoadingNextPage: Bool
  let onReachBottom: () async -> Void

  var body: some View {
    ScrollView {
      LazyVGrid(
        columns: [
          GridItem(.adaptive(minimum: minimumAlbumWidth))
        ],
        spacing: DesignTokens.Spacing.xl
      ) {
        ForEach(albums) { album in
          NavigationLink {
            Text(album.title)
          } label: {
            AlbumCardView(
              artworkURL: album.artworkURL,
              title: album.title,
              artist: album.albumArtist,
              year: "todo",
            )
          }
          .buttonStyle(.plain)
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
      .navigationTitle("Albums")
    }
  }
}
