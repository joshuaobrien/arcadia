import SwiftUI

struct Albums: View {
  @State private var model: AlbumsModel

  init(api: ArcadiaAPI) {
    _model = State(initialValue: .init(api: api))
  }

  var body: some View {
    Group {
      if model.isLoading {
        ProgressView("Loading albums")
      } else if model.errorText != nil {
        Text(model.errorText ?? "a")
      } else {
        AlbumGridView(
          albums: model.albums,
          hasNextPage: model.hasNextPage,
          isLoadingNextPage: model.isLoadingNextPage,
          onReachBottom: model.onReachBottom,
        )
      }
    }
    .task {
      await model.loadAlbums()
    }
  }
}
