import SwiftUI

struct Albums: View {
  private let model: AlbumsModel
  private var albumService: AlbumService

  init(albumService: AlbumService, model: AlbumsModel) {
    self.model = model
    self.albumService = albumService
  }

  var body: some View {
    Group {
      if model.loadState == LoadMode.initial {
        ProgressView("Loading albums")
          .accessibilityIdentifier("albums.loading")
      } else if let errorText = model.errorText {
        ContentUnavailableView {
          Label("Couldn’t load albums", systemImage: "exclamationmark.triangle")
            .accessibilityIdentifier("albums.error.title")
        } description: {
          Text(errorText)
            .accessibilityIdentifier("albums.error")
        } actions: {
          Button("Retry") {
            Task { await model.onRetry() }
          }
          .accessibilityIdentifier("albums.retry")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Albums")
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
