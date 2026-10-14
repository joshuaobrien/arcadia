import XCTest

@testable import Arcadia

final class AlbumPaginationTests: XCTestCase {
  @MainActor
  func testOverlappingPagesKeepFirstAlbumOrderAndConsumeTheSourceCursor() async {
    let model = AlbumsModel(albumService: OverlappingAlbumPages())

    await model.onOpen()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B"])
    XCTAssertTrue(model.hasNextPage)

    await model.onReachBottom()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B", "C"])
    XCTAssertEqual(model.albums.map(\.title), ["First A", "First B", "First C"])
    XCTAssertFalse(model.hasNextPage)
    XCTAssertNil(model.errorText)

    await model.onReachBottom()
    XCTAssertEqual(model.albums.map(\.id), ["A", "B", "C"])
    XCTAssertNil(model.errorText)
  }
}

private struct OverlappingAlbumPages: AlbumService {
  func fetchAlbums(_ request: FetchAlbumsRequest) async throws -> FetchAlbumsResponse {
    switch request.cursor {
    case nil:
      FetchAlbumsResponse(albums: [album("A", "First A"), album("B", "First B")], nextCursor: "overlap")
    case "overlap":
      FetchAlbumsResponse(
        albums: [album("B", "Repeated B"), album("C", "First C"), album("C", "Repeated C")], nextCursor: nil)
    default:
      throw MusicSourceError.invalidCursor
    }
  }

  func fetchAlbum(_: FetchAlbumRequest) async throws -> FetchAlbumResponse {
    throw MusicSourceError.unsupportedBrowsing
  }

  private func album(_ id: String, _ title: String) -> Album {
    Album(id: id, title: title, albumArtist: "Test Artist", year: nil, trackCount: nil, artworkURL: nil)
  }
}
