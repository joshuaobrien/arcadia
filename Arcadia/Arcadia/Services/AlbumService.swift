import Mockable

final class AlbumClient: AlbumService {
  private let api: ArcadiaAPI

  init(api: ArcadiaAPI) {
    self.api = api
  }

  func fetchAlbums(
    _ request: FetchAlbumsRequest
  ) async throws -> FetchAlbumsResponse {
    do {
      let response = try await self.api.fetchAlbums(
        cursor: request.cursor,
        limit: 20,
        term: request.searchTerm,
      )

      return FetchAlbumsResponse(
        albums: response.items,
        nextCursor: response.nextCursor
      )

    } catch {
      throw error
    }
  }
}

@Mockable
nonisolated protocol AlbumService {
  func fetchAlbums(
    _ request: FetchAlbumsRequest
  ) async throws -> FetchAlbumsResponse

  //  func fetchTracksForAlbum(
  //    _ request: FetchTracksForAlbumRequest
  //  ) async throws -> FetchTracksForAlbumResponse
}

struct FetchAlbumsRequest {
  let cursor: String?
  let searchTerm: String
}

struct FetchAlbumsResponse {
  let albums: [Album]
  let nextCursor: String?
}

struct FetchTracksForAlbumRequest {
  let albumId: String
}

struct FetchTracksForAlbumResponse {
  let total: Int
  let items: [Track]
  let nextCursor: String?
}
