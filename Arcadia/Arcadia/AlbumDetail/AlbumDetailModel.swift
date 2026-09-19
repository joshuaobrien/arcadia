import SwiftUI

@Observable
final class AlbumDetailModel {
  private var albumService: AlbumService
  private var album: Album

  init(
    albumService: AlbumService,
    album: Album
  ) {
    self.albumService = albumService
    self.album = album
  }

  var tracks: [Track] = []
  var isLoading = true
  var errorText: String?

  func onOpen() async {
    await load()
  }

  private func load() async {
    errorText = nil
    isLoading = true

    do {
      let response = try await albumService.fetchAlbum(
        FetchAlbumRequest(albumId: self.album.id)
      )

      tracks = response.items
    } catch {
      errorText = error.localizedDescription
    }

    isLoading = false
  }
}
