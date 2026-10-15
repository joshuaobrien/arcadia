import Foundation
import Mockable

final class FakeAlbumClient: AlbumService {

  func fetchAlbum(_: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    return FetchAlbumResponse(
      total: 3,
      items: [
        Track(
          id: "1",
          relativePath: nil,
          title: "The First Song",
          artists: ["Bjork"],
          trackNumber: 1,
          discNumber: 1,
          durationSeconds: 63,
          format: nil,
        ),
        Track(
          id: "2",
          relativePath: nil,
          title: "The Second Song",
          artists: ["Bjork"],
          trackNumber: 2,
          discNumber: 1,
          durationSeconds: 63,
          format: nil,
        ),
        Track(
          id: "3",
          relativePath: nil,
          title: "The Third Song",
          artists: ["Bjork"],
          trackNumber: 3,
          discNumber: 1,
          durationSeconds: 63,
          format: nil,
        ),
      ],
      nextCursor: nil,
    )
  }

  func fetchAlbums(_: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    return FetchAlbumsResponse(
      albums: [
        Album(
          id: "1",
          title: "Hyperballad",
          albumArtist: "Bjork",
          year: 1996,
          trackCount: 13,
          artworkURL: nil,
        )

      ],
      nextCursor: nil
    )
  }
}

final class AlbumClient: MusicSource {
  private let api: ArcadiaAPI

  init(api: ArcadiaAPI) {
    self.api = api
  }

  func playableResource(for track: Track) async throws -> PlayableResource {
    PlayableResource(url: api.streamURL(for: track))
  }

  func artworkData(for url: URL) async throws -> Data {
    if url.isFileURL { return try Data(contentsOf: url) }
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
  }

  func fetchAlbum(
    _ request: FetchAlbumRequest
  ) async throws -> FetchAlbumResponse {
    do {
      let response = try await self.api.fetchTracks(for: request.albumId)

      return FetchAlbumResponse(
        total: response.total,
        items: response.items,
        nextCursor: nil
      )

    } catch {
      throw error
    }
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

  func fetchAlbum(
    _ request: FetchAlbumRequest
  ) async throws -> FetchAlbumResponse
}

struct FetchAlbumRequest {
  let albumId: String
}

struct FetchAlbumResponse {
  let total: Int
  let items: [Track]
  let nextCursor: String?
}

struct FetchAlbumsRequest {
  let cursor: String?
  let searchTerm: String
}

struct FetchAlbumsResponse {
  let albums: [Album]
  let nextCursor: String?
}
