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
      } else if model.errorText != nil {
        Text(model.errorText ?? "a")
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
