import SwiftUI

struct Albums: View {
  @State private var model: AlbumsModel
  private var albumService: AlbumService

  init(albumService: AlbumService) {
    _model = State(initialValue: .init(albumService: albumService))
    self.albumService = albumService
  }

  var body: some View {
    Group {
      if model.loadState == LoadMode.initial {
        ProgressView("Loading albums")
          .accessibilityIdentifier("albums.loading")
      } else if model.errorText != nil {
        Text(model.errorText ?? "a")
          .accessibilityIdentifier("albums.error")
      } else if model.albums.isEmpty {
        ContentUnavailableView {
          Label("No albums yet", systemImage: "music.note.list")
            .accessibilityIdentifier("albums.empty.title")
        } description: {
          Text("Albums will appear here when they’re added to your library.")
            .accessibilityIdentifier("albums.empty.description")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Albums")
      } else {
        AlbumGridView(
          albumService: albumService,

          albums: model.albums,
          hasNextPage: model.hasNextPage,
          isLoadingNextPage: model.loadState == LoadMode.nextPage,
          onReachBottom: model.onReachBottom,
        )
      }
    }
    .task {
      await model.onOpen()
    }
  }
}
